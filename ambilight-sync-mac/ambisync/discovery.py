"""Scan of the home network: Philips TV and LED strips of every supported brand."""
from __future__ import annotations

import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor

from . import netutil, tv as tvmod
from .lights import DRIVERS

SWEEP_PORTS = [80, tvmod.HTTP_PORT, tvmod.HTTPS_PORT, 5577, 6668, 55443]
HINT_PORTS = {
    5577: "Magic Home",
    6668: "Tuya / Smart Life",
    55443: "Yeelight",
}


def normalize(name: str) -> str:
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"([a-z])(\d)", r"\1 \2", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def match_target(name: str, targets) -> str | None:
    """Match a device name ("Mensola1", "Striscia tavolo") to one of the user's names."""
    n = normalize(name)
    if not n:
        return None
    for t in targets:
        if normalize(t) == n:
            return t
    hits = [t for t in targets if re.search(rf"(^| ){re.escape(normalize(t))}( |$)", n)]
    return hits[0] if len(hits) == 1 else None


def scan(cfg_data: dict | None = None, progress=None, timeout: float = 3.0) -> dict:
    """Full scan. Returns tvs, lights, unlinked Hue bridges, unknown devices and warnings."""
    cfg_data = cfg_data or {}
    say = progress or (lambda msg: None)
    started = time.monotonic()
    result = {"tvs": [], "lights": [], "hue_bridges": [], "hints": [], "warnings": [], "local_ip": None,
              "duration": 0.0}

    local_ip = netutil.local_ipv4()
    result["local_ip"] = local_ip
    if not local_ip:
        result["warnings"].append("Il Mac non sembra collegato a una rete locale (Wi-Fi o cavo).")
        return result
    if netutil.local_network_blocked():
        result["warnings"].append(
            "macOS blocca l'accesso alla rete locale: apri Impostazioni di Sistema > Privacy e sicurezza > "
            "Rete locale e attiva 'Ambilight Sync' (o 'Terminale'), poi riprova.")

    ctx = {
        "hue_bridges": cfg_data.get("hue_bridges") or {},
        "tuya_devices": cfg_data.get("tuya_devices") or {},
    }

    # 1) UDP discoveries (in parallel) + SSDP
    udp_results: dict = {}

    def run_udp(name):
        module, _ = DRIVERS[name]
        try:
            udp_results[name] = module.discover(timeout=timeout, ctx=ctx)
        except Exception as e:  # never let one brand break the scan
            udp_results[name] = []
            result["warnings"].append(f"{name}: {e}")

    say("Cerco le strisce LED (Govee, WiZ, Yeelight, Magic Home, Tuya)...")
    threads = [threading.Thread(target=run_udp, args=(n,), daemon=True)
               for n in ("govee", "wiz", "yeelight", "magichome", "tuya")]
    for t in threads:
        t.start()
    ssdp = netutil.ssdp_search(timeout=2.0)
    ctx["ssdp"] = ssdp

    # 2) TCP sweep of the subnet
    say(f"Scansiono la rete {local_ip.rsplit('.', 1)[0]}.0/24...")
    hosts = sorted(set(netutil.subnet_hosts(local_ip)) | set(ssdp))
    sweep = netutil.sweep(hosts, SWEEP_PORTS, timeout=0.6)
    ctx["sweep"] = sweep

    # 3) Philips TV
    say("Cerco la TV Philips...")
    extra = [cfg_data["tv"]["host"]] if cfg_data.get("tv") else []
    result["tvs"] = tvmod.discover(sweep, extra_hosts=extra)

    # 4) HTTP devices: WLED and Hue
    say("Cerco WLED e Bridge Hue...")
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_wled = ex.submit(DRIVERS["wled"][0].discover, timeout, ctx)
        f_hue = ex.submit(DRIVERS["hue"][0].discover, timeout, ctx)
        wled_found, hue_found = f_wled.result(), f_hue.result()

    for t in threads:
        t.join(timeout + 3)

    lights = []
    for name in ("govee", "wiz", "yeelight", "magichome", "tuya"):
        lights += udp_results.get(name, [])
    lights += wled_found + hue_found
    seen = set()
    unique = []
    for d in lights:
        if d["id"] not in seen:
            seen.add(d["id"])
            unique.append(d)
    result["lights"] = unique

    linked = {k.lower() for k, v in (cfg_data.get("hue_bridges") or {}).items() if v.get("username")}
    result["hue_found"] = ctx.get("hue_found", [])
    result["hue_bridges"] = [b for b in result["hue_found"] if b["id"] not in linked]

    # 5) Devices that answer on a known port but were not identified
    light_ips = {d["ip"] for d in unique}
    tv_ips = {t["host"] for t in result["tvs"]}
    for ip, ports in sorted(sweep.items()):
        if ip in light_ips or ip in tv_ips:
            continue
        for port, brand in HINT_PORTS.items():
            if port in ports:
                result["hints"].append({"ip": ip, "brand": brand, "port": port})

    result["duration"] = round(time.monotonic() - started, 1)
    return result
