"""Music theory helpers: note names, scales, chords.

Convention: MIDI 60 = C4 (the convention used by Elektron machines).
"""
from __future__ import annotations

import re

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_PC = {
    "C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11,
    # Italian solfège
    "DO": 0, "RE": 2, "MI": 4, "FA": 5, "SOL": 7, "LA": 9, "SI": 11,
}

SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
    "pentatonic_minor": [0, 3, 5, 7, 10],
    "pentatonic_major": [0, 2, 4, 7, 9],
}

SCALE_ALIASES = {
    "maj": "major", "ionian": "major", "maggiore": "major",
    "min": "minor", "aeolian": "minor", "minore": "minor", "natural_minor": "minor",
    "dorico": "dorian", "frigio": "phrygian", "lidio": "lydian", "misolidio": "mixolydian",
    "harmonic minor": "harmonic_minor", "minore armonica": "harmonic_minor",
    "pentatonic": "pentatonic_minor", "pentatonica": "pentatonic_minor",
}

_NOTE_RE = re.compile(r"^\s*(DO|RE|MI|FA|SOL|LA|SI|[A-G])\s*([#b♯♭]?)\s*(-?\d+)\s*$", re.I)


def normalize_scale(name: str | None) -> str:
    if not name:
        return "minor"
    n = name.strip().lower().replace("-", "_")
    n = SCALE_ALIASES.get(n, SCALE_ALIASES.get(n.replace("_", " "), n))
    return n if n in SCALES else "minor"


def pitch_class(name: str) -> int:
    """'A', 'F#', 'Bb', 'la', 'sol#' -> 0..11."""
    m = re.match(r"^\s*(DO|RE|MI|FA|SOL|LA|SI|[A-G])\s*([#b♯♭]?)", name.strip(), re.I)
    if not m:
        raise ValueError(f"nota non valida: {name!r}")
    pc = _PC[m.group(1).upper()]
    acc = m.group(2)
    if acc in ("#", "♯"):
        pc += 1
    elif acc in ("b", "♭"):
        pc -= 1
    return pc % 12


def parse_note(value) -> int:
    """Note name ('C4', 'F#2', 'Bb3', 'la3') or MIDI number -> MIDI number 0..127."""
    if isinstance(value, bool):
        raise ValueError(f"nota non valida: {value!r}")
    if isinstance(value, (int, float)):
        n = int(round(value))
    else:
        s = str(value).strip()
        if re.fullmatch(r"-?\d+", s):
            n = int(s)
        else:
            m = _NOTE_RE.match(s)
            if not m:
                raise ValueError(f"nota non valida: {value!r}")
            pc = pitch_class(m.group(1) + m.group(2))
            n = (int(m.group(3)) + 1) * 12 + pc
    if not 0 <= n <= 127:
        raise ValueError(f"nota fuori range MIDI: {value!r}")
    return n


def note_name(n: int) -> str:
    return f"{NOTE_NAMES[n % 12]}{n // 12 - 1}"


def scale_notes(root_pc: int, scale: str, low: int, high: int) -> list[int]:
    """All MIDI notes of the scale between low and high (inclusive)."""
    iv = SCALES[normalize_scale(scale)]
    return [n for n in range(low, high + 1) if (n - root_pc) % 12 in iv]


def degree_note(root_pc: int, scale: str, degree: int, octave: int) -> int:
    """Scale degree (0-based, may exceed scale length) at a given octave -> MIDI."""
    iv = SCALES[normalize_scale(scale)]
    k = len(iv)
    o, d = divmod(degree, k)
    return (octave + 1 + o) * 12 + root_pc + iv[d]


def triad(root_pc: int, scale: str, degree: int, octave: int, size: int = 3) -> list[int]:
    """Diatonic chord (stacked thirds) built on a scale degree."""
    return [degree_note(root_pc, scale, degree + 2 * i, octave) for i in range(size)]
