"""SongSpec: the machine-independent description of a song.

A song is a set of patterns (one per section: intro, strofa, ritornello...) and an
arrangement (the order in which the patterns are played, with repeats).

Time grid: 16 steps per bar (4/4), a step is a 1/16 note. A pattern lasts 1..16 bars
(the Tonverk allows up to 256 steps). Each track of a pattern may describe a shorter
loop (`loop_steps`) that is repeated to fill the pattern: a drum groove written for
one bar fills an 8-bar pattern.

`from_dict` is lenient: it fixes what can be fixed (clamping, dropping bad notes)
and records every fix in `warnings`, so a slightly imperfect LLM answer still
produces a usable project.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from . import theory
from .layout import Layout

STEPS_PER_BAR = 16
MAX_STEPS = 256
MAX_PATTERNS = 128
BANKS = "ABCDEFGH"


@dataclass
class Event:
    step: float           # position in steps inside the loop (fractions = micro-timing)
    notes: list[int]      # MIDI notes (several = chord)
    vel: int = 100        # MIDI velocity 1..127
    length: float = 1.0   # duration in steps


@dataclass
class TrackPart:
    track: int                     # 1..8
    loop_steps: int                # loop length, repeated to fill the pattern
    events: list[Event] = field(default_factory=list)


@dataclass
class Pattern:
    id: str
    name: str
    bars: int
    parts: list[TrackPart] = field(default_factory=list)

    @property
    def steps(self) -> int:
        return self.bars * STEPS_PER_BAR

    def part(self, track: int) -> TrackPart | None:
        for p in self.parts:
            if p.track == track:
                return p
        return None

    def expanded(self, track: int) -> list[Event]:
        """Events of a track over the whole pattern (loop tiled), sorted by step."""
        p = self.part(track)
        if not p or not p.events:
            return []
        out = []
        reps = -(-self.steps // p.loop_steps)
        for r in range(reps):
            off = r * p.loop_steps
            for e in p.events:
                s = e.step + off
                if s < self.steps:
                    out.append(Event(s, list(e.notes), e.vel, e.length))
        out.sort(key=lambda e: (e.step, e.notes))
        return out


@dataclass
class Row:
    pattern: str
    repeats: int = 1
    label: str = ""
    mutes: list[int] = field(default_factory=list)


@dataclass
class TrackInfo:
    track: int
    role: str
    sound: str = ""


@dataclass
class Song:
    title: str
    bpm: float
    swing: int = 50
    key: str = "A"
    scale: str = "minor"
    genre: str = ""
    description: str = ""
    tracks: list[TrackInfo] = field(default_factory=list)
    patterns: list[Pattern] = field(default_factory=list)
    arrangement: list[Row] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    # ------------------------------------------------------------- helpers
    def pattern(self, pid: str) -> Pattern | None:
        for p in self.patterns:
            if p.id == pid:
                return p
        return None

    def slot_of(self, pid: str) -> int:
        """Pattern slot on the machine (0 = A01, 16 = B01, ...), in definition order."""
        for i, p in enumerate(self.patterns):
            if p.id == pid:
                return i
        raise KeyError(pid)

    @staticmethod
    def slot_label(slot: int) -> str:
        return f"{BANKS[slot // 16]}{slot % 16 + 1:02d}"

    def total_bars(self) -> int:
        return sum(self.pattern(r.pattern).bars * r.repeats for r in self.arrangement)

    def duration_seconds(self) -> float:
        return self.total_bars() * 4 * 60.0 / self.bpm

    # ------------------------------------------------------------- serialisation
    def to_dict(self) -> dict:
        def ev(e: Event):
            return {"step": _num(e.step), "notes": [theory.note_name(n) for n in e.notes],
                    "vel": e.vel, "length": _num(e.length)}
        return {
            "title": self.title, "genre": self.genre, "description": self.description,
            "bpm": _num(self.bpm), "swing": self.swing, "key": self.key, "scale": self.scale,
            "tracks": [{"track": t.track, "role": t.role, "sound": t.sound} for t in self.tracks],
            "patterns": [{
                "id": p.id, "name": p.name, "bars": p.bars,
                "parts": [{"track": t.track, "loop_steps": t.loop_steps,
                           "events": [ev(e) for e in t.events]} for t in p.parts],
            } for p in self.patterns],
            "arrangement": [{"pattern": r.pattern, "repeats": r.repeats, "label": r.label,
                             "mutes": r.mutes} for r in self.arrangement],
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    @classmethod
    def from_dict(cls, d: dict, layout: Layout | None = None) -> "Song":
        w: list[str] = []
        title = _clean_name(str(d.get("title") or "SONG"), 24) or "SONG"
        bpm = _clamp(_to_float(d.get("bpm"), 120.0), 30.0, 300.0, "bpm", w)
        bpm = round(bpm * 240) / 240  # Tonverk stores BPM x 240
        swing = int(_clamp(_to_float(d.get("swing"), 50), 50, 80, "swing", w))
        key = str(d.get("key") or "A")
        try:
            key = theory.NOTE_NAMES[theory.pitch_class(key)]
        except ValueError:
            w.append(f"tonalità {key!r} non valida, uso A")
            key = "A"
        scale = theory.normalize_scale(d.get("scale"))

        drum_tracks = set()
        if layout:
            drum_tracks = {s.track for s in layout.tracks if s.kind == "drum"}

        tracks = []
        for t in d.get("tracks") or []:
            try:
                n = int(t.get("track"))
            except (TypeError, ValueError):
                continue
            if 1 <= n <= 8:
                tracks.append(TrackInfo(n, str(t.get("role", "")), str(t.get("sound", ""))))
        if layout:
            known = {t.track for t in tracks}
            for s in layout.tracks:
                if s.track not in known:
                    tracks.append(TrackInfo(s.track, s.role, s.hint))
        tracks.sort(key=lambda t: t.track)

        patterns: list[Pattern] = []
        seen = set()
        for i, p in enumerate(d.get("patterns") or []):
            pid = str(p.get("id") or f"P{i + 1}").strip()
            if pid in seen:
                w.append(f"pattern {pid!r} duplicato, ignorato")
                continue
            if len(patterns) >= MAX_PATTERNS:
                w.append("più di 128 pattern: gli extra sono ignorati")
                break
            seen.add(pid)
            bars = int(_clamp(_to_float(p.get("bars"), 4), 1, MAX_STEPS // STEPS_PER_BAR,
                              f"pattern {pid}: bars", w))
            pat = Pattern(pid, _clean_name(str(p.get("name") or pid), 12) or pid, bars)
            steps = pat.steps
            used = set()
            for part in p.get("parts") or p.get("tracks") or []:
                try:
                    tn = int(part.get("track"))
                except (TypeError, ValueError):
                    w.append(f"pattern {pid}: traccia non valida {part.get('track')!r}")
                    continue
                if not 1 <= tn <= 8:
                    w.append(f"pattern {pid}: traccia {tn} fuori range 1..8, ignorata")
                    continue
                if tn in used:
                    w.append(f"pattern {pid}: traccia {tn} ripetuta, ignorata")
                    continue
                used.add(tn)
                loop = int(_to_float(part.get("loop_steps"), steps) or steps)
                if loop < 1 or loop > steps:
                    loop = steps
                tp = TrackPart(tn, loop)
                for e in part.get("events") or []:
                    ev = _parse_event(e, loop, tn in drum_tracks, f"pattern {pid} T{tn}", w)
                    if ev:
                        tp.events.append(ev)
                tp.events.sort(key=lambda e: e.step)
                pat.parts.append(tp)
            pat.parts.sort(key=lambda t: t.track)
            patterns.append(pat)
        if not patterns:
            raise ValueError("la canzone non contiene pattern")

        rows = []
        for r in d.get("arrangement") or []:
            pid = str(r.get("pattern", "")).strip()
            if pid not in seen:
                w.append(f"arrangiamento: pattern {pid!r} inesistente, riga ignorata")
                continue
            reps = int(_clamp(_to_float(r.get("repeats"), 1), 1, 64, "repeats", w))
            mutes = sorted({int(m) for m in (r.get("mutes") or [])
                            if str(m).lstrip("-").isdigit() and 1 <= int(m) <= 16})
            rows.append(Row(pid, reps, _clean_name(str(r.get("label") or ""), 16), mutes))
        if not rows:
            w.append("arrangiamento vuoto: ogni pattern suonato una volta in ordine")
            rows = [Row(p.id, 1, p.name) for p in patterns]

        return cls(title=title, bpm=bpm, swing=swing, key=key, scale=scale,
                   genre=str(d.get("genre") or ""), description=str(d.get("description") or ""),
                   tracks=tracks, patterns=patterns, arrangement=rows, warnings=w)

    @classmethod
    def from_json(cls, text: str, layout: Layout | None = None) -> "Song":
        return cls.from_dict(json.loads(text), layout)


# ----------------------------------------------------------------- internals
def _num(x: float):
    return int(x) if float(x).is_integer() else round(float(x), 3)


def _to_float(v, default):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _clamp(v: float, lo: float, hi: float, what: str, w: list[str]) -> float:
    if v < lo or v > hi:
        c = min(max(v, lo), hi)
        w.append(f"{what}={v:g} fuori range, uso {c:g}")
        return c
    return v


def _clean_name(s: str, n: int) -> str:
    s = re.sub(r"[^A-Za-z0-9 _\-.!?#&()+]", "", s.upper().replace("À", "A")
               .replace("È", "E").replace("É", "E").replace("Ì", "I")
               .replace("Ò", "O").replace("Ù", "U"))
    return re.sub(r"\s+", " ", s).strip()[:n]


def _parse_event(e: dict, loop: int, is_drum: bool, where: str, w: list[str]) -> Event | None:
    step = _to_float(e.get("step"), None)
    if step is None or step < 0 or step >= loop:
        w.append(f"{where}: step {e.get('step')!r} fuori dal loop di {loop}, ignorato")
        return None
    step = round(step * 120) / 120  # tick resolution (120 ticks per step)
    raw = e.get("notes")
    if raw is None and "note" in e:
        raw = [e["note"]]
    if not isinstance(raw, list):
        raw = [raw] if raw is not None else []
    notes = []
    for n in raw:
        try:
            notes.append(theory.parse_note(n))
        except ValueError as err:
            w.append(f"{where}: {err}")
    if not notes:
        if is_drum:
            notes = [60]
        else:
            w.append(f"{where}: evento senza note allo step {step:g}, ignorato")
            return None
    notes = sorted(set(notes))[:8]
    vel = int(min(max(_to_float(e.get("vel", e.get("velocity")), 100), 1), 127))
    length = _to_float(e.get("length", e.get("len")), 1.0)
    length = min(max(length, 1 / 6), float(MAX_STEPS))
    return Event(step, notes, vel, round(length * 120) / 120)


def song_json_schema() -> dict:
    """JSON schema used for Claude structured outputs (strict, all fields required)."""
    event = {
        "type": "object",
        "properties": {
            "step": {"type": "number", "description": "0-based 1/16 step inside the loop; fractions = micro-timing"},
            "notes": {"type": "array", "items": {"type": "string"},
                      "description": "note names with octave, C4 = MIDI 60; several = chord"},
            "vel": {"type": "integer", "description": "MIDI velocity 1-127"},
            "length": {"type": "number", "description": "duration in steps (1 = a 1/16 note)"},
        },
        "required": ["step", "notes", "vel", "length"],
        "additionalProperties": False,
    }
    part = {
        "type": "object",
        "properties": {
            "track": {"type": "integer", "description": "audio track 1-8"},
            "loop_steps": {"type": "integer", "description": "loop length in steps (16 = 1 bar), tiled to fill the pattern; must divide pattern length"},
            "events": {"type": "array", "items": event},
        },
        "required": ["track", "loop_steps", "events"],
        "additionalProperties": False,
    }
    pattern = {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "short unique id, e.g. INTRO, VERSE, DROP"},
            "name": {"type": "string", "description": "pattern name shown on the machine, max 12 chars"},
            "bars": {"type": "integer", "description": "1-16 bars of 4/4"},
            "parts": {"type": "array", "items": part},
        },
        "required": ["id", "name", "bars", "parts"],
        "additionalProperties": False,
    }
    row = {
        "type": "object",
        "properties": {
            "pattern": {"type": "string"},
            "repeats": {"type": "integer"},
            "label": {"type": "string"},
            "mutes": {"type": "array", "items": {"type": "integer"},
                      "description": "tracks muted in this row (optional variation)"},
        },
        "required": ["pattern", "repeats", "label", "mutes"],
        "additionalProperties": False,
    }
    track = {
        "type": "object",
        "properties": {
            "track": {"type": "integer"},
            "role": {"type": "string"},
            "sound": {"type": "string", "description": "sound to load on this track (suggestion)"},
        },
        "required": ["track", "role", "sound"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "genre": {"type": "string"},
            "description": {"type": "string", "description": "short description of the song and production notes"},
            "bpm": {"type": "number"},
            "swing": {"type": "integer", "description": "50 = straight, up to 80"},
            "key": {"type": "string", "description": "root note, e.g. A, F#"},
            "scale": {"type": "string", "enum": sorted(theory.SCALES)},
            "tracks": {"type": "array", "items": track},
            "patterns": {"type": "array", "items": pattern},
            "arrangement": {"type": "array", "items": row},
        },
        "required": ["title", "genre", "description", "bpm", "swing", "key", "scale",
                     "tracks", "patterns", "arrangement"],
        "additionalProperties": False,
    }
