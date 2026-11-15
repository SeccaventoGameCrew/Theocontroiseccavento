"""End-to-end tests with simulated TV and strips.  Run:  python3 -m unittest discover tests"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ambisync import colors, discovery, netutil  # noqa: E402
from ambisync.app import App, serve  # noqa: E402
from ambisync.config import Config  # noqa: E402
from ambisync.engine import SyncEngine  # noqa: E402
from ambisync.lights import govee, hue, magichome, make_light, wiz, wled, yeelight  # noqa: E402
from ambisync.tv import NeedsPairing, PairingError, PhilipsTV, verify  # noqa: E402

from fakes import (FakeGovee, FakeHue, FakeMagicHome, FakeTV, FakeWiz, FakeWLED,  # noqa: E402
                   FakeYeelight, free_udp_port)


def wait_for(cond, timeout=4.0, step=0.05):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(step)
    return cond()


def close(a, b, tol=12):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


class ColorTests(unittest.TestCase):
    frame = {"left": [(255, 0, 0)] * 3, "top": [(1, 1, 1)] * 3 + [(0, 255, 0)] * 3 + [(0, 0, 255)] * 3,
             "right": [(0, 0, 200)] * 3, "bottom": []}

    def test_zones(self):
        self.assertEqual(colors.zone_pixels(self.frame, "alto_sx"), [(1, 1, 1)] * 3)
        self.assertEqual(colors.zone_pixels(self.frame, "alto_centro"), [(0, 255, 0)] * 3)
        self.assertEqual(colors.zone_pixels(self.frame, "alto_dx"), [(0, 0, 255)] * 3)
        # no bottom LEDs on this TV -> whole screen
        self.assertEqual(len(colors.zone_pixels(self.frame, "basso")), 15)

    def test_average_prefers_vivid(self):
        avg = colors.average([(255, 0, 0), (128, 128, 128)])
        self.assertGreater(avg[0], 200)

    def test_split_and_xy(self):
        full, pct = colors.split_brightness((100, 50, 0))
        self.assertEqual(full, (255, 128, 0))
        self.assertAlmostEqual(pct, 39.2, places=1)
        x, y = colors.rgb_to_xy((255, 0, 0))
        self.assertGreater(x, 0.6)

    def test_resample(self):
        out = colors.resample([(0, 0, 0), (255, 255, 255)], 3)
        self.assertEqual(out, [(0, 0, 0), (128, 128, 128), (255, 255, 255)])

    def test_name_matching(self):
        targets = ["mensola 1", "mensola 2", "mensola 3", "tavolo", "salone"]
        self.assertEqual(discovery.match_target("Mensola1", targets), "mensola 1")
        self.assertEqual(discovery.match_target("Striscia Tavolo", targets), "tavolo")
        self.assertEqual(discovery.match_target("Salóne", targets), "salone")
        self.assertIsNone(discovery.match_target("camera", targets))
        self.assertIsNone(discovery.match_target("mensola", targets))


class TVTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeTV(tls=True, pairing=True)

    def tearDown(self):
        self.fake.stop()

    def tv(self, **kw):
        return PhilipsTV("127.0.0.1", tls=True, port=self.fake.port, api=6, **kw)

    def test_pairing_and_frame(self):
        tv = self.tv()
        tv.detect()
        self.assertTrue(tv.pairing_required)
        self.assertIn("Ambilight", tv.ambilight_features)
        self.assertTrue(tv.fingerprint)
        with self.assertRaises(NeedsPairing):
            tv.frame()
        tv.pair_request()
        with self.assertRaises(PairingError):
            tv.pair_grant("0000")
        tv.pair_request()
        tv.pair_grant(FakeTV.PIN)
        frame = tv.frame("processed")
        self.assertEqual(len(frame["left"]), 6)
        self.assertEqual(frame["left"][0], (200, 40, 10))
        # keep-alive + digest nonce reuse: many frames, few challenges
        for _ in range(20):
            tv.frame()
        report = verify(PhilipsTV.from_config(tv.to_config()))
        self.assertTrue(report["ok"], report)
        self.assertTrue(all(c["ok"] for c in report["checks"]), report["checks"])
        self.assertIsNotNone(report["fps"])

    def test_certificate_pinning(self):
        tv = self.tv(fingerprint="00" * 32)
        with self.assertRaises(netutil.PinMismatch):
            tv.detect()

    def test_verify_reports_missing_pairing(self):
        report = verify(self.tv())
        self.assertFalse(report["ok"])
        self.assertTrue(any("abbinamento" in c["detail"] for c in report["checks"] if not c["ok"]))

    def test_plain_http_tv_without_pairing(self):
        fake = FakeTV(tls=False, pairing=False)
        try:
            tv = PhilipsTV("127.0.0.1", tls=False, port=fake.port, api=6)
            self.assertEqual(tv.frame()["right"][0], (20, 60, 220))
        finally:
            fake.stop()

    def test_discover_with_sweep_result(self):
        found = discovery.tvmod.discover({"127.0.0.1": {1926}}, extra_hosts=[])
        # the fake does not listen on 1926, so nothing must be found and nothing must crash
        self.assertEqual(found, [])


class DriverTests(unittest.TestCase):
    def test_govee(self):
        listen = free_udp_port()
        fake = FakeGovee(listen)
        try:
            found = govee.discover(timeout=0.6, target="127.0.0.1", scan_port=fake.scan_port, listen_port=listen)
            self.assertEqual(len(found), 1)
            dev = found[0]
            self.assertEqual(dev["id"], "govee:aa:bb:cc:dd:ee:01")
            dev["extra"]["port"] = fake.port
            light = make_light(dev)
            light.prepare()
            light.set_color((10, 20, 30))
            self.assertTrue(wait_for(lambda: fake.colors() == [(10, 20, 30)]))
            light.close()
        finally:
            fake.stop()

    def test_wiz(self):
        fake = FakeWiz()
        try:
            found = wiz.discover(timeout=0.5, destinations=[("127.0.0.1", fake.port)])
            self.assertEqual(found[0]["model"], "ESP03_SHRGB1W_01")
            light = make_light(found[0])
            light.set_color((0, 0, 128))
            self.assertTrue(wait_for(lambda: any(p.get("b") == 255 for p in fake.pilots())))
            p = [p for p in fake.pilots() if "b" in p][0]
            self.assertEqual(p["dimming"], 50)
            light.close()
        finally:
            fake.stop()

    def test_yeelight_music_mode(self):
        fake = FakeYeelight()
        try:
            found = yeelight.discover(timeout=0.5, destinations=[("127.0.0.1", fake.disc.port)])
            self.assertEqual(found[0]["name"], "salone")
            light = make_light(found[0])
            light.prepare()
            self.assertIsNotNone(light.music)
            self.assertLess(light.min_interval, 0.1)
            light.set_color((255, 0, 0))
            self.assertTrue(wait_for(lambda: any(c["method"] == "set_scene" for c in fake.music_cmds)))
            scene = [c for c in fake.music_cmds if c["method"] == "set_scene"][0]
            self.assertEqual(scene["params"], ["color", 0xFF0000, 100])
            light.close()
        finally:
            fake.stop()

    def test_wled_gradient(self):
        fake = FakeWLED(count=10)
        try:
            dev = wled.probe("127.0.0.1", fake.http_port)
            self.assertEqual(dev["name"], "mensola 2")
            light = make_light(dev)
            light.prepare()
            light.set_pixels([(255, 0, 0), (0, 0, 255)])
            self.assertTrue(wait_for(lambda: len(fake.frames()) == 1))
            px = fake.frames()[0]
            self.assertEqual(len(px), 10)
            self.assertEqual(px[0], (255, 0, 0))
            self.assertEqual(px[-1], (0, 0, 255))
            light.close()
        finally:
            fake.stop()

    def test_magichome(self):
        fake = FakeMagicHome()
        try:
            found = magichome.discover(timeout=0.5, destinations=[("127.0.0.1", fake.disc.port)])
            self.assertEqual(found[0]["model"], "AK001-ZJ2145")
            found[0]["extra"]["port"] = fake.port
            light = make_light(found[0])
            light.prepare()
            light.set_color((1, 2, 3))
            self.assertTrue(wait_for(lambda: len(fake.messages()) >= 2))
            msgs = fake.messages()
            self.assertEqual(msgs[0], bytes([0x71, 0x23, 0x0F, (0x71 + 0x23 + 0x0F) & 0xFF]))
            self.assertEqual(msgs[1][:7], bytes([0x41, 1, 2, 3, 0, 0, 0x0F]))
            self.assertEqual(msgs[1][7], sum(msgs[1][:7]) & 0xFF)
            light.close()
        finally:
            fake.stop()

    def test_hue_link_and_lights(self):
        fake = FakeHue()
        try:
            with self.assertRaises(Exception):
                hue.link("127.0.0.1", fake.port)
            fake.button = True
            user = hue.link("127.0.0.1", fake.port)
            lights = hue.lights_of({"id": "b1", "ip": "127.0.0.1", "port": fake.port, "username": user})
            self.assertEqual([d["name"] for d in lights], ["Tavolo"])  # white-only bulb skipped
            light = make_light(lights[0])
            light.prepare()
            light.set_color((255, 0, 0))
            self.assertEqual(fake.puts[-1][0], "/api/user1/lights/1/state")
            self.assertGreater(fake.puts[-1][1]["xy"][0], 0.6)
            light.close()
        finally:
            fake.stop()


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.cfg = Config(os.path.join(self.dir, "config.json"))
        self.tv = FakeTV(tls=True, pairing=True)
        tv = PhilipsTV("127.0.0.1", tls=True, port=self.tv.port, api=6)
        tv.pair_request()
        tv.pair_grant(FakeTV.PIN)
        self.cfg.tv = tv.to_config()
        self.govee_listen = free_udp_port()
        self.govee = FakeGovee(self.govee_listen)
        self.wiz = FakeWiz()
        self.wled = FakeWLED(count=12)
        self.yee = FakeYeelight()
        mk = lambda d, label, zone, **kw: {**d, "label": label, "zone": zone, "enabled": True, **kw}
        g = govee.discover(timeout=0.5, target="127.0.0.1", scan_port=self.govee.scan_port,
                           listen_port=self.govee_listen)[0]
        g["extra"]["port"] = self.govee.port
        w = wiz.discover(timeout=0.5, destinations=[("127.0.0.1", self.wiz.port)])[0]
        l = wled.probe("127.0.0.1", self.wled.http_port)
        y = yeelight.discover(timeout=0.5, destinations=[("127.0.0.1", self.yee.disc.port)])[0]
        self.cfg.data["lights"] = {
            g["id"]: mk(g, "mensola 1", "sinistra"),
            w["id"]: mk(w, "mensola 3", "destra"),
            l["id"]: mk(l, "mensola 2", "alto", gradient=True),
            y["id"]: mk(y, "salone", "alto_centro"),
        }
        self.cfg.update_settings({"smoothing": 0, "saturation": 1.0, "fps": 20, "off_when_dark": True,
                                  "dark_threshold": 8})
        self.ids = {"govee": g["id"], "wiz": w["id"], "wled": l["id"], "yee": y["id"]}

    def tearDown(self):
        for f in (self.tv, self.govee, self.wiz, self.wled, self.yee):
            f.stop()

    def test_end_to_end(self):
        engine = SyncEngine(self.cfg, relocate=False)
        engine.start()
        try:
            self.assertTrue(wait_for(lambda: engine.state == "attivo", 5), engine.message)
            # Govee follows the left side, WiZ the right side
            self.assertTrue(wait_for(lambda: self.govee.colors() and close(self.govee.colors()[-1], (200, 40, 10))))
            self.assertTrue(wait_for(lambda: any(p.get("b") == 255 and p.get("dimming") > 80
                                                 for p in self.wiz.pilots())))
            # WLED shows the top side as a gradient red -> green -> blue
            self.assertTrue(wait_for(lambda: len(self.wled.frames()) > 0))
            px = self.wled.frames()[-1]
            self.assertEqual(len(px), 12)
            self.assertGreater(px[0][0], 200)
            self.assertGreater(px[-1][2], 200)
            # Yeelight follows the middle of the top side (green)
            self.assertTrue(wait_for(lambda: any(c["method"] == "set_scene" and c["params"][1] == 0x00FF00
                                                 for c in self.yee.music_cmds)), self.yee.music_cmds[-3:])
            # Colour change on the TV propagates
            self.tv.color = (10, 200, 30)
            self.assertTrue(wait_for(lambda: close(self.govee.colors()[-1], (10, 200, 30))))
            # Dark scene -> strips switched off
            self.tv.ambilight_on = False
            self.assertTrue(wait_for(lambda: any(json.loads(r)["msg"] == {"cmd": "turn", "data": {"value": 0}}
                                                 for r in self.govee.received)))
            self.assertTrue(wait_for(lambda: engine.status()["fps"] > 3, 3), engine.status()["fps"])
            status = engine.status()
            self.assertTrue(all(v["error"] is None for v in status["lights"].values()), status["lights"])
        finally:
            engine.stop()

    def test_tv_disappears(self):
        engine = SyncEngine(self.cfg, relocate=False)
        engine.start()
        try:
            self.assertTrue(wait_for(lambda: engine.state == "attivo", 5))
            self.tv.online = False
            self.assertTrue(wait_for(lambda: engine.state == "tv_assente", 6), engine.state)
            self.assertTrue(wait_for(lambda: any(json.loads(r)["msg"] == {"cmd": "turn", "data": {"value": 0}}
                                                 for r in self.govee.received), 8))
            self.tv.online = True
            self.assertTrue(wait_for(lambda: engine.state == "attivo", 8), engine.message)
        finally:
            engine.stop()


class AppHttpTests(unittest.TestCase):
    def setUp(self):
        import threading
        self.dir = tempfile.mkdtemp()
        self.cfg = Config(os.path.join(self.dir, "config.json"))
        self.wled = FakeWLED(count=5, name="Mensola1")
        dev = wled.probe("127.0.0.1", self.wled.http_port)
        scan_result = {"tvs": [], "lights": [dev], "hue_bridges": [], "hints": [], "warnings": [],
                       "local_ip": "127.0.0.1", "duration": 0.1}
        self.app = App(self.cfg, scanner=lambda cfg, progress: scan_result)
        ready = threading.Event()
        self.port = None

        def on_ready(port):
            self.port = port
            ready.set()

        threading.Thread(target=serve, args=(self.app, 0, on_ready), daemon=True).start()
        ready.wait(3)

    def tearDown(self):
        self.app.quit.set()
        self.wled.stop()

    def call(self, path, body=None, headers=None):
        url = f"http://127.0.0.1:{self.port}{path}"
        data = json.dumps(body).encode() if body is not None else None
        h = {"Content-Type": "application/json", "X-Ambisync": "1"} if data is not None else {}
        h.update(headers or {})
        req = urllib.request.Request(url, data=data, headers=h)
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.loads(r.read())

    def test_flow(self):
        state = self.call("/api/state")
        self.assertEqual(state["missing"], ["mensola 1", "mensola 2", "mensola 3", "tavolo", "salone"])
        self.call("/api/scan", {})
        self.assertTrue(wait_for(lambda: not self.call("/api/state")["jobs"]["scan"]["running"]))
        state = self.call("/api/state")
        self.assertEqual(state["lights"][0]["label"], "mensola 1")  # "Mensola1" matched automatically
        self.assertTrue(state["lights"][0]["enabled"])
        self.assertEqual(state["lights"][0]["zone"], "alto_sx")
        lid = state["lights"][0]["id"]
        self.call("/api/lights/update", {"id": lid, "label": "tavolo", "zone": "sinistra"})
        state = self.call("/api/state")
        self.assertEqual(state["lights"][0]["label"], "tavolo")
        self.assertEqual(state["lights"][0]["zone"], "sinistra")
        self.assertIn("mensola 1", state["missing"])
        saved = json.load(open(self.cfg.path))
        self.assertEqual(saved["lights"][lid]["label"], "tavolo")
        self.assertEqual(oct(os.stat(self.cfg.path).st_mode & 0o777), "0o600")
        self.call("/api/settings", {"brightness": 140, "fps": "12"})
        self.assertEqual(self.cfg.settings["brightness"], 100)
        self.assertEqual(self.cfg.settings["fps"], 12)

    def test_security(self):
        # POST without the custom header (what a malicious web page could send) is refused
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/quit", data=b"{}",
                                     headers={"Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=3)
        self.assertEqual(cm.exception.code, 403)
        # DNS rebinding: wrong Host header refused
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/state", headers={"Host": "evil.example"})
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=3)
        self.assertEqual(cm.exception.code, 403)
        self.assertFalse(self.app.quit.is_set())

    def test_index_served(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/", timeout=3) as r:
            self.assertIn(b"Ambilight Sync", r.read())


if __name__ == "__main__":
    unittest.main()
