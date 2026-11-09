"""Claude as the composer: prompt -> SongSpec JSON (structured outputs)."""
from __future__ import annotations

import json
import os

from .layout import Layout
from .spec import Song, song_json_schema
from .theory import note_name

DEFAULT_MODEL = os.environ.get("TVGEN_MODEL", "claude-opus-5-5")

SYSTEM = """You are a music producer and arranger writing songs for the Elektron Tonverk, a 16-track \
polyphonic sampler with a step sequencer. You turn a short description of a song into the complete \
sequencer content of a Tonverk project: patterns (one per song section) and the arrangement.

How the result is used: each pattern becomes one Tonverk pattern (slots A01, A02, ... in the order you \
list them); every trig you write is written into the machine's sequencer. The sounds are NOT yours to \
design: they come from a template project the musician prepared, with a fixed role per track (listed \
below). Write notes that suit those roles and ranges.

Sequencer model:
- 4/4, 16 steps per bar, a step is a 1/16 note. A pattern lasts 1-16 bars (max 256 steps).
- For each track of a pattern you give `loop_steps` and the events of that loop; the loop is repeated to \
fill the pattern. Use short loops (16 or 32 steps) for grooves and longer ones (64-128) for chord \
progressions and melodies; loop_steps should divide the pattern length.
- An event: `step` (0-based inside the loop; fractional values such as 13.5 give 1/32 rolls or \
micro-timing), `notes` (note names with octave, C4 = MIDI 60; several notes = a chord on one trig), \
`vel` (1-127), `length` in steps.
- Drum tracks play one sample: their pitch is fixed by the template, so give them notes ["C4"]; shape \
the groove with placement, velocity (accents, ghost notes) and length.
- Melodic tracks: stay in the given range, mono tracks play one note at a time.
- Tracks you leave out of a pattern are silent in that pattern: that is how sections differ \
(intro with few elements, full chorus, a break without kick...).
- Tracks 9-16 (buses, send FX, mix) are not sequenced here.

Write a real piece of music: a coherent harmony shared by bass, chords, pad and lead; a memorable \
melodic hook; variation between sections; fills or build-ups before the big sections. Typical songs use \
4-8 distinct patterns of 4 or 8 bars and an arrangement of 2-5 minutes; respect any length, genre, key, \
tempo or structure the musician asks for. `arrangement` lists rows in playing order: pattern id, \
repeats, a label and optional muted tracks for variations of the same pattern. Pattern names are \
shown on the machine: max 12 characters, uppercase, in the musician's language. Write `description` \
in the musician's language with short production notes (which sounds to choose for each track, FX, \
mixing)."""


def _layout_text(layout: Layout) -> str:
    lines = ["Template track layout:"]
    for s in layout.tracks:
        if s.kind == "drum":
            lines.append(f"- Track {s.track}: {s.role} (drum, one sample) - {s.hint}")
        else:
            poly = "polyphonic, chords allowed" if s.poly else "monophonic"
            lines.append(f"- Track {s.track}: {s.role} ({poly}, range {note_name(s.low)}-{note_name(s.high)}) - {s.hint}")
    return "\n".join(lines)


class ComposerError(RuntimeError):
    pass


def _call(messages: list[dict], layout: Layout, model: str, effort: str) -> dict:
    try:
        import anthropic
    except ImportError as e:  # pragma: no cover
        raise ComposerError("manca il pacchetto 'anthropic': pip install anthropic") from e
    client = anthropic.Anthropic()
    kwargs = dict(
        model=model,
        max_tokens=64000,
        system=SYSTEM + "\n\n" + _layout_text(layout),
        messages=messages,
        output_config={"effort": effort,
                       "format": {"type": "json_schema", "schema": song_json_schema()}},
    )
    # server-side fallback on a policy refusal (Claude API only; harmless to drop elsewhere)
    if not os.environ.get("TVGEN_NO_FALLBACK"):
        kwargs.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    try:
        with client.beta.messages.stream(**kwargs) as stream:
            msg = stream.get_final_message()
    except anthropic.AuthenticationError as e:
        raise ComposerError("chiave API non valida o assente (ANTHROPIC_API_KEY)") from e
    except anthropic.RateLimitError as e:
        raise ComposerError("limite di richieste raggiunto, riprova tra poco") from e
    except anthropic.BadRequestError as e:
        raise ComposerError(f"richiesta rifiutata dall'API: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise ComposerError(f"errore dell'API ({e.status_code}): {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise ComposerError("impossibile contattare l'API di Claude (rete)") from e

    if msg.stop_reason == "refusal":
        raise ComposerError("Claude ha rifiutato la richiesta; prova a riformulare il prompt")
    if msg.stop_reason == "max_tokens":
        raise ComposerError("risposta troppo lunga: chiedi meno pattern o pattern più corti")
    text = next((b.text for b in msg.content if b.type == "text"), None)
    if not text:
        raise ComposerError("risposta vuota")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ComposerError(f"JSON non valido nella risposta: {e}") from e


def compose(prompt: str, layout: Layout, model: str = DEFAULT_MODEL, effort: str = "high") -> Song:
    data = _call([{"role": "user", "content": prompt}], layout, model, effort)
    return Song.from_dict(data, layout)


def revise(song: Song, instruction: str, layout: Layout, model: str = DEFAULT_MODEL,
           effort: str = "high") -> Song:
    """Rewrite an existing song following an instruction ("ritornello più energico")."""
    content = ("Here is the current song as JSON:\n\n" + song.to_json() +
               "\n\nRewrite it following this request, keeping everything else that works:\n" + instruction)
    data = _call([{"role": "user", "content": content}], layout, model, effort)
    return Song.from_dict(data, layout)
