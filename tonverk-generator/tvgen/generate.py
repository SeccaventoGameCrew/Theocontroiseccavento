"""Pipeline: prompt -> Song -> Tonverk project + exports."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

from . import composer
from .export.midi import write_midi
from .export.sheet import write_sheet
from .export.songverk import write_songverk
from .layout import Layout
from .spec import Song


def has_claude_credentials() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                or os.environ.get("ANTHROPIC_PROFILE")
                or os.path.isdir(os.path.expanduser("~/.config/anthropic")))


def make_song(prompt: str, layout: Layout, engine: str = "auto", model: str | None = None,
              seed: int | None = None, effort: str = "high") -> tuple[Song, str]:
    """Returns (song, engine actually used)."""
    if engine == "auto":
        engine = "claude" if has_claude_credentials() else "offline"
    if engine == "offline":
        return composer.compose(prompt, layout, seed=seed), "offline"
    from . import llm
    return llm.compose(prompt, layout, model=model or llm.DEFAULT_MODEL, effort=effort), "claude"


def project_name(title: str) -> str:
    n = re.sub(r"[^A-Z0-9 _-]", "", title.upper()).strip()
    n = re.sub(r"\s+", " ", n)[:20].strip()
    return n or "SONG"


@dataclass
class Output:
    bundle: str
    project: str | None
    files: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def build_output(song: Song, layout: Layout, out_root: str, template_dir: str | None = None,
                 quantize: bool = False, name: str | None = None) -> Output:
    name = project_name(name or song.title)
    os.makedirs(out_root, exist_ok=True)
    bundle = os.path.join(out_root, name)
    i = 2
    while os.path.exists(bundle):
        bundle = os.path.join(out_root, f"{name}-{i}")
        i += 1
    os.makedirs(bundle)
    out = Output(bundle=bundle, project=None, warnings=list(song.warnings))

    if template_dir:
        from .tonverk import db, project
        tkv = db.read(template_dir)
        final, report = project.build(tkv, song, layout, quantize=quantize)
        pdir = os.path.join(bundle, name)
        out.stats = db.write_project(template_dir, pdir, final)
        out.stats.update({"trigs": report.trigs, "notes": report.notes,
                          "source_pattern": report.template.source_pattern})
        out.project = pdir
        out.warnings += report.warnings
    else:
        out.warnings.append("nessun template indicato: generati solo arrangiamento, MIDI e JSON "
                            "(nessun progetto Tonverk)")

    files = {
        "song": os.path.join(bundle, "song.json"),
        "sheet": os.path.join(bundle, "arrangiamento.html"),
        "midi": os.path.join(bundle, "song.mid"),
        "preview": os.path.join(bundle, "preview_gm.mid"),
        "songverk": os.path.join(bundle, "songverk.json"),
    }
    with open(files["song"], "w", encoding="utf-8") as f:
        f.write(song.to_json())
    write_midi(song, layout, files["midi"])
    write_midi(song, layout, files["preview"], gm=True)
    write_songverk(song, files["songverk"])
    write_sheet(song, layout, files["sheet"], name, out.warnings)
    with open(os.path.join(bundle, "layout.json"), "w", encoding="utf-8") as f:
        json.dump(layout.to_dict(), f, indent=2, ensure_ascii=False)
    out.files = files
    return out
