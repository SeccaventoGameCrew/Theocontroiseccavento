"""Standard MIDI File export of the whole arrangement (no dependencies).

- song.mid       one MIDI track per Tonverk track, channel N = track N, the exact
                 notes written to the machine (to play into the Tonverk or a DAW)
- preview_gm.mid General MIDI version (drums on channel 10, GM instruments) to
                 listen to the song in any player before loading it
"""
from __future__ import annotations

import struct

from ..layout import Layout
from ..spec import Song

PPQ = 480
TPS = PPQ // 4  # ticks per step

GM_DRUMS = {"kick": 36, "snare": 38, "clap": 39, "hats": 42, "hat": 42, "openhat": 46,
            "perc": 37, "rim": 37, "tom": 45, "shaker": 70, "ride": 51, "crash": 49}
GM_PROGRAMS = {"bass": 38, "chords": 4, "keys": 4, "piano": 0, "lead": 81, "melody": 81,
               "arp": 81, "pad": 89, "strings": 48, "fx": 99}


def _vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


def _track(events: list[tuple[int, int, bytes]], name: str) -> bytes:
    # events: (tick, order, data) - order puts note-offs before note-ons at the same tick
    data = b"\x00\xff\x03" + _vlq(len(name.encode())) + name.encode()
    last = 0
    for tick, _, ev in sorted(events, key=lambda e: (e[0], e[1])):
        data += _vlq(tick - last) + ev
        last = tick
    data += b"\x00\xff\x2f\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + data


def timeline(song: Song):
    """Yields (track, start_step, Event) over the whole arrangement."""
    pos = 0
    for row in song.arrangement:
        pat = song.pattern(row.pattern)
        for _ in range(row.repeats):
            for t in range(1, 9):
                if t in row.mutes:
                    continue
                for e in pat.expanded(t):
                    yield t, pos + e.step, e
            pos += pat.steps


def _swing(step: float, swing: int) -> float:
    if swing > 50 and float(step).is_integer() and int(step) % 2 == 1:
        return step + (swing - 50) / 50
    return step


def write_midi(song: Song, layout: Layout, path: str, gm: bool = False):
    per_track: dict[int, list] = {t: [] for t in range(1, 9)}
    for t, step, e in timeline(song):
        slot = layout.slot(t)
        drum = slot is not None and slot.kind == "drum"
        if gm and drum:
            ch = 9
            notes = [GM_DRUMS.get(slot.role, 37)]
        else:
            ch = (t - 1) % 16 if not gm else (t - 1 if t - 1 < 9 else t)
            notes = [slot.note] if drum else e.notes
        on = int(round(_swing(step, song.swing) * TPS))
        off = on + max(1, int(round(e.length * TPS)) - 1)
        for n in notes:
            per_track[t].append((on, 1, bytes([0x90 | ch, n, e.vel])))
            per_track[t].append((off, 0, bytes([0x80 | ch, n, 0])))

    tempo = int(round(60_000_000 / song.bpm))
    meta = (b"\x00\xff\x51\x03" + tempo.to_bytes(3, "big") + b"\x00\xff\x58\x04\x04\x02\x18\x08")
    chunks = [_track([(0, 0, meta[1:])], song.title)]
    for t in range(1, 9):
        slot = layout.slot(t)
        name = f"T{t} {slot.role if slot else ''}".strip()
        evs = per_track[t]
        if gm and slot and slot.kind != "drum":
            prog = GM_PROGRAMS.get(slot.role, 0)
            evs = [(0, -1, bytes([0xC0 | (t - 1), prog]))] + evs
        chunks.append(_track(evs, name))
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), PPQ)
    with open(path, "wb") as f:
        f.write(header + b"".join(chunks))
