"""Key layout of a saved Tonverk project (ProjectV12), as far as it is known.

Conventions (see SCHEMA_SPEC.md of tonverk-merger):
  <path>/tag            versioned type name (PatternV1, SequenceV2, ...)
  <path>/data/<field>   fields, recursively
  collections           an empty value at the collection key + zero-padded numeric ids
  Option<T>             <field>/some = value | <field>/none = empty
  enums                 <path>/data/tag = variant name

Id widths follow the integer type of the id: u16 ids are 5 digits (patterns,
sequences, kits, tracks, nodes, groups), u32 ids are 10 digits (samples,
sample mappings, event modifiers -> events, ticks). The writer re-detects the
widths from the template whenever the template already contains trigs.
"""
from __future__ import annotations

from . import codec as c

BASE = "/project/data"
ROOT_TAG = "ProjectV12"

PATTERN_W = 5
SEQ_W = 5
KIT_W = 5
TRACK_W = 5
EVENT_W = 10
TICK_W = 10
GROUP_W = 5


def pid(n: int) -> str:
    return f"{n:0{PATTERN_W}d}"


def pattern_prefix(p: int) -> str:
    return f"{BASE}/patterns/{p:0{PATTERN_W}d}"


def sequence_prefix(s: int) -> str:
    return f"{BASE}/sequences/{s:0{SEQ_W}d}"


def kit_prefix(k: int) -> str:
    return f"{BASE}/kits/{k:0{KIT_W}d}"


def default_pattern(p: int, seq_base: int, bpm: float, length_ticks: int, swing: int, name: str) -> dict[str, bytes]:
    pp = pattern_prefix(p)
    md = f"{pp}/data/metadata"
    sc = f"{md}/data/scale_config"
    kv = {
        f"{pp}/tag": c.tag("PatternV1"),
        f"{md}/tag": c.tag("PatternMetadataV2"),
        f"{md}/data/bpm": c.bpm(bpm),
        f"{md}/data/change_quantization": c.u32(1920),
        f"{md}/data/global_quantization_depth": c.u8(0),
        f"{md}/data/name": c.text(name),
        f"{md}/data/page_mode/tag": c.tag("PageModeV1"),
        f"{md}/data/page_mode/data/tag": c.tag("Pattern"),
        f"{md}/data/pattern_length": c.u32(length_ticks),
        f"{md}/data/reset_length/tag": c.tag("LengthV1"),
        f"{md}/data/reset_length/data/tag": c.tag("Infinite"),
        f"{sc}/tag": c.tag("MusicalScaleConfigurationV3"),
        f"{sc}/data/chord_form/tag": c.tag("ChordFormV1"),
        f"{sc}/data/chord_form/data/tag": c.tag("OneThreeFive"),
        f"{sc}/data/chord_mode/tag": c.tag("ChordModeV1"),
        f"{sc}/data/chord_mode/data/tag": c.tag("Off"),
        f"{sc}/data/chord_pattern/tag": c.tag("ChordPatternV1"),
        f"{sc}/data/chord_pattern/data/tag": c.tag("Major"),
        f"{sc}/data/note_input_behavior/tag": c.tag("NoteInputBehaviorV2"),
        f"{sc}/data/note_input_behavior/data/tag": c.tag("Off"),
        f"{sc}/data/root/tag": c.tag("MusicalScaleRootV1"),
        f"{sc}/data/root/data/note": c.u8(0),
        f"{sc}/data/scale/tag": c.tag("MusicalScaleV1"),
        f"{sc}/data/scale/data/tag": c.tag("Aeolian"),
        f"{md}/data/swing": c.u8(swing),
        f"{md}/data/tempo_scale/tag": c.tag("ScaleV1"),
        f"{md}/data/tempo_scale/data/numer": c.u8(1),
        f"{md}/data/tempo_scale/data/denom": c.u8(1),
        f"{pp}/data/tracks": b"",
    }
    for t in range(16):
        tp = f"{pp}/data/tracks/{t:0{TRACK_W}d}"
        kv.update({
            f"{tp}/tag": c.tag("PatternTrackV4"),
            f"{tp}/data/bpm_mode/tag": c.tag("BpmModeV1"),
            f"{tp}/data/bpm_mode/data/tag": c.tag("GlobalRelative"),
            f"{tp}/data/bpm_mode/data/data/tag": c.tag("ScaleV1"),
            f"{tp}/data/bpm_mode/data/data/data/numer": c.u8(1),
            f"{tp}/data/bpm_mode/data/data/data/denom": c.u8(1),
            f"{tp}/data/mute/tag": c.tag("MuteSoloComponentsV1"),
            f"{tp}/data/mute/data/direct": c.u8(0),
            f"{tp}/data/mute/data/notes": bytes(32),
            f"{tp}/data/note_mutes_enabled": c.u8(1),
            f"{tp}/data/playback_direction/tag": c.tag("DirectionV1"),
            f"{tp}/data/playback_direction/data/tag": c.tag("Forward"),
            f"{tp}/data/playback_quantization_depth": c.u8(0),
            f"{tp}/data/playback_quantization_grid": c.u32(c.TICKS_PER_STEP),
            f"{tp}/data/sequence_id": c.u16(seq_base + t),
        })
    return kv


