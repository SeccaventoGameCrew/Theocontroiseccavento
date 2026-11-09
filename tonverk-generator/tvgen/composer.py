"""Offline, rule-based composer.

Used when no Claude API key is available, and as a deterministic generator for
tests. It reads a few hints out of the prompt (genre, BPM, key, mood, length) and
builds a complete song: chord progression, bass line, melody, drums and an
arrangement with intro / strofa / ritornello / break / finale.
"""
from __future__ import annotations

import hashlib
import random
import re
from dataclasses import dataclass

from . import theory
from .layout import Layout, default_layout
from .spec import STEPS_PER_BAR, Song

# --------------------------------------------------------------------------- genres


@dataclass
class Genre:
    name: str
    bpm: tuple[int, int]
    swing: int
    scale: str
    kick: list[float]
    snare: list[float]
    hats: list[float]
    perc: list[float]
    open_hats: list[float]
    bass: list[tuple[float, float]]       # (step, length) in one bar, note = chord root
    chord_rhythm: list[tuple[float, float]]
    lead_density: float
    progressions: list[list[int]]


GENRES: dict[str, Genre] = {
    "techno": Genre("techno", (126, 134), 50, "minor",
                    kick=[0, 4, 8, 12], snare=[4, 12], hats=[2, 6, 10, 14],
                    perc=[3, 7, 11, 13, 15], open_hats=[2, 6, 10, 14],
                    bass=[(2, .75), (3, .5), (6, .75), (7, .5), (10, .75), (11, .5), (14, .75), (15, .5)],
                    chord_rhythm=[(0, 1.5), (6, 1.5), (10, 1)], lead_density=.45,
                    progressions=[[0, 0, 5, 6], [0, 3, 0, 4], [0, 6, 5, 6]]),
    "house": Genre("house", (120, 126), 56, "dorian",
                   kick=[0, 4, 8, 12], snare=[4, 12], hats=[2, 6, 10, 14],
                   perc=[3, 6, 11, 14], open_hats=[2, 6, 10, 14],
                   bass=[(0, 1), (3, 1), (6, 1.5), (10, 1), (13, 1)],
                   chord_rhythm=[(0, 2), (3, 1.5), (7, 2), (10, 1.5)], lead_density=.4,
                   progressions=[[0, 3, 4, 3], [0, 5, 3, 4], [1, 4, 0, 5]]),
    "hiphop": Genre("hiphop", (84, 94), 62, "minor",
                    kick=[0, 7, 10], snare=[4, 12], hats=[0, 2, 4, 6, 8, 10, 12, 14],
                    perc=[15], open_hats=[14],
                    bass=[(0, 3), (7, 2), (10, 3)],
                    chord_rhythm=[(0, 8), (8, 8)], lead_density=.35,
                    progressions=[[0, 5, 3, 4], [0, 3, 6, 5], [0, 2, 5, 4]]),
    "trap": Genre("trap", (136, 150), 50, "harmonic_minor",
                  kick=[0, 6, 11], snare=[8], hats=[0, 2, 4, 6, 8, 10, 12, 13, 13.5, 14, 15],
                  perc=[3, 15], open_hats=[],
                  bass=[(0, 6), (6, 4), (11, 5)],
                  chord_rhythm=[(0, 16)], lead_density=.3,
                  progressions=[[0, 0, 5, 4], [0, 5, 3, 4]]),
    "dnb": Genre("dnb", (170, 176), 50, "minor",
                 kick=[0, 10], snare=[4, 12], hats=[0, 2, 4, 6, 8, 10, 12, 14],
                 perc=[7, 15], open_hats=[6, 14],
                 bass=[(0, 3), (6, 2), (10, 4)],
                 chord_rhythm=[(0, 16)], lead_density=.35,
                 progressions=[[0, 5, 3, 6], [0, 3, 5, 4]]),
    "ambient": Genre("ambient", (70, 90), 50, "lydian",
                     kick=[0], snare=[], hats=[8], perc=[6, 14], open_hats=[],
                     bass=[(0, 16)], chord_rhythm=[(0, 16)], lead_density=.15,
                     progressions=[[0, 3, 5, 4], [0, 1, 0, 4]]),
    "synthwave": Genre("synthwave", (100, 118), 50, "minor",
                       kick=[0, 8], snare=[4, 12], hats=[2, 6, 10, 14],
                       perc=[14], open_hats=[],
                       bass=[(s, .5) for s in range(0, 16, 2)] + [(s, .5) for s in range(1, 16, 2)],
                       chord_rhythm=[(0, 16)], lead_density=.45,
                       progressions=[[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 5, 4]]),
    "pop": Genre("pop", (96, 124), 52, "major",
                 kick=[0, 6, 8], snare=[4, 12], hats=[0, 2, 4, 6, 8, 10, 12, 14],
                 perc=[7, 15], open_hats=[14],
                 bass=[(0, 3), (6, 1), (8, 3), (14, 2)],
                 chord_rhythm=[(0, 4), (4, 4), (8, 4), (12, 4)], lead_density=.5,
                 progressions=[[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4]]),
    "reggaeton": Genre("reggaeton", (88, 98), 50, "minor",
                       kick=[0, 4, 8, 12], snare=[3, 6, 11, 14], hats=[0, 2, 4, 6, 8, 10, 12, 14],
                       perc=[7, 15], open_hats=[],
                       bass=[(0, 3), (3, 1), (6, 2), (8, 3), (11, 1), (14, 2)],
                       chord_rhythm=[(0, 3), (3, 3), (8, 3), (11, 3)], lead_density=.4,
                       progressions=[[0, 5, 2, 6], [0, 3, 6, 5]]),
}

