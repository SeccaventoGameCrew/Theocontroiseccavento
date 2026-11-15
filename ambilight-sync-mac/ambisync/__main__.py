"""Command line entry point.

    python3 -m ambisync            # starts the app and opens the panel in the browser
    python3 -m ambisync scan       # network report: TV, Ambilight colours, LED strips
    python3 -m ambisync pair       # pairs the TV from the terminal (PIN)
    python3 -m ambisync verify     # checks that the paired TV exposes Ambilight colours
"""
from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import webbrowser

from . import APP_NAME, __version__, colors, discovery
from .config import Config
from .tv import NeedsPairing, PhilipsTV, TVError, verify


def _ping(port: int) -> bool:
    from .netutil import http_get_json
    data = http_get_json("127.0.0.1", "/api/ping", port=port, timeout=1.0)
    return isinstance(data, dict) and data.get("app") == "ambisync"


def cmd_serve(args) -> int:
    from .app import App, serve

    url = f"http://127.0.0.1:{args.port}/"
    if _ping(args.port):
        print(f"{APP_NAME} è già in esecuzione: apro il pannello {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return 0
    cfg = Config(args.config)
    app = App(cfg)

    def on_signal(signum, frame):
        app.quit.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    def ready(port):
        print(f"{APP_NAME} {__version__} - pannello: http://127.0.0.1:{port}/  (configurazione: {cfg.path})")
        app.startup()
        if not args.no_browser:
            webbrowser.open(f"http://127.0.0.1:{port}/")

    try:
        serve(app, args.port, ready)
    except OSError as e:
        print(f"Impossibile avviare il pannello sulla porta {args.port}: {e}", file=sys.stderr)
        return 1
    return 0


def _swatch(rgb) -> str:
    r, g, b = colors.to_int(rgb)
    return f"\x1b[48;2;{r};{g};{b}m    \x1b[0m {colors.to_hex(rgb)}" if sys.stdout.isatty() else colors.to_hex(rgb)


def cmd_scan(args) -> int:
    cfg = Config(args.config)
    print(f"{APP_NAME} - ricerca nella rete di casa (circa 10 secondi)...\n")
    res = discovery.scan(cfg.snapshot(), progress=lambda m: print("  ·", m))
    print(f"\nIl Mac è a {res['local_ip']}  (ricerca durata {res['duration']} s)")
    for w in res["warnings"]:
        print(f"  ATTENZIONE: {w}")

    print("\n=== TV Philips ===")
    if not res["tvs"]:
        print("  Nessuna TV Philips trovata. È accesa e sulla stessa rete del Mac?")
    for info in res["tvs"]:
        print(f"  {info['name'] or 'TV Philips'} a {info['host']} - API v{info['api']} "
              f"({'https' if info['tls'] else 'http'}), Ambilight: {', '.join(info['ambilight_features']) or '?'}")
        saved = cfg.tv if cfg.tv and cfg.tv.get("host") == info["host"] else None
        tv = PhilipsTV.from_config(saved) if saved else PhilipsTV(info["host"])
        try:
            frame = tv.frame("processed")
            n = sum(len(v) for v in frame.values())
            print(f"  ✓ La TV espone i colori Ambilight: {n} LED "
                  f"(sx {len(frame['left'])}, alto {len(frame['top'])}, dx {len(frame['right'])}, basso {len(frame['bottom'])})")
            for zone in ("sinistra", "alto", "destra"):
                print(f"      {zone:<9} {_swatch(colors.average(colors.zone_pixels(frame, zone)))}")
        except NeedsPairing:
            print("  • La TV espone l'API Ambilight ma chiede l'abbinamento: esegui  python3 -m ambisync pair")
        except (TVError, OSError) as e:
            print(f"  ✗ Colori Ambilight non leggibili: {e}")
        finally:
            tv.close()

    print("\n=== Strisce LED ===")
    if not res["lights"]:
        print("  Nessuna striscia trovata con i protocolli locali supportati.")
    used = set()
    for d in res["lights"]:
        label = discovery.match_target(d.get("name", ""), cfg.targets)
        tag = f"  -> «{label}»" if label and label not in used else ""
        used.add(label)
        print(f"  {d['brand']:<18} {d['ip']:<15} {d.get('name') or '(senza nome)':<20} {d.get('model', '')}{tag}")
    for b in res["hue_bridges"]:
        print(f"  Bridge Hue da collegare a {b['ip']} ({b['name']}): collegalo dal pannello")
    for h in res["hints"]:
        print(f"  Possibile {h['brand']} a {h['ip']} (porta {h['port']} aperta): vedi README")

    missing = [t for t in cfg.targets if t not in used]
    if missing:
        print(f"\nNomi non ancora associati: {', '.join(missing)}")
        print("Le marche come Govee, WiZ e Magic Home non comunicano il nome scelto in Alexa:")
        print("associali dal pannello col pulsante 'Fai lampeggiare'.")
    if args.json:
        print(json.dumps(res, indent=2, ensure_ascii=False, default=list))
    return 0


def _pick_tv(cfg, host):
    if host:
        return PhilipsTV(host)
    if cfg.tv:
        return PhilipsTV.from_config(cfg.tv)
    print("Cerco la TV...")
    found = discovery.tvmod.discover()
    if not found:
        print("Nessuna TV Philips trovata. Indicala con --host 192.168.x.y")
        return None
    info = found[0]
    print(f"Trovata: {info['name']} a {info['host']}")
    return PhilipsTV(info["host"])


def cmd_pair(args) -> int:
    cfg = Config(args.config)
    tv = _pick_tv(cfg, args.host)
    if tv is None:
        return 1
    try:
        tv.detect()
        if not tv.pairing_required:
            print("Questa TV non richiede abbinamento.")
        else:
            tv.pair_request()
            pin = input("Inserisci il PIN mostrato sulla TV: ").strip()
            tv.pair_grant(pin)
            print("✓ TV abbinata")
        conf = tv.to_config()
        conf["pairing_required"] = tv.pairing_required
        conf["ambilight_features"] = tv.ambilight_features
        cfg.tv = conf
    except TVError as e:
        print(f"Errore: {e}")
        return 1
    return cmd_verify(args)


def cmd_verify(args) -> int:
    cfg = Config(args.config)
    if not cfg.tv:
        print("Nessuna TV salvata: esegui prima  python3 -m ambisync pair")
        return 1
    report = verify(PhilipsTV.from_config(cfg.tv))
    for c in report["checks"]:
        print(f"  {'✓' if c['ok'] else '✗'} {c['label']}: {c['detail']}")
    print("\nRisultato:", "la TV espone i colori Ambilight" if report["ok"] else "colori Ambilight NON disponibili")
    return 0 if report["ok"] else 2


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ambisync", description=f"{APP_NAME}: Ambilight sulle strisce LED di casa")
    p.add_argument("--config", help="file di configurazione alternativo")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd")
    s = sub.add_parser("serve", help="avvia l'app (predefinito)")
    for parser in (p, s):
        parser.add_argument("--port", type=int, default=8765)
        parser.add_argument("--no-browser", action="store_true")
    sc = sub.add_parser("scan", help="cerca TV e strisce nella rete")
    sc.add_argument("--json", action="store_true")
    pr = sub.add_parser("pair", help="abbina la TV")
    pr.add_argument("--host")
    sub.add_parser("verify", help="verifica i colori Ambilight della TV")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    handler = {"scan": cmd_scan, "pair": cmd_pair, "verify": cmd_verify}.get(args.cmd, cmd_serve)
    return handler(args)


if __name__ == "__main__":
    sys.exit(main())
