"""Export of the arrangement for Songverk (github.com/romainguerif/songverk).

The song mode data of the Tonverk project has not been reverse engineered yet, so
the arrangement cannot be written into the project itself. Songverk is an external
song mode (Web MIDI, runs in a phone or desktop browser) that plays the patterns
in order with Program Changes and mutes rows with CC 94: importing this file gives
you the full arrangement immediately.
"""
from __future__ import annotations

import hashlib
import json
import time

from ..spec import Song


def songverk_json(song: Song) -> dict:
    rows = []
    for i, r in enumerate(song.arrangement):
        pat = song.pattern(r.pattern)
        slot = song.slot_of(r.pattern)
        rows.append({
            "id": f"r{i:06d}", "bank": slot // 16, "slot": slot % 16, "len": pat.steps, "rep": r.repeats,
            "bpm": song.bpm, "label": r.label or pat.name,
            "mutes": [(t + 1) in r.mutes for t in range(16)],
            "jump": {"mode": "none", "target": 0, "n": 2},
            "notes": f"{song.slot_label(slot)} {pat.name}", "lanes": [],
        })
    sid = hashlib.sha1(song.to_json().encode()).hexdigest()[:7]
    return {"id": sid, "name": song.title.lower(), "end": "stop", "target": 0,
            "updatedAt": int(time.time() * 1000), "rows": rows}


def write_songverk(song: Song, path: str):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(songverk_json(song), f, ensure_ascii=False, indent=2)
