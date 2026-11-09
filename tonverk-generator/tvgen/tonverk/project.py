"""Song -> Tonverk project.

Strategy: everything that is not sequencer data comes from a TEMPLATE project
saved on the machine (sounds, routing, samples, FX, mixer, settings). The writer:

1. picks the template's source pattern (the first pattern that has sounds),
2. for every song pattern P (slot 0 = A01, 1 = A02, ...):
   - writes patterns/P (metadata: name, BPM, length, swing; 16 tracks -> sequences),
     cloning the template pattern so unknown fields keep the machine's values,
   - writes sequences P*16 .. P*16+15 with the trigs (notes, velocity, length),
   - copies the template kit (the presets of the 16 tracks) into kit P,
     because on the Tonverk every pattern owns its sounds (kit_id = pattern_id),
3. removes the template's other patterns, makes slot A01 the active pattern.

The allocation rules (sequence id = P*16+track, kit id = P) were confirmed on real
projects by the tonverk-merger reverse engineering.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field

from ..layout import Layout
from ..spec import Song
from . import codec as c
from . import schema as s

B = s.BASE


class TemplateError(ValueError):
    pass


@dataclass
class TemplateInfo:
    source_pattern: int
    patterns: list[int]
    kits_with_sounds: list[int]
    preset_nodes: list[int]
    event_w: int
    tick_w: int
    group_w: int
    widths_detected: bool
    has_pattern_keys: bool
    default_notes: dict[int, int]
    n_samples: int
    warnings: list[str] = field(default_factory=list)


def _ids(kv, rx):
    out = set()
    r = re.compile(rx)
    for k in kv:
        m = r.match(k)
        if m:
            out.add(m.group(1))
    return out


def analyze(kv: dict[str, bytes]) -> TemplateInfo:
    root = kv.get("/project/tag", b"").decode("ascii", "replace")
    if root == "ActiveDbV2":
        raise TemplateError("questa è la base 'active_project' interna: usa un progetto SALVATO "
                            "(cartella del progetto sulla scheda SD)")
    if root != s.ROOT_TAG:
        raise TemplateError(f"tipo di progetto non riconosciuto: /project/tag = {root!r} (atteso {s.ROOT_TAG})")
    w = []
    pats = sorted(int(x) for x in _ids(kv, rf"^{B}/patterns/(\d+)/"))
    kits = sorted(int(x) for x in _ids(kv, rf"^{B}/kits/(\d+)/data/presets/\d+/"))
    if not kits:
        w.append("il template non contiene suoni (kit vuoti): il progetto suonerà con i suoni di default")
    src = next((p for p in pats if p in kits), None)
    if src is None:
        src = kits[0] if kits else (pats[0] if pats else 0)
    nodes = sorted(int(x) for x in _ids(kv, rf"^{B}/kits/{src:05d}/data/presets/(\d+)/"))

    # id widths of trigs, when the template already has some
    def width(rx, default):
        found = {len(x) for x in _ids(kv, rx)}
        if len(found) == 1:
            return found.pop(), True
        if len(found) > 1:
            w.append(f"larghezze id incoerenti per {rx}: {sorted(found)}")
        return default, False
    ew, d1 = width(rf"^{B}/sequences/\d+/data/events/(\d+)/", s.EVENT_W)
    tw, d2 = width(rf"^{B}/sequences/\d+/data/ticks/(\d+)/", s.TICK_W)
    gw, _ = width(rf"^{B}/sequences/\d+/data/group_modifiers/(\d+)/", s.GROUP_W)

    dn = {}
    for t in range(16):
        v = kv.get(f"{s.sequence_prefix(src * 16 + t)}/data/default_note")
        if v and len(v) == 1:
            dn[t] = v[0]
    n_samples = len(_ids(kv, rf"^{B}/samples/(\d+)/"))
    return TemplateInfo(src, pats, kits, nodes, ew, tw, gw, d1 and d2,
                        bool(pats), dn, n_samples, w)


@dataclass
class BuildReport:
    slots: dict[str, int]
    template: TemplateInfo
    trigs: int
    notes: int
    warnings: list[str]


def build(template: dict[str, bytes], song: Song, layout: Layout, quantize: bool = False) -> tuple[dict[str, bytes], BuildReport]:
    info = analyze(template)
    warnings = list(info.warnings)
    if len(song.patterns) > 128:
        raise ValueError("massimo 128 pattern")
    src = info.source_pattern
    out: dict[str, bytes] = {}

    # ---- 1. everything outside patterns / sequences / kit presets is kept
    src_pattern = {}
    src_seq: dict[int, dict[str, bytes]] = defaultdict(dict)
    src_kit = {}
    sp_src = s.pattern_prefix(src) + "/"
    kit_src = s.kit_prefix(src) + "/data/presets/"
    seq_rx = re.compile(rf"^{B}/sequences/(\d+)(/.*)$")
    for k, v in template.items():
        if k.startswith(f"{B}/patterns/"):
            if k.startswith(sp_src):
                src_pattern[k[len(sp_src) - 1:]] = v
            continue
        m = seq_rx.match(k)
        if m:
            sid = int(m.group(1))
            if src * 16 <= sid < src * 16 + 16:
                src_seq[sid - src * 16][m.group(2)] = v
            continue
        if k.startswith(f"{B}/kits/") and "/data/presets/" in k:
            if k.startswith(kit_src):
                src_kit[k[len(kit_src):]] = v
            continue
        out[k] = v

    # ---- 2. patterns, sequences, kits
    slots = {}
    trigs = notes = 0
    length_warned = False
    for slot, pat in enumerate(song.patterns):
        slots[pat.id] = slot
        length = pat.steps * c.TICKS_PER_STEP
        # pattern: clone the template pattern, else build from the known schema
        pp = s.pattern_prefix(slot)
        if src_pattern:
            for rel, v in src_pattern.items():
                out[pp + rel] = v
        else:
            out.update(s.default_pattern(slot, slot * 16, song.bpm, length, song.swing, pat.name))
        md = f"{pp}/data/metadata/data"
        out[f"{md}/bpm"] = c.bpm(song.bpm)
        out[f"{md}/pattern_length"] = c.u32(length)
        out[f"{md}/swing"] = c.u8(song.swing)
        out[f"{md}/name"] = c.text(pat.name)
        for t in range(16):
            key = f"{pp}/data/tracks/{t:0{s.TRACK_W}d}/data/sequence_id"
            if key in out or not src_pattern:
                out[key] = c.u16(slot * 16 + t)
            # unmute tracks in generated patterns
            mk = f"{pp}/data/tracks/{t:0{s.TRACK_W}d}/data/mute/data"
            if f"{mk}/direct" in out:
                out[f"{mk}/direct"] = c.u8(0)
            if f"{mk}/notes" in out:
                out[f"{mk}/notes"] = bytes(32)

        # sequences
        for t in range(16):
            sp = s.sequence_prefix(slot * 16 + t)
            base = src_seq.get(t)
            if t >= 8 and base:
                # bus / send / mix tracks: keep the template content as is
                for rel, v in base.items():
                    out[sp + rel] = v
                continue
            fields = dict(s.default_sequence_fields())
            if base:
                fields = {rel: v for rel, v in base.items()
                          if not rel.startswith(s.SEQUENCE_CONTENT)}
                for rel in ("/data/events", "/data/ticks", "/data/group_modifiers",
                            "/data/event_modifiers", "/data/tick_modifiers", "/data/pitch_modifiers"):
                    fields.setdefault(rel, b"")
            fields["/data/length"] = c.u32(length)
            for rel, v in fields.items():
                out[sp + rel] = v
            if t >= 8:
                continue
            slot_cfg = layout.slot(t + 1)
            evs = pat.expanded(t + 1)
            eid = 1
            group = 0
            by_tick: dict[int, list] = defaultdict(list)
            for e in evs:
                step = round(e.step) if quantize else e.step
                tick = c.ticks(step)
                by_tick[tick].append(e)
            for tick in sorted(by_tick):
                seen_pitch = set()
                for e in by_tick[tick]:
                    dur = max(1, c.ticks(e.length))
                    vel = c.velocity(e.vel)
                    pitches = e.notes
                    if slot_cfg and slot_cfg.kind == "drum":
                        pitches = [slot_cfg.note]
                    for n in pitches:
                        if n in seen_pitch:
                            continue
                        seen_pitch.add(n)
                        out.update(s.note_event(sp, eid, tick, group, n, vel, dur,
                                                info.event_w, info.tick_w))
                        eid += 1
                        notes += 1
                group += 1
                trigs += 1
            if group > 65535:
                raise ValueError("troppi trig in una traccia")
        # kit: the pattern owns a copy of the template sounds
        kp = s.kit_prefix(slot)
        out.setdefault(f"{kp}/tag", c.tag("KitV2"))
        out.setdefault(f"{kp}/data/presets", b"")
        for rel, v in src_kit.items():
            out[f"{kp}/data/presets/{rel}"] = v
        if pat.steps > 256 and not length_warned:
            warnings.append("pattern più lunghi di 256 step")
            length_warned = True

    # ---- 3. active pattern = A01
    if f"{B}/master_track/data/pattern_id" in out:
        out[f"{B}/master_track/data/pattern_id"] = c.u16(0)
    for k in list(out):
        if k.startswith(f"{B}/node_to_kit/") and len(out[k]) == 2:
            out[k] = c.u16(0)
        m = re.match(rf"^{B}/tracks/(\d+)/data/sequence_id$", k)
        if m:
            out[k] = c.u16(int(m.group(1)))
    out.setdefault(f"{B}/patterns", b"")
    out.setdefault(f"{B}/sequences", b"")

    if not info.widths_detected:
        warnings.append("il template non contiene trig: formato degli id di eventi/tick dedotto "
                        "(10 cifre). Per sicurezza salva il template con almeno un trig sulla traccia 1.")
    return out, BuildReport(slots, info, trigs, notes, warnings)