GENRE_WORDS = {
    "techno": ["techno", "tekno", "industrial", "minimal", "acid", "rave", "berlin"],
    "house": ["house", "deep house", "garage", "disco", "funky", "nu disco"],
    "hiphop": ["hip hop", "hip-hop", "hiphop", "rap", "boom bap", "lofi", "lo-fi", "lo fi", "chill hop"],
    "trap": ["trap", "drill", "808"],
    "dnb": ["drum and bass", "drum n bass", "drum'n'bass", "dnb", "jungle", "liquid"],
    "ambient": ["ambient", "drone", "cinematic", "cinematografic", "meditativ", "atmosferic", "colonna sonora"],
    "synthwave": ["synthwave", "retrowave", "80s", "anni 80", "outrun", "darkwave", "new wave"],
    "pop": ["pop", "canzone", "ballad", "indie", "electropop", "dance"],
    "reggaeton": ["reggaeton", "dembow", "latin", "latino"],
}

MAJOR_WORDS = ["felice", "happy", "solare", "allegr", "gioios", "uplifting", "estate", "summer", "bright", "luminos"]
MINOR_WORDS = ["triste", "sad", "dark", "scur", "malinconic", "melanchol", "notte", "night", "cupo", "ipnotic", "hypnotic"]

# --------------------------------------------------------------------------- prompt hints


@dataclass
class Hints:
    genre: str
    bpm: float | None
    key: str | None
    scale: str | None
    minutes: float | None
    title: str | None
    mood: str | None


def read_hints(prompt: str) -> Hints:
    p = " " + prompt.lower() + " "
    genre = None
    for g, words in GENRE_WORDS.items():
        if any(w in p for w in words):
            genre = g
            break
    genre = genre or "techno"
    if "lofi" in p or "lo-fi" in p or "lo fi" in p:
        genre = "hiphop"
    m = re.search(r"(\d{2,3}(?:[.,]\d+)?)\s*(?:bpm|battiti)", p)
    bpm = float(m.group(1).replace(",", ".")) if m else None

    key = scale = None
    m = re.search(r"\b(?:in|tonalit[aà] (?:di )?)\s*(do|re|mi|fa|sol|la|si|[a-g])\s*([#b]|diesis|bemolle)?\s*"
                  r"(maggiore|minore|major|minor|dorian|dorico|frigio|phrygian|lydian|lidio|mixolydian|misolidio)?\b", p)
    if m and (m.group(3) or len(m.group(1)) > 1 or m.group(2)):
        acc = {"diesis": "#", "bemolle": "b"}.get(m.group(2) or "", m.group(2) or "")
        try:
            key = theory.NOTE_NAMES[theory.pitch_class(m.group(1) + acc)]
        except ValueError:
            key = None
        if m.group(3):
            scale = theory.normalize_scale(m.group(3))
    m2 = re.search(r"\b([a-g])\s*(#|b)?\s*(m|min|minor)\b", p)
    if not key and m2:
        key = theory.NOTE_NAMES[theory.pitch_class(m2.group(1) + (m2.group(2) or ""))]
        scale = "minor"

    mood = None
    if any(w in p for w in MAJOR_WORDS):
        mood = "major"
    if any(w in p for w in MINOR_WORDS):
        mood = "minor"

    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:minuti|minutes|min)\b", p)
    minutes = float(m.group(1).replace(",", ".")) if m else None
    m = re.search(r"[\"“«]([^\"”»]{2,40})[\"”»]", prompt)
    title = m.group(1) if m else None
    return Hints(genre, bpm, key, scale, minutes, title, mood)