def default_sequence_fields() -> dict[str, bytes]:
    """Sequence keys relative to the sequence prefix (no events)."""
    return {
        "/tag": c.tag("SequenceV2"),
        "/data/bpm": c.bpm(120),
        "/data/default_chance/tag": c.tag("ChanceV1"),
        "/data/default_chance/data/value": c.u8(100),
        "/data/default_note": c.u8(60),
        "/data/default_note_duration": c.u32(480),
        "/data/default_note_repeat_enabled": c.u8(0),
        "/data/default_note_repeat_euclidean_density": c.u8(8),
        "/data/default_note_repeat_euclidean_length": c.u8(8),
        "/data/default_note_repeat_time": c.u32(60),
        "/data/default_note_repeat_velocity": c.u8(0),
        "/data/default_velocity": c.u8(c.DEFAULT_VELOCITY_RAW),
        "/data/event_modifiers": b"",
        "/data/events": b"",
        "/data/group_modifiers": b"",
        "/data/length": c.u32(1920),
        "/data/pitch_modifiers": b"",
        "/data/tick_modifiers": b"",
        "/data/ticks": b"",
    }


# sub-trees of a sequence holding trigs: removed before writing new trigs
SEQUENCE_CONTENT = ("/data/events/", "/data/ticks/", "/data/group_modifiers/",
                    "/data/event_modifiers/", "/data/tick_modifiers/", "/data/pitch_modifiers/")


def note_event(sp: str, eid: int, tick: int, group: int, pitch: int, vel_raw: int,
               dur_ticks: int, ew: int = EVENT_W, tw: int = TICK_W) -> dict[str, bytes]:
    """One note trig (EventV1 / Note / NoteV2) plus its timeline entry."""
    ep = f"{sp}/data/events/{eid:0{ew}d}"
    nd = f"{ep}/data/data/data/data/data"
    tp = f"{sp}/data/ticks/{tick:0{tw}d}"
    return {
        f"{ep}/tag": c.tag("EventV1"),
        f"{ep}/data/data/tag": c.tag("EventDataV1"),
        f"{ep}/data/data/data/tag": c.tag("Note"),
        f"{ep}/data/data/data/data/tag": c.tag("NoteV2"),
        f"{nd}/duration/some": c.u32(dur_ticks),
        f"{nd}/pitch/some": c.u8(pitch),
        f"{nd}/velocity/some": c.u8(vel_raw),
        f"{ep}/data/group/some": c.u16(group),
        f"{ep}/data/schedule": c.u32(tick),
        f"{tp}/tag": c.tag("TickV1"),
        f"{tp}/data/events": b"",
        f"{tp}/data/events/{eid:0{ew}d}": b"",
    }
