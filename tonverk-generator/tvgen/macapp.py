"""macOS app: a native window (WebKit, via pywebview) around the local interface.

Start with `python -m tvgen.macapp` or from the bundled "Tonverk Generator.app".
`--selftest` runs a full offline generation without opening a window (used by CI
to check the packaged app).
"""
from __future__ import annotations

import os
import sys
import tempfile
import threading

from . import appsupport


class NativeApi:
    """Functions callable from the page as window.pywebview.api.<name>()."""

    def __init__(self):
        self.window = None

    def pick_folder(self, start: str = ""):
        if not self.window:
            return None
        start = start if start and os.path.isdir(start) else (
            "/Volumes" if os.path.isdir("/Volumes") else os.path.expanduser("~"))
        res = self.window.create_file_dialog(20, directory=start)  # 20 = FileDialog.FOLDER
        if not res:
            return None
        return res[0] if isinstance(res, (list, tuple)) else str(res)


def selftest() -> int:
    """Offline generation on a synthetic template inside the packaged app."""
    from .generate import build_output, make_song
    from .layout import default_layout
    from .tonverk import db, fixture
    from .web.server import make_server

    with tempfile.TemporaryDirectory() as tmp:
        tmpl = fixture.make_synthetic_template(os.path.join(tmp, "TEMPLATE"))
        layout = default_layout()
        song, engine = make_song("techno ipnotica 130 bpm in la minore", layout, "offline")
        out = build_output(song, layout, os.path.join(tmp, "out"), tmpl)
        kv = db.read(out.project)
        assert len(kv) == out.stats["keys"], "verifica chiavi fallita"
        httpd = make_server("127.0.0.1", 0, os.path.join(tmp, "out"), tmpl, app_mode=True)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        import urllib.request
        page = urllib.request.urlopen(f"http://127.0.0.1:{httpd.app.port}/").read()
        httpd.shutdown()
        assert b"TONVERK" in page.upper()
    print(f"selftest ok: {song.title}, {len(song.patterns)} pattern, {out.stats['keys']} chiavi")
    return 0


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--selftest" in argv:
        return selftest()

    if getattr(sys, "frozen", False) or sys.stdout is None:
        # a bundled GUI app has no terminal: keep a log for troubleshooting
        log_dir = os.path.expanduser("~/Library/Logs") if appsupport.IS_MAC else appsupport.support_dir()
        os.makedirs(log_dir, exist_ok=True)
        log = open(os.path.join(log_dir, f"{appsupport.APP_NAME}.log"), "a", buffering=1, encoding="utf-8")
        sys.stdout = sys.stderr = log

    import webview  # pywebview

    from .web.server import make_server

    appsupport.apply_api_key(os.environ.get("ANTHROPIC_API_KEY") or appsupport.keychain_get())
    settings = appsupport.load_settings()
    out_root = appsupport.default_output_dir()
    httpd = make_server("127.0.0.1", 0, out_root, settings.get("template") or None, app_mode=True)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    api = NativeApi()
    window = webview.create_window(
        appsupport.APP_NAME, f"http://127.0.0.1:{httpd.app.port}/", js_api=api,
        width=1180, height=920, min_size=(760, 600),
    )
    api.window = window
    try:
        webview.start(private_mode=False)
    finally:
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
