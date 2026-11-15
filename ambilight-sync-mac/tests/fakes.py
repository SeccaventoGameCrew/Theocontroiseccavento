"""Simulated devices for the tests: Philips TV and LED strips of each brand."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import socket
import ssl
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import parse_http_list, parse_keqv_list

SHARED_KEY = base64.b64decode(
    "ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==")

_CERT_DIR = None


def self_signed_cert():
    global _CERT_DIR
    if _CERT_DIR is None:
        _CERT_DIR = tempfile.mkdtemp(prefix="ambisync-cert-")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
                        "-subj", "/CN=philips-tv", "-keyout", f"{_CERT_DIR}/k.pem", "-out", f"{_CERT_DIR}/c.pem"],
                       check=True, capture_output=True)
    return f"{_CERT_DIR}/c.pem", f"{_CERT_DIR}/k.pem"


def free_udp_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class _Server:
    def stop(self):
        self.running = False
        for attr in ("httpd",):
            srv = getattr(self, attr, None)
            if srv:
                srv.shutdown()
                srv.server_close()
        for s in getattr(self, "sockets", []):
            try:
                s.close()
            except OSError:
                pass


# --------------------------------------------------------------------------
class FakeTV(_Server):
    PIN = "4321"
    REALM = "XTV"

    def __init__(self, tls=True, pairing=True, name="65OLED806/12", host="127.0.0.1", port=0):
        self.tls, self.pairing, self.name = tls, pairing, name
        self.users: dict = {}
        self.pending: dict = {}
        self.nonce = os.urandom(8).hex()
        self.ambilight_on = True
        self.color = (200, 40, 10)  # left side colour; right side is blue-ish, top green
        self.requests = 0
        self.online = True
        self.running = True
        fake = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def _reply(self, status, data=None, headers=None):
                body = json.dumps(data).encode() if data is not None else b""
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)

            def _authorized(self, method):
                if not fake.pairing:
                    return True
                header = self.headers.get("Authorization", "")
                if not header.startswith("Digest "):
                    return False
                p = parse_keqv_list(parse_http_list(header[7:]))
                pw = fake.users.get(p.get("username")) or fake.pending.get(p.get("username"), (None,))[0]
                if not pw or p.get("nonce") != fake.nonce:
                    return False
                md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
                ha1 = md5(f"{p['username']}:{fake.REALM}:{pw}")
                ha2 = md5(f"{method}:{p['uri']}")
                expected = md5(f"{ha1}:{p['nonce']}:{p['nc']}:{p['cnonce']}:{p['qop']}:{ha2}")
                return expected == p.get("response")

            def _challenge(self):
                self._reply(401, {"error": "unauthorized"}, {
                    "WWW-Authenticate": f'Digest realm="{fake.REALM}", qop="auth", nonce="{fake.nonce}", opaque="x"'})

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(n) or b"{}") if n else {}

            def do_GET(self):
                fake.requests += 1
                if not fake.online:
                    self.close_connection = True
                    return
                if self.path == "/6/system":
                    return self._reply(200, fake.system())
                if not self._authorized("GET"):
                    return self._challenge()
                if self.path == "/6/ambilight/topology":
                    return self._reply(200, {"layers": 1, "left": 6, "top": 9, "right": 6, "bottom": 0})
                if self.path in ("/6/ambilight/processed", "/6/ambilight/measured"):
                    return self._reply(200, fake.frame())
                if self.path == "/6/ambilight/power":
                    return self._reply(200, {"power": "On" if fake.ambilight_on else "Off"})
                return self._reply(404, {})

            def do_POST(self):
                body = self._body()
                if self.path == "/6/pair/request":
                    dev = body["device"]["id"]
                    fake.pending[dev] = (os.urandom(16).hex(), int(time.time()))
                    return self._reply(200, {"error_id": "SUCCESS", "auth_key": fake.pending[dev][0],
                                             "timestamp": fake.pending[dev][1], "timeout": 60})
                if self.path == "/6/pair/grant":
                    if not self._authorized("POST"):
                        return self._challenge()
                    a = body["auth"]
                    dev = body["device"]["id"]
                    key, ts = fake.pending[dev]
                    sig = base64.b64encode(hmac.new(SHARED_KEY, str(ts).encode() + a["pin"].encode(),
                                                    hashlib.sha1).digest()).decode()
                    if a["pin"] != fake.PIN or a["auth_signature"] != sig or a["auth_appId"] != "1":
                        return self._reply(200, {"error_id": "INVALID_PIN"})
                    fake.users[dev] = key
                    del fake.pending[dev]
                    return self._reply(200, {"error_id": "SUCCESS"})
                return self._reply(404, {})

        self.httpd = ThreadingHTTPServer((host, port), H)
        self.httpd.daemon_threads = True
        if tls:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(*self_signed_cert())
            self.httpd.socket = ctx.wrap_socket(self.httpd.socket, server_side=True)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def system(self):
        return {
            "name": self.name, "api_version": {"Major": 6, "Minor": 4, "Patch": 0},
            "featuring": {
                "jsonfeatures": {"ambilight": ["LoungeLight", "Hue", "Ambilight", "HueStreaming"]},
                "systemfeatures": {"pairing_type": "digest_auth_pairing" if self.pairing else "none",
                                   "secured_transport": "true" if self.tls else "false"},
            },
        }

    def frame(self):
        r, g, b = self.color if self.ambilight_on else (0, 0, 0)
        side = lambda n, c: {str(i): {"r": c[0], "g": c[1], "b": c[2]} for i in range(n)}
        top = {}
        for i in range(9):  # left third red, middle third green, right third blue
            c = [(250, 0, 0), (0, 250, 0), (0, 0, 250)][i // 3] if self.ambilight_on else (0, 0, 0)
            top[str(i)] = {"r": c[0], "g": c[1], "b": c[2]}
        right = (20, 60, 220) if self.ambilight_on else (0, 0, 0)
        return {"layer1": {"left": side(6, (r, g, b)), "top": top, "right": side(6, right), "bottom": {}}}


# --------------------------------------------------------------------------
class UdpDevice(_Server):
    """Generic UDP device recording every datagram."""

    def __init__(self, handler=None):
        self.received: list = []
        self.sockets = []
        self.running = True
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.sockets.append(self.sock)
        self.handler = handler
        threading.Thread(target=self._loop, args=(self.sock,), daemon=True).start()

    def _loop(self, sock):
        while self.running:
            try:
                data, addr = sock.recvfrom(65535)
            except OSError:
                return
            self.received.append(data)
            if self.handler:
                reply = self.handler(data, addr)
                if reply:
                    payload, dest = reply if isinstance(reply, tuple) else (reply, addr)
                    sock.sendto(payload, dest)


class FakeGovee(UdpDevice):
    def __init__(self, listen_port):
        super().__init__()
        self.listen_port = listen_port
        self.scan = UdpDevice(self._on_scan)
        self.scan_port = self.scan.port

    def _on_scan(self, data, addr):
        msg = {"msg": {"cmd": "scan", "data": {"ip": "127.0.0.1", "device": "AA:BB:CC:DD:EE:01",
                                                 "sku": "H619A"}}}
        return json.dumps(msg).encode(), (addr[0], self.listen_port)

    def colors(self):
        out = []
        for raw in self.received:
            m = json.loads(raw)["msg"]
            if m["cmd"] == "colorwc":
                c = m["data"]["color"]
                out.append((c["r"], c["g"], c["b"]))
        return out

    def stop(self):
        self.scan.stop()
        super().stop()


class FakeWiz(UdpDevice):
    def __init__(self):
        super().__init__(self._on)

    def _on(self, data, addr):
        m = json.loads(data)
        if m["method"] == "getPilot":
            return json.dumps({"method": "getPilot", "result": {"mac": "a8bb50aa0001", "state": True}}).encode()
        if m["method"] == "getSystemConfig":
            return json.dumps({"method": "getSystemConfig", "result": {"moduleName": "ESP03_SHRGB1W_01"}}).encode()
        return None

    def pilots(self):
        return [json.loads(r)["params"] for r in self.received if json.loads(r)["method"] == "setPilot"]


class FakeWLED(UdpDevice):
    def __init__(self, count=20, name="mensola 2", host="127.0.0.1", http_port=0):
        super().__init__()
        self.count, self.name, self.states = count, name, []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _reply(self, data):
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == "/json/info":
                    return self._reply({"ver": "0.14.4", "name": fake.name, "brand": "WLED", "mac": "e8db84aa0002",
                                        "leds": {"count": fake.count}, "udpport": fake.port})
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                fake.states.append(json.loads(self.rfile.read(n)))
                self._reply({"success": True})

        self.httpd = ThreadingHTTPServer((host, http_port), H)
        self.httpd.daemon_threads = True
        self.http_port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def frames(self):
        out = []
        for raw in self.received:
            if raw[0] == 2:
                px = raw[2:]
                out.append([tuple(px[i:i + 3]) for i in range(0, len(px), 3)])
        return out


class TcpDevice(_Server):
    def __init__(self):
        self.received = bytearray()
        self.lines: list = []
        self.running = True
        self.sockets = []
        self.srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(4)
        self.port = self.srv.getsockname()[1]
        self.sockets.append(self.srv)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while self.running:
            try:
                conn, _ = self.srv.accept()
            except OSError:
                return
            self.sockets.append(conn)
            threading.Thread(target=self._client, args=(conn,), daemon=True).start()

    def _client(self, conn):
        buf = b""
        while self.running:
            try:
                data = conn.recv(4096)
            except OSError:
                return
            if not data:
                return
            self.received += data
            buf += data
            while b"\r\n" in buf:
                line, buf = buf.split(b"\r\n", 1)
                self.on_line(conn, line)

    def on_line(self, conn, line):
        pass


class FakeMagicHome(TcpDevice):
    def __init__(self):
        super().__init__()
        self.disc = UdpDevice(lambda d, a: b"127.0.0.1,B4E842AA0003,AK001-ZJ2145" if d == b"HF-A11ASSISTHREAD" else None)

    def messages(self):
        msgs, data, i = [], bytes(self.received), 0
        while i < len(data):
            size = 4 if data[i] == 0x71 else 8
            msgs.append(data[i:i + size])
            i += size
        return msgs

    def stop(self):
        self.disc.stop()
        super().stop()


class FakeYeelight(TcpDevice):
    def __init__(self):
        super().__init__()
        self.music_cmds: list = []
        self.disc = UdpDevice(self._on_search)

    def _on_search(self, data, addr):
        if b"wifi_bulb" not in data:
            return None
        return (f"HTTP/1.1 200 OK\r\nLocation: yeelight://127.0.0.1:{self.port}\r\nid: 0x0000000012345678\r\n"
                f"model: strip6\r\nname: salone\r\nsupport: set_rgb set_scene set_music\r\n\r\n").encode()

    def on_line(self, conn, line):
        cmd = json.loads(line)
        if cmd["method"] == "set_music":
            _, ip, port = cmd["params"]
            back = socket.create_connection((ip, port))
            self.sockets.append(back)
            threading.Thread(target=self._music, args=(back,), daemon=True).start()
        conn.sendall(json.dumps({"id": cmd["id"], "result": ["ok"]}).encode() + b"\r\n")

    def _music(self, sock):
        buf = b""
        while self.running:
            try:
                data = sock.recv(4096)
            except OSError:
                return
            if not data:
                return
            buf += data
            while b"\r\n" in buf:
                line, buf = buf.split(b"\r\n", 1)
                self.music_cmds.append(json.loads(line))

    def stop(self):
        self.disc.stop()
        super().stop()


class FakeHue(_Server):
    def __init__(self):
        self.button = False
        self.puts: list = []
        self.running = True
        fake = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def _reply(self, data):
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(n) or b"{}")

            def do_GET(self):
                if self.path == "/api/config":
                    return self._reply({"name": "Hue Bridge", "bridgeid": "001788FFFE000004", "modelid": "BSB002"})
                if self.path == "/api/user1/lights":
                    return self._reply({
                        "1": {"name": "Tavolo", "uniqueid": "00:17:88:01:00:00:00:04-0b", "modelid": "LST002",
                              "state": {"on": True, "xy": [0.3, 0.3]}},
                        "2": {"name": "Lampadina bianca", "uniqueid": "00:17:88:01:00:00:00:05-0b",
                              "state": {"on": True}},
                    })
                return self._reply([{"error": {"type": 1}}])

            def do_POST(self):
                self._body()
                if self.path == "/api":
                    if not fake.button:
                        return self._reply([{"error": {"type": 101, "description": "link button not pressed"}}])
                    return self._reply([{"success": {"username": "user1"}}])

            def do_PUT(self):
                fake.puts.append((self.path, self._body()))
                self._reply([{"success": {}}])

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
