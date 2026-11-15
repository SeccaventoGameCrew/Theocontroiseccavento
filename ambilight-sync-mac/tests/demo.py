"""Panel demo with simulated TV and strips (no real devices needed).

    python3 tests/demo.py        -> http://127.0.0.1:8799/
"""
from __future__ import annotations

import colorsys
import os
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from ambisync import tv as tvmod  # noqa: E402
from ambisync.app import App, serve  # noqa: E402
from ambisync.config import Config  # noqa: E402
from ambisync.lights import govee, magichome, wiz, wled, yeelight  # noqa: E402
from fakes import FakeGovee, FakeMagicHome, FakeTV, FakeWiz, FakeWLED, FakeYeelight, free_udp_port  # noqa: E402


def main(port: int = 8799) -> None:
    home = tempfile.mkdtemp(prefix="ambisync-demo-")
    cfg = Config(os.path.join(home, "config.json"))
    fake_tv = FakeTV(tls=True, pairing=True, name="Philips 55OLED807")
    listen = free_udp_port()
    fakes = [FakeGovee(listen), FakeWiz(), FakeWLED(count=30, name="Mensola 2"), FakeYeelight(), FakeMagicHome()]
    g, z, w, y, m = fakes

    def scanner(cfg_data, progress):
        progress("Cerco le strisce LED...")
        time.sleep(1.2)
        lights = govee.discover(0.4, target="127.0.0.1", scan_port=g.scan_port, listen_port=listen)
        for d in lights:
            d["extra"]["port"] = g.port
        lights += wiz.discover(0.4, destinations=[("127.0.0.1", z.port)])
        lights.append(wled.probe("127.0.0.1", w.http_port))
        lights += yeelight.discover(0.4, destinations=[("127.0.0.1", y.disc.port)])
        mh = magichome.discover(0.4, destinations=[("127.0.0.1", m.disc.port)])
        for d in mh:
            d["extra"]["port"] = m.port
        lights += mh
        t = tvmod.PhilipsTV("127.0.0.1", tls=True, port=fake_tv.port, api=6)
        t.detect()
        info = tvmod.describe(t)
        return {"tvs": [info], "lights": lights, "hue_bridges": [{"id": "x", "ip": "192.168.1.2", "name": "Hue Bridge"}],
                "hints": [{"ip": "192.168.1.77", "brand": "Tuya / Smart Life", "port": 6668}], "warnings": [],
                "local_ip": "192.168.1.10", "duration": 1.2}

    # pre-pair the simulated TV
    t = tvmod.PhilipsTV("127.0.0.1", tls=True, port=fake_tv.port, api=6)
    t.pair_request()
    t.pair_grant(FakeTV.PIN)
    conf = t.to_config()
    conf.update(pairing_required=True, ambilight_features=t.ambilight_features)
    cfg.tv = conf

    def animate():
        hue = 0.0
        while True:
            hue = (hue + 0.01) % 1
            fake_tv.color = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(hue, 0.9, 0.95))
            time.sleep(0.1)

    threading.Thread(target=animate, daemon=True).start()
    app = App(cfg, scanner=scanner)
    print(f"Demo: http://127.0.0.1:{port}/  (config {cfg.path})")
    serve(app, port)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8799)
