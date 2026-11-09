"""Local web interface (standard library only). Binds to 127.0.0.1 by default."""
from __future__ import annotations

import io
import json
import os
import threading
import traceback
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

from ..generate import build_output, has_claude_credentials, make_song
from ..layout import load_layout
from ..spec import Song

HERE = os.path.dirname(os.path.abspath(__file__))
_lock = threading.Lock()


def _safe_join(root: str, rel: str) -> str | None:
    p = os.path.realpath(os.path.join(root, rel))
    r = os.path.realpath(root)
    return p if p == r or p.startswith(r + os.sep) else None


def make_handler(out_root: str, default_template: str | None):
    class H(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # quieter console
            pass

        def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj):
            self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            if path in ("/", "/index.html"):
                with open(os.path.join(HERE, "index.html"), "rb") as f:
                    return self._send(200, f.read(), "text/html; charset=utf-8")
            if path == "/api/status":
                return self._json(200, {"claude": has_claude_credentials(), "template": default_template or ""})
            if path.startswith("/out/"):
                p = _safe_join(out_root, path[5:])
                if not p or not os.path.isfile(p):
                    return self._json(404, {"error": "non trovato"})
                ctype = {".html": "text/html; charset=utf-8", ".json": "application/json",
                         ".mid": "audio/midi"}.get(os.path.splitext(p)[1], "application/octet-stream")
                with open(p, "rb") as f:
                    return self._send(200, f.read(), ctype)
            if path.startswith("/zip/"):
                p = _safe_join(out_root, path[5:])
                if not p or not os.path.isdir(p):
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
            return self._json(404, {"error": "non trovato"})

        def do_POST(self):
            path = urlparse(self.path).path
            try:
                n = int(self.headers.get("Content-Length", "0"))
                req = json.loads(self.rfile.read(n) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "richiesta non valida"})
            if path != "/api/generate":
                return self._json(404, {"error": "non trovato"})
            template = (req.get("template") or default_template or "").strip() or None
            try:
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
                    out = build_output(song, layout, out_root, template, quantize=bool(req.get("quantize")))
            except Exception as e:  # noqa: BLE001 - reported to the page
                traceback.print_exc()
                return self._json(500, {"error": str(e)})
            rel = os.path.relpath(out.bundle, out_root)
            return self._json(200, {
                "title": song.title, "engine": engine, "bpm": song.bpm, "key": song.key,
                "scale": song.scale, "patterns": len(song.patterns),
                "duration": round(song.duration_seconds()), "project": bool(out.project),
                "bundle": rel, "sheet": f"/out/{rel}/arrangiamento.html",
                "preview": f"/out/{rel}/preview_gm.mid", "zip": f"/zip/{rel}",
                "warnings": out.warnings, "song": song.to_dict(), "stats": out.stats,
            })
    return H


def serve(host: str, port: int, out_root: str, template: str | None):
    out_root = os.path.abspath(out_root)
    os.makedirs(out_root, exist_ok=True)
    httpd = ThreadingHTTPServer((host, port), make_handler(out_root, template))
    print(f"Tonverk generator su http://{host}:{port}  (Ctrl+C per uscire)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
