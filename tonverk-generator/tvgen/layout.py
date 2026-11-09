"""Track layout of the template project.

The generator never designs sounds: the sounds come from the template project you
prepared on the Tonverk. The layout tells the composer which role each of the 8
audio tracks plays, so the notes it writes match the sounds you loaded.

The layout can be customised with a `tvgen-layout.json` file placed inside the
template project folder (or passed with --layout).
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field

LAYOUT_FILENAME = "tvgen-layout.json"


@dataclass
class TrackSlot:
    track: int            # 1..8 (Tonverk audio tracks)
    role: str             # kick, snare, hats, perc, bass, chords, lead, pad, ...
    kind: str             # "drum" (one-shot, fixed note) | "melodic"
    note: int = 60        # note sent by drum trigs (60 = original sample pitch)
    low: int = 36         # suggested range for melodic tracks (MIDI)
    high: int = 84
    poly: bool = False    # may play chords
    hint: str = ""        # sound loaded in the template (free text, for the composer)


@dataclass
class Layout:
    tracks: list[TrackSlot] = field(default_factory=list)

    def slot(self, track: int) -> TrackSlot | None:
        for s in self.tracks:
            if s.track == track:
                return s
        return None

    def to_dict(self) -> dict:
        return {"tracks": [asdict(t) for t in self.tracks]}

    @classmethod
    def from_dict(cls, d: dict) -> "Layout":
        out = []
        for t in d.get("tracks", []):
            slot = TrackSlot(
                track=int(t["track"]),
                role=str(t.get("role", f"track{t['track']}")).lower(),
                kind="drum" if str(t.get("kind", "melodic")).lower() == "drum" else "melodic",
                note=int(t.get("note", 60)),
                low=int(t.get("low", 36)),
                high=int(t.get("high", 84)),
                poly=bool(t.get("poly", False)),
                hint=str(t.get("hint", "")),
            )
            if not 1 <= slot.track <= 8:
                raise ValueError(f"layout: traccia {slot.track} fuori range 1..8")
            out.append(slot)
        out.sort(key=lambda s: s.track)
        return cls(out)


def default_layout() -> Layout:
    return Layout([
        TrackSlot(1, "kick", "drum", hint="cassa / kick"),
        TrackSlot(2, "snare", "drum", hint="rullante o clap"),
        TrackSlot(3, "hats", "drum", hint="charleston chiuso/aperto"),
        TrackSlot(4, "perc", "drum", hint="percussioni, rim, tom, shaker"),
        TrackSlot(5, "bass", "melodic", low=28, high=55, hint="basso (mono)"),
        TrackSlot(6, "chords", "melodic", low=48, high=79, poly=True, hint="accordi: piano, rhodes, pad stab"),
        TrackSlot(7, "lead", "melodic", low=60, high=91, hint="melodia / lead / arp"),
        TrackSlot(8, "pad", "melodic", low=48, high=84, poly=True, hint="pad / atmosfera / texture"),
    ])


def load_layout(path: str | None = None, template_dir: str | None = None) -> Layout:
    """Explicit file > tvgen-layout.json inside the template > default."""
    candidates = []
    if path:
        candidates.append(path)
    if template_dir:
        candidates.append(os.path.join(template_dir, LAYOUT_FILENAME))
    for c in candidates:
        if c and os.path.isfile(c):
            with open(c, encoding="utf-8") as f:
                return Layout.from_dict(json.load(f))
    if path:
        raise FileNotFoundError(path)
    return default_layout()
