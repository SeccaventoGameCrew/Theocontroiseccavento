"""Value encodings of the Tonverk project database (little-endian Rust serialisation).

Sources: community reverse engineering of Tonverk OS 1.3.x projects
(github.com/romainguerif/tonverk-merger, SCHEMA_SPEC.md / FINDINGS.md, MIT).
"""
from __future__ import annotations

import struct

TICKS_PER_STEP = 120          # 480 PPQN, a step is a 1/16 note
BPM_FACTOR = 240              # BPM stored as u32 = BPM x 240
DEFAULT_VELOCITY_RAW = 201    # the firmware default (= MIDI velocity 100, see velocity())


def u8(x: int) -> bytes:
    return struct.pack("<B", int(x))


def u16(x: int) -> bytes:
    return struct.pack("<H", int(x))


def u32(x: int) -> bytes:
    return struct.pack("<I", int(x))


def f32(x: float) -> bytes:
    return struct.pack("<f", float(x))


def tag(name: str) -> bytes:
    return name.encode("ascii")


def text(s: str) -> bytes:
    return s.encode("utf-8")


def dec_u8(v: bytes) -> int | None:
    return v[0] if len(v) == 1 else None


def dec_u16(v: bytes) -> int | None:
    return struct.unpack("<H", v)[0] if len(v) == 2 else None


def dec_u32(v: bytes) -> int | None:
    return struct.unpack("<I", v)[0] if len(v) == 4 else None


def dec_f32(v: bytes) -> float | None:
    return struct.unpack("<f", v)[0] if len(v) == 4 else None


def bpm(value: float) -> bytes:
    return u32(round(value * BPM_FACTOR))


def dec_bpm(v: bytes) -> float | None:
    x = dec_u32(v)
    return None if x is None else x / BPM_FACTOR


def velocity(midi_vel: int) -> int:
    """MIDI velocity 1..127 -> stored u8.

    The only value ever observed is 201, the firmware default, which is exactly
    MIDI velocity 100 on a 0..255 scale (100 * 255 / 127 = 200.8). Mapping onto the
    0..255 scale keeps the default byte-identical. Verify on the machine.
    """
    v = max(1, min(127, int(midi_vel)))
    return max(1, min(255, round(v * 255 / 127)))


def dec_velocity(raw: int) -> int:
    return max(1, min(127, round(raw * 127 / 255)))


def ticks(steps: float) -> int:
    return int(round(steps * TICKS_PER_STEP))