# --------------------------------------------------------------------------- sections

# (id, name, bars, roles, energy 0..1)
SECTION_PLAN = [
    ("INTRO", "INTRO", 8, {"kick", "hats", "pad", "perc"}, .3),
    ("VERSE", "STROFA", 8, {"kick", "snare", "hats", "bass", "chords", "perc"}, .6),
    ("BUILD", "CRESCENDO", 4, {"kick", "snare", "hats", "bass", "chords", "pad"}, .75),
    ("CHORUS", "RITORNELLO", 8, {"kick", "snare", "hats", "perc", "bass", "chords", "lead", "pad"}, 1.0),
    ("BREAK", "BREAK", 8, {"pad", "chords", "lead", "perc"}, .4),
    ("OUTRO", "FINALE", 8, {"kick", "hats", "pad", "bass"}, .3),
]


def compose(prompt: str, layout: Layout | None = None, seed: int | None = None) -> Song:
    layout = layout or default_layout()
    h = read_hints(prompt)
    g = GENRES[h.genre]
    if seed is None:
        seed = int(hashlib.sha256(prompt.encode()).hexdigest()[:8], 16)
    rnd = random.Random(seed)

    bpm = h.bpm or rnd.randint(*g.bpm)
    scale = h.scale or h.mood or g.scale
    if h.mood == "major" and scale in ("minor", "dorian", "phrygian", "harmonic_minor"):
        scale = "major"
    key = h.key or rnd.choice(["A", "C", "D", "E", "F", "G", "F#", "C#"])
    root = theory.pitch_class(key)
    prog = rnd.choice(g.progressions)
    if scale == "major" and g.scale != "major":
        prog = rnd.choice(GENRES["pop"].progressions)

    by_role = {s.role: s for s in layout.tracks}
    title = h.title or f"{h.genre.upper()} {rnd.choice(['NOTTURNO', 'SEGNALE', 'VERTIGINE', 'ORBITA', 'MAREA', 'LUCE', 'RITMO', 'DERIVA'])}"
    song = {
        "title": title, "genre": h.genre,
        "description": f"Generato offline dal prompt: {prompt.strip()[:200]}",
        "bpm": bpm, "swing": g.swing, "key": key, "scale": scale,
        "tracks": [{"track": s.track, "role": s.role, "sound": s.hint} for s in layout.tracks],
        "patterns": [], "arrangement": [],
    }

    motif = _motif(rnd, g, root, scale, prog, by_role.get("lead"))
    for pid, name, bars, roles, energy in SECTION_PLAN:
        parts = []
        steps = bars * STEPS_PER_BAR
        for slot in layout.tracks:
            if slot.role not in roles:
                continue
            part = _part(slot, g, rnd, root, scale, prog, steps, energy, pid, motif)
            if part and part["events"]:
                parts.append(part)
        song["patterns"].append({"id": pid, "name": name, "bars": bars, "parts": parts})

    # arrangement, scaled to the requested length
    rows = [("INTRO", 1), ("VERSE", 2), ("BUILD", 1), ("CHORUS", 2), ("BREAK", 1),
            ("VERSE", 1), ("BUILD", 1), ("CHORUS", 2), ("OUTRO", 1)]
    bars_of = {p[0]: p[2] for p in SECTION_PLAN}
    target = (h.minutes or 3.5) * 60
    sec_per_bar = 240.0 / bpm
    total = sum(bars_of[r] * n for r, n in rows) * sec_per_bar
    factor = target / total
    labels = {p[0]: p[1] for p in SECTION_PLAN}
    for r, n in rows:
        reps = n if r in ("INTRO", "OUTRO", "BUILD") else max(1, round(n * factor))
        song["arrangement"].append({"pattern": r, "repeats": reps, "label": labels[r], "mutes": []})
    return Song.from_dict(song, layout)


# --------------------------------------------------------------------------- parts


def _ev(step, notes, vel, length):
    return {"step": step, "notes": [theory.note_name(n) for n in notes], "vel": int(vel), "length": length}


