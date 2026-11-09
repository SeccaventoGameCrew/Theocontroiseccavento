"""Local HTTP backend of the interface (browser mode and macOS app).

Binds to 127.0.0.1. Every /api/ call must carry the per-session token (sent as the
X-TVGen-Token header) and a localhost Host header, so other web pages open in the
browser cannot drive the generator (CSRF / DNS rebinding).
"""
from __future__ import annotations

import io
import json
import os
import secrets
import threading
import traceback
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from .. import appsupport
from ..export.player import preview_data
from ..generate import build_output, has_claude_credentials, make_song
from ..layout import load_layout
from ..spec import Song

HERE = os.path.dirname(os.path.abspath(__file__))
_lock = threading.Lock()


def _safe_join(root: str, rel: str) -> str | None:
    p = os.path.realpath(os.path.join(root, rel))
    r = os.path.realpath(root)
    return p if p == r or p.startswith(r + os.sep) else None


def _template_info(path: str | None) -> dict:
    if not path:
        return {"ok": False, "error": "nessun template"}
    from ..tonverk import db, inspect, project
    try:
        kv = db.read(path)
        info = project.analyze(kv)
        sm = inspect.summarize(kv)
    except Exception as e:  # noqa: BLE001 - shown to the user
        return {"ok": False, "error": str(e)}
    return {"ok": True, "presets": len(info.preset_nodes), "patterns": len(sm["patterns"]),
            "samples": len(sm["samples"]), "source_pattern": info.source_pattern,
            "trig_format_known": info.widths_detected, "warnings": info.warnings,
            "removable": appsupport.on_removable_volume(path)}


def _result(out_root: str, bundle: str, song: Song, layout, engine: str, warnings, stats, project_dir) -> dict:
    rel = os.path.relpath(bundle, out_root)
    return {
        "title": song.title, "engine": engine, "bpm": song.bpm, "key": song.key,
        "scale": song.scale, "patterns": len(song.patterns),
        "duration": round(song.duration_seconds()), "project": bool(project_dir),
        "bundle": rel, "bundle_path": bundle, "project_path": project_dir,
        "sheet": f"/out/{rel}/arrangiamento.html", "preview": f"/out/{rel}/preview_gm.mid",
        "zip": f"/zip/{rel}", "warnings": warnings, "song": song.to_dict(), "stats": stats,
        "player": preview_data(song, layout),
    }


class App:
    """Server state shared by the request handlers."""

    def __init__(self, out_root: str, template: str | None, app_mode: bool = False):
        self.out_root = os.path.abspath(out_root)
        os.makedirs(self.out_root, exist_ok=True)
        self.template = template
        self.app_mode = app_mode
        self.token = secrets.token_urlsafe(24)
        self.port = 0


