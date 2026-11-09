"""Flattened timeline for the in-app audio preview (played by a WebAudio synth)."""
from __future__ import annotations

from ..layout import Layout
from ..spec import Song
from .midi import _swing, timeline


def preview_data(song: Song, layout: Layout) -> dict:
    spb = 15.0 / song.bpm  # seconds per 1/16 step
    notes = []
    for t, step, e in timeline(song):
        start = _swing(step, song.swing) * spb
        dur = max(e.length * spb, 0.02)
        for n in e.notes:
            notes.append([round(start, 4), t, n, e.vel, round(dur, 4)])
    notes.sort(key=lambda x: (x[0], x[1]))
    sections, pos = [], 0.0
    for r in song.arrangement:
        p = song.pattern(r.pattern)
        length = p.steps * r.repeats * spb
        sections.append({"start": round(pos, 3), "end": round(pos + length, 3),
                         "label": r.label or p.name, "slot": song.slot_label(song.slot_of(p.id)),
                         "mutes": r.mutes})
        pos += length
    tracks = {}
    for s in layout.tracks:
        tracks[s.track] = {"role": s.role, "kind": s.kind}
    return {"notes": notes, "sections": sections, "duration": round(pos, 3), "tracks": tracks}