def _part(slot, g: Genre, rnd, root, scale, prog, steps, energy, pid, motif):
    role = slot.role
    drum = slot.kind == "drum"
    events = []
    loop = 16
    if drum:
        hits = {"kick": g.kick, "snare": g.snare, "hats": g.hats, "perc": g.perc}.get(role, g.perc)
        if role == "kick" and pid == "BREAK":
            return None
        base_vel = 95 + int(25 * energy)
        if role == "hats":
            for s in hits:
                accent = 0 if s % 4 == 2 else -18
                events.append(_ev(s, [slot.note], base_vel + accent + rnd.randint(-6, 4), .5))
            if energy > .7 and g.open_hats:
                # extra ghost hats in the loudest sections
                for s in range(1, 16, 4):
                    if rnd.random() < .5:
                        events.append(_ev(s, [slot.note], 60 + rnd.randint(0, 15), .25))
        else:
            for s in hits:
                events.append(_ev(s, [slot.note], base_vel + rnd.randint(-5, 3), 1))
        if role == "snare" and pid == "BUILD":
            # snare roll over the whole 4-bar build-up
            loop = steps
            events = []
            for bar in range(steps // 16):
                hits_bar = [4, 12] if bar < steps // 16 - 1 else list(range(0, 16, 1))
                for s in hits_bar:
                    v = 70 + int(50 * (bar * 16 + s) / steps)
                    events.append(_ev(bar * 16 + s, [slot.note], min(v, 127), .5))
        return {"track": slot.track, "loop_steps": loop, "events": events}

    bars_in_prog = len(prog)
    loop = min(steps, bars_in_prog * 16)
    chords = [theory.triad(root, scale, d, 3, 3) for d in prog]

    if role == "bass":
        for b in range(loop // 16):
            r = theory.degree_note(root, scale, prog[b % bars_in_prog], 1)
            while r < slot.low:
                r += 12
            for i, (s, ln) in enumerate(g.bass):
                note = r + (12 if (g.name in ("techno", "synthwave") and i % 2 and energy > .7) else 0)
                events.append(_ev(b * 16 + s, [note], 100 + rnd.randint(-8, 8), ln))
    elif role in ("chords", "keys"):
        for b in range(loop // 16):
            ch = _fit(chords[b % bars_in_prog], slot.low, slot.high)
            for s, ln in g.chord_rhythm:
                events.append(_ev(b * 16 + s, ch, 85 + int(20 * energy), ln))
    elif role == "pad":
        for b in range(loop // 16):
            ch = _fit(theory.triad(root, scale, prog[b % bars_in_prog], 4, 4), slot.low, slot.high)
            events.append(_ev(b * 16, ch, 70 + int(15 * energy), 16))
    elif role in ("lead", "melody", "arp"):
        loop = len(prog) * 16
        if loop > steps:
            loop = steps
        for s, n, ln, v in motif:
            if s < loop:
                events.append(_ev(s, [n], v if pid != "BREAK" else v - 20, ln))
    else:
        for b in range(loop // 16):
            ch = _fit(chords[b % bars_in_prog], slot.low, slot.high)
            events.append(_ev(b * 16, [ch[0]], 90, 4))
    return {"track": slot.track, "loop_steps": loop, "events": events}


def _fit(notes, low, high):
    out = []
    for n in notes:
        while n < low:
            n += 12
        while n > high:
            n -= 12
        out.append(n)
    return sorted(set(out))


def _motif(rnd, g: Genre, root, scale, prog, slot):
    """A melody over the whole progression: 2-bar call repeated, answer varied."""
    low = slot.low if slot else 60
    high = slot.high if slot else 88
    pool = theory.scale_notes(root, scale, max(low, 60), min(high, 86))
    if not pool:
        pool = theory.scale_notes(root, scale, 60, 84)
    rhythm_cells = [[0, 3, 6, 8, 10, 14], [0, 2, 4, 7, 10, 12], [0, 4, 6, 10, 12], [2, 6, 8, 11, 14]]
    dens = g.lead_density
    cell = rnd.choice(rhythm_cells)
    out = []
    idx = rnd.randrange(len(pool) // 3, max(len(pool) // 3 + 1, 2 * len(pool) // 3))
    call = []
    for bar in range(2):
        for s in cell:
            if rnd.random() > dens + .35:
                continue
            idx = min(max(idx + rnd.choice([-2, -1, -1, 0, 1, 1, 2, 3]), 0), len(pool) - 1)
            call.append((bar * 16 + s, pool[idx], rnd.choice([1, 1, 2, 2, 3]), 100 + rnd.randint(-10, 10)))
    if not call:
        call = [(0, pool[len(pool) // 2], 4, 100)]
    bars = len(prog)
    for half in range(max(1, bars // 2)):
        for s, n, ln, v in call:
            if half % 2 == 1 and s >= 16:
                # answer: resolve the second bar towards the chord root
                chord = theory.triad(root, scale, prog[(half * 2 + 1) % bars], 4, 3)
                n = min(chord, key=lambda c: abs(c - n))
            out.append((half * 32 + s, n, ln, v))
    return out
