"""Small networking helpers built only on the Python standard library."""
from __future__ import annotations

import errno
import hashlib
import http.client
import ipaddress
import json
import os
import socket
import ssl
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import parse_http_list, parse_keqv_list

SSDP_ADDR = ("239.255.255.250", 1900)


# --------------------------------------------------------------------------
# Local network
# --------------------------------------------------------------------------
def local_ipv4(target: str = "8.8.8.8") -> str | None:
    """IP address of the interface used to reach `target` (no packet is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((target, 9))
        ip = s.getsockname()[0]
    except OSError:
        ip = None
    finally:
        s.close()
    if ip and not ip.startswith("127."):
        return ip
    try:
        ip = socket.gethostbyname(socket.gethostname())
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


def subnet_hosts(ip: str, prefix: int = 24) -> list[str]:
    net = ipaddress.ip_network(f"{ip}/{prefix}", strict=False)
    return [str(h) for h in net.hosts() if str(h) != ip]


def broadcast_address(ip: str, prefix: int = 24) -> str:
    return str(ipaddress.ip_network(f"{ip}/{prefix}", strict=False).broadcast_address)


def local_network_blocked() -> bool:
    """True when macOS 'Local Network' privacy settings block this process.

    When the permission is denied, sending to any LAN address fails at once
    with EHOSTUNREACH ('No route to host').
    """
    ip = local_ipv4()
    if not ip:
        return False
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(b"\0", (broadcast_address(ip), 9))
        return False
    except OSError as e:
        return e.errno in (errno.EHOSTUNREACH, errno.EPERM, errno.EACCES)
    finally:
        s.close()


def port_open(host: str, port: int, timeout: float = 0.6) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def sweep(hosts, ports, timeout: float = 0.6, workers: int = 64) -> dict[str, set]:
    """TCP connect scan. Returns {host: {open ports}}."""
    pairs = [(h, p) for h in hosts for p in ports]
    found: dict[str, set] = {}
    if not pairs:
        return found
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for (h, p), ok in zip(pairs, ex.map(lambda hp: port_open(hp[0], hp[1], timeout), pairs)):
            if ok:
                found.setdefault(h, set()).add(p)
    return found


def ssdp_search(st: str = "ssdp:all", timeout: float = 2.0, addr=SSDP_ADDR) -> dict[str, str]:
    """M-SEARCH; returns {ip: raw response text} (last response per IP)."""
    msg = (
        "M-SEARCH * HTTP/1.1\r\n"
        f"HOST: {addr[0]}:{addr[1]}\r\n"
        'MAN: "ssdp:discover"\r\n'
        "MX: 1\r\n"
        f"ST: {st}\r\n\r\n"
    ).encode()
    return udp_collect(msg, [addr], timeout, decode=True)


def udp_collect(payload: bytes, destinations, timeout: float, bind_port: int = 0,
                decode: bool = False, repeat: int = 2) -> dict:
    """Send a UDP datagram (broadcast/multicast/unicast) and collect replies by IP."""
    replies: dict = {}
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            try:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except OSError:
                pass
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        s.bind(("", bind_port))
        for _ in range(repeat):
            for dest in destinations:
                try:
                    s.sendto(payload, dest)
                except OSError:
                    pass
        end = time.monotonic() + timeout
        while True:
            left = end - time.monotonic()
            if left <= 0:
                break
            s.settimeout(left)
            try:
                data, (ip, _port) = s.recvfrom(65535)
            except socket.timeout:
                break
            except OSError:
                break
            if data == payload:
                continue  # our own multicast echo
            replies[ip] = data.decode("utf-8", "replace") if decode else data
    finally:
        s.close()
    return replies


def broadcast_destinations(port: int) -> list[tuple[str, int]]:
    dests = [("255.255.255.255", port)]
    ip = local_ipv4()
    if ip:
        dests.insert(0, (broadcast_address(ip), port))
    return dests


# --------------------------------------------------------------------------
# HTTP client with keep-alive, digest auth and certificate pinning
# --------------------------------------------------------------------------
class PinMismatch(Exception):
    """The TLS certificate changed since pairing."""


def parse_challenge(header: str) -> dict:
    scheme, _, rest = header.partition(" ")
    return parse_keqv_list(parse_http_list(rest)) if scheme.lower() == "digest" else {}


def _hasher(algorithm: str):
    algo = algorithm.upper().replace("-SESS", "")
    return {"MD5": hashlib.md5, "SHA-256": hashlib.sha256, "SHA-512-256": hashlib.sha512}.get(algo, hashlib.md5)


class HttpClient:
    """Persistent HTTP(S) connection to one device.

    TLS: Philips TVs and Hue bridges use self-signed certificates that cannot
    be validated against a CA, so the certificate fingerprint is pinned on
    first use (trust-on-first-use) and checked on every new connection.
    """

    def __init__(self, host: str, port: int, tls: bool = False, *, user: str | None = None,
                 password: str | None = None, fingerprint: str | None = None, timeout: float = 3.0):
        self.host, self.port, self.tls = host, port, tls
        self.user, self.password = user, password
        self.fingerprint = fingerprint
        self.seen_fingerprint: str | None = None
        self.timeout = timeout
        self._conn: http.client.HTTPConnection | None = None
        self._challenge: dict | None = None
        self._nc = 0
        self._lock = threading.Lock()

    # -- connection --------------------------------------------------------
    def _connect(self) -> None:
        if self.tls:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE  # identity is checked by fingerprint pinning below
            try:
                ctx.set_ciphers("DEFAULT:@SECLEVEL=1")  # older TVs use legacy ciphers
            except ssl.SSLError:
                pass
            conn = http.client.HTTPSConnection(self.host, self.port, timeout=self.timeout, context=ctx)
            conn.connect()
            der = conn.sock.getpeercert(binary_form=True) or b""
            fp = hashlib.sha256(der).hexdigest()
            if self.fingerprint and fp != self.fingerprint:
                conn.close()
                raise PinMismatch(f"certificato di {self.host} cambiato")
            self.seen_fingerprint = fp
        else:
            conn = http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)
            conn.connect()
        self._conn = conn

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except OSError:
                pass
        self._conn = None

    # -- digest ------------------------------------------------------------
    def _digest_header(self, method: str, uri: str) -> str:
        ch = self._challenge or {}
        realm, nonce = ch.get("realm", ""), ch.get("nonce", "")
        algorithm = ch.get("algorithm", "MD5")
        H = _hasher(algorithm)

        def h(text: str) -> str:
            return H(text.encode()).hexdigest()

        self._nc += 1
        nc = f"{self._nc:08x}"
        cnonce = os.urandom(8).hex()
        ha1 = h(f"{self.user}:{realm}:{self.password}")
        if algorithm.upper().endswith("-SESS"):
            ha1 = h(f"{ha1}:{nonce}:{cnonce}")
        ha2 = h(f"{method}:{uri}")
        qop_options = [q.strip() for q in ch.get("qop", "").split(",") if q.strip()]
        if qop_options:
            qop = "auth" if "auth" in qop_options else qop_options[0]
            response = h(f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}")
        else:
            qop = None
            response = h(f"{ha1}:{nonce}:{ha2}")
        parts = [
            f'username="{self.user}"', f'realm="{realm}"', f'nonce="{nonce}"',
            f'uri="{uri}"', f'response="{response}"', f"algorithm={algorithm}",
        ]
        if "opaque" in ch:
            parts.append(f'opaque="{ch["opaque"]}"')
        if qop:
            parts += [f"qop={qop}", f"nc={nc}", f'cnonce="{cnonce}"']
        return "Digest " + ", ".join(parts)

    # -- requests ----------------------------------------------------------
    def request(self, method: str, path: str, body=None, auth: bool = True,
                timeout: float | None = None) -> tuple[int, bytes]:
        data = json.dumps(body).encode() if body is not None else None
        use_auth = auth and self.user is not None
        with self._lock:
            network_errors = 0
            auth_rounds = 0
            while True:
                try:
                    if self._conn is None:
                        self._connect()
                    if timeout is not None and self._conn.sock is not None:
                        self._conn.sock.settimeout(timeout)
                    headers = {"Accept": "application/json"}
                    if data is not None:
                        headers["Content-Type"] = "application/json"
                    if use_auth and self._challenge:
                        headers["Authorization"] = self._digest_header(method, path)
                    self._conn.request(method, path, body=data, headers=headers)
                    resp = self._conn.getresponse()
                    payload = resp.read()
                    if resp.will_close:
                        self.close()
                    if resp.status == 401 and use_auth and auth_rounds < 2:
                        challenge = parse_challenge(resp.getheader("WWW-Authenticate", ""))
                        if challenge:
                            stale = challenge.get("stale", "").lower() == "true"
                            same = self._challenge and challenge.get("nonce") == self._challenge.get("nonce")
                            if not same or stale:
                                self._challenge, self._nc = challenge, 0
                                auth_rounds += 1
                                continue
                    if timeout is not None and self._conn is not None and self._conn.sock is not None:
                        self._conn.sock.settimeout(self.timeout)
                    return resp.status, payload
                except PinMismatch:
                    raise
                except (OSError, http.client.HTTPException):
                    self.close()
                    network_errors += 1
                    if network_errors >= 2:
                        raise

    def get_json(self, path: str, **kw):
        status, payload = self.request("GET", path, **kw)
        return status, _loads(payload)

    def post_json(self, path: str, body, **kw):
        status, payload = self.request("POST", path, body=body, **kw)
        return status, _loads(payload)

    def put_json(self, path: str, body, **kw):
        status, payload = self.request("PUT", path, body=body, **kw)
        return status, _loads(payload)


def _loads(payload: bytes):
    text = payload.decode("utf-8", "replace").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        # Some Philips firmwares return slightly broken JSON.
        fixed = text.replace("{,", "{").replace(",}", "}")
        while ",," in fixed:
            fixed = fixed.replace(",,", ",")
        try:
            return json.loads(fixed)
        except ValueError:
            return None


def http_get_json(host: str, path: str, port: int = 80, timeout: float = 1.5):
    """One-shot GET returning parsed JSON or None."""
    client = HttpClient(host, port, timeout=timeout)
    try:
        status, data = client.get_json(path)
        return data if status == 200 else None
    except (OSError, http.client.HTTPException):
        return None
    finally:
        client.close()