def make_handler(app: App):
    class H(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        # -------------------------------------------------------- plumbing
        def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj):
            self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

        def _host_ok(self) -> bool:
            host = (self.headers.get("Host") or "").split(":")[0]
            return host in ("127.0.0.1", "localhost")

        def _authorized(self) -> bool:
            return self._host_ok() and secrets.compare_digest(
                self.headers.get("X-TVGen-Token", ""), app.token)

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length", "0") or 0)
            data = json.loads(self.rfile.read(n) or b"{}")
            return data if isinstance(data, dict) else {}

        # -------------------------------------------------------- GET
        def do_GET(self):
            if not self._host_ok():
                return self._json(403, {"error": "host non consentito"})
            u = urlparse(self.path)
            path = unquote(u.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if path in ("/", "/index.html"):
                with open(os.path.join(HERE, "index.html"), encoding="utf-8") as f:
                    page = f.read()
                page = page.replace("__TVGEN_TOKEN__", app.token).replace(
                    "__TVGEN_APP__", "true" if app.app_mode else "false")
                return self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")
            if path.startswith("/out/"):
                p = _safe_join(app.out_root, path[5:])
                if not p or not os.path.isfile(p):
                    return self._json(404, {"error": "non trovato"})
                ctype = {".html": "text/html; charset=utf-8", ".json": "application/json",
                         ".mid": "audio/midi"}.get(os.path.splitext(p)[1], "application/octet-stream")
                with open(p, "rb") as f:
                    return self._send(200, f.read(), ctype)
            if path.startswith("/zip/"):
                p = _safe_join(app.out_root, path[5:])
                if not p or not os.path.isdir(p) or p == os.path.realpath(app.out_root):
                    return self._json(404, {"error": "non trovato"})
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                    for d, _, files in os.walk(p):
                        for fn in files:
                            full = os.path.join(d, fn)
                            z.write(full, os.path.relpath(full, os.path.dirname(p)))
                name = os.path.basename(p)
                return self._send(200, buf.getvalue(), "application/zip",
                                  {"Content-Disposition": f'attachment; filename="{name}.zip"'})
            if not path.startswith("/api/"):
                return self._json(404, {"error": "non trovato"})
            if not self._authorized():
                return self._json(403, {"error": "non autorizzato"})
            if path == "/api/status":
                st = appsupport.load_settings()
                key = os.environ.get("ANTHROPIC_API_KEY")
                return self._json(200, {
                    "claude": has_claude_credentials(), "key_hint": appsupport.masked(key),
                    "template": st.get("template") or app.template or "",
                    "engine": st.get("engine", "auto"), "app": app.app_mode,
                    "mac": appsupport.IS_MAC, "out_root": app.out_root,
                })
            if path == "/api/template":
                return self._json(200, _template_info(q.get("path")))
            if path == "/api/history":
                return self._json(200, {"items": self._history()})
            if path == "/api/load":
                p = _safe_join(app.out_root, q.get("bundle", ""))
                if not p or not os.path.isfile(os.path.join(p, "song.json")):
                    return self._json(404, {"error": "non trovato"})
                return self._load(p)
            return self._json(404, {"error": "non trovato"})

        def _history(self):
            items = []
            for name in os.listdir(app.out_root):
                p = os.path.join(app.out_root, name)
                sj = os.path.join(p, "song.json")
                if os.path.isfile(sj):
                    try:
                        with open(sj, encoding="utf-8") as f:
                            d = json.load(f)
                    except (OSError, json.JSONDecodeError):
                        continue
                    items.append({"bundle": name, "title": d.get("title", name),
                                  "bpm": d.get("bpm"), "genre": d.get("genre", ""),
                                  "mtime": os.path.getmtime(sj),
                                  "project": os.path.isdir(os.path.join(p, name))})
            items.sort(key=lambda x: -x["mtime"])
            return items[:50]

        def _load(self, bundle: str):
            name = os.path.basename(bundle)
            layout_file = os.path.join(bundle, "layout.json")
            layout = load_layout(layout_file if os.path.isfile(layout_file) else None)
            with open(os.path.join(bundle, "song.json"), encoding="utf-8") as f:
                song = Song.from_json(f.read(), layout)
            pdir = os.path.join(bundle, name)
            return self._json(200, _result(app.out_root, bundle, song, layout, "salvato", [], {},
                                           pdir if os.path.isdir(pdir) else None))

        # -------------------------------------------------------- POST
        def do_POST(self):
            if not self._authorized():
                return self._json(403, {"error": "non autorizzato"})
            path = urlparse(self.path).path
            try:
                req = self._body()
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "richiesta non valida"})
            try:
                if path == "/api/generate":
                    return self._generate(req)
                if path == "/api/settings":
                    st = appsupport.save_settings(req)
                    if "api_key" in req:
                        key = (req.get("api_key") or "").strip() or None
                        stored = appsupport.keychain_set(key)
                        appsupport.apply_api_key(key)
                        st["key_stored"] = stored
                    st["key_hint"] = appsupport.masked(os.environ.get("ANTHROPIC_API_KEY"))
                    st["claude"] = has_claude_credentials()
                    return self._json(200, st)
                if path == "/api/reveal":
                    p = _safe_join(app.out_root, req.get("bundle", ""))
                    return self._json(200, {"ok": bool(p) and appsupport.reveal(p)})
                if path == "/api/open":
                    p = _safe_join(app.out_root, req.get("path", ""))
                    return self._json(200, {"ok": bool(p) and appsupport.open_path(p)})
                if path == "/api/copy-to-card":
                    p = _safe_join(app.out_root, req.get("bundle", ""))
                    if not p:
                        return self._json(400, {"error": "bundle non valido"})
                    proj = os.path.join(p, os.path.basename(p))
                    tmpl = req.get("template") or ""
                    dest = appsupport.copy_next_to_template(proj, tmpl)
                    appsupport.reveal(dest)
                    return self._json(200, {"ok": True, "dest": dest})
            except Exception as e:  # noqa: BLE001 - reported to the page
                traceback.print_exc()
                return self._json(500, {"error": str(e)})
            return self._json(404, {"error": "non trovato"})

        def _generate(self, req: dict):
            template = (req.get("template") or app.template or "").strip() or None
            layout = load_layout(None, template)
            with _lock:
                if req.get("song") and req.get("revise"):
                    from .. import llm
                    song = Song.from_dict(req["song"], layout)
                    song = llm.revise(song, req["revise"], layout)
                    engine = "claude"
                else:
                    prompt = (req.get("prompt") or "").strip()
                    if not prompt:
                        return self._json(400, {"error": "scrivi il prompt della canzone"})
                    song, engine = make_song(prompt, layout, req.get("engine") or "auto")
                out = build_output(song, layout, app.out_root, template,
                                   quantize=bool(req.get("quantize")))
            appsupport.save_settings({"template": template or "", "engine": req.get("engine") or "auto"})
            return self._json(200, _result(app.out_root, out.bundle, song, layout, engine,
                                           out.warnings, out.stats, out.project))
    return H


def make_server(host: str, port: int, out_root: str, template: str | None, app_mode: bool = False):
    app = App(out_root, template, app_mode)
    httpd = ThreadingHTTPServer((host, port), make_handler(app))
    app.port = httpd.server_address[1]
    httpd.app = app
    return httpd


def serve(host: str, port: int, out_root: str, template: str | None):
    httpd = make_server(host, port, out_root, template)
    print(f"Tonverk generator su http://{host}:{httpd.app.port}  (Ctrl+C per uscire)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
