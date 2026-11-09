"""Command line: `tvgen "una canzone techno ipnotica a 130 bpm" --template ./TEMPLATE`."""
from __future__ import annotations

import argparse
import json
import sys

from .layout import load_layout


def _cmd_generate(a) -> int:
    from .generate import build_output, make_song
    from .spec import Song

    layout = load_layout(a.layout, a.template)
    if a.song:
        with open(a.song, encoding="utf-8") as f:
            song = Song.from_json(f.read(), layout)
        engine = "file"
    else:
        prompt = " ".join(a.prompt).strip()
        if not prompt:
            print("scrivi il prompt della canzone, es: tvgen \"house malinconica a 122 bpm\"", file=sys.stderr)
            return 2
        print(f"Compongo… ({a.engine})", file=sys.stderr)
        song, engine = make_song(prompt, layout, a.engine, a.model, a.seed, a.effort)
        if a.revise:
            from . import llm
            song = llm.revise(song, a.revise, layout, model=a.model or llm.DEFAULT_MODEL, effort=a.effort)
    out = build_output(song, layout, a.out, a.template, quantize=a.quantize, name=a.name)
    mins, secs = divmod(int(round(song.duration_seconds())), 60)
    print(f"\n♪ {song.title} — {song.bpm:g} BPM, {song.key} {song.scale}, {len(song.patterns)} pattern, "
          f"{mins}:{secs:02d}  [motore: {engine}]")
    for r in song.arrangement:
        print(f"   {song.slot_label(song.slot_of(r.pattern))} {song.pattern(r.pattern).name:<12} ×{r.repeats}  {r.label}")
    if out.project:
        print(f"\nProgetto Tonverk: {out.project}")
        print(f"   {out.stats.get('trigs')} trig, {out.stats.get('notes')} note")
    print(f"Foglio arrangiamento: {out.files['sheet']}")
    print(f"Anteprima MIDI (GM):  {out.files['preview']}")
    for w in out.warnings:
        print(f"  ! {w}", file=sys.stderr)
    return 0


def _cmd_inspect(a) -> int:
    from .tonverk import db, inspect, project
    kv = db.read(a.project)
    if a.dump:
        print(inspect.dump(kv))
        return 0
    sm = inspect.summarize(kv)
    if a.json:
        print(json.dumps(sm, indent=2, ensure_ascii=False))
        return 0
    print(inspect.format_summary(sm))
    try:
        info = project.analyze(kv)
        print(f"\nUsabile come template: suoni dal pattern {info.source_pattern} "
              f"({len(info.preset_nodes)} preset), id eventi {info.event_w} cifre"
              f"{'' if info.widths_detected else ' (dedotto)'}")
        for w in info.warnings:
            print(f"  ! {w}")
    except project.TemplateError as e:
        print(f"\nNon usabile come template: {e}")
    return 0


def _cmd_layout(a) -> int:
    layout = load_layout(a.layout, a.template)
    print(json.dumps(layout.to_dict(), indent=2, ensure_ascii=False))
    return 0


def _cmd_web(a) -> int:
    from .web.server import serve
    serve(a.host, a.port, a.out, a.template)
    return 0


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] not in ("generate", "inspect", "layout", "web", "app", "-h", "--help"):
        argv.insert(0, "generate")
    ap = argparse.ArgumentParser(prog="tvgen", description="Generatore di progetti per Elektron Tonverk")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="genera una canzone dal prompt")
    g.add_argument("prompt", nargs="*", help="descrizione della canzone")
    g.add_argument("--template", "-t", help="cartella di un progetto salvato sul Tonverk (suoni)")
    g.add_argument("--out", "-o", default="output", help="cartella di uscita (default: output)")
    g.add_argument("--layout", help="file JSON con i ruoli delle tracce")
    g.add_argument("--engine", choices=["auto", "claude", "offline"], default="auto")
    g.add_argument("--model", help="modello Claude (default claude-opus-5-5)")
    g.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"], default="high")
    g.add_argument("--seed", type=int, help="seed del compositore offline")
    g.add_argument("--song", help="usa un song.json esistente invece del prompt")
    g.add_argument("--revise", help="modifica la canzone generata con questa istruzione (Claude)")
    g.add_argument("--name", help="nome del progetto (default: titolo)")
    g.add_argument("--quantize", action="store_true", help="niente micro-timing: trig sulla griglia")
    g.set_defaults(func=_cmd_generate)

    i = sub.add_parser("inspect", help="riassunto di un progetto Tonverk")
    i.add_argument("project")
    i.add_argument("--json", action="store_true")
    i.add_argument("--dump", action="store_true", help="tutte le chiavi/valori")
    i.set_defaults(func=_cmd_inspect)

    lay = sub.add_parser("layout", help="mostra il layout delle tracce")
    lay.add_argument("--template", "-t")
    lay.add_argument("--layout")
    lay.set_defaults(func=_cmd_layout)

    w = sub.add_parser("web", help="interfaccia web locale")
    w.add_argument("--host", default="127.0.0.1")
    w.add_argument("--port", type=int, default=8765)
    w.add_argument("--out", "-o", default="output")
    w.add_argument("--template", "-t")
    w.set_defaults(func=_cmd_web)

    m = sub.add_parser("app", help="apre l'app desktop (macOS, richiede pywebview)")
    m.set_defaults(func=lambda a: __import__("tvgen.macapp", fromlist=["main"]).main([]))

    a = ap.parse_args(argv)
    try:
        return a.func(a)
    except Exception as e:  # noqa: BLE001 - CLI boundary
        from .llm import ComposerError
        if isinstance(e, (ComposerError, FileNotFoundError, FileExistsError, ValueError, RuntimeError)):
            print(f"errore: {e}", file=sys.stderr)
            return 1
        raise


if __name__ == "__main__":
    sys.exit(main())
