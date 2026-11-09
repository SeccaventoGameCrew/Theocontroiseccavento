"""Human-readable summary of a Tonverk project database."""
from __future__ import annotations

import re
from collections import defaultdict

from . import codec as c
from . import schema as s

B = s.BASE


def summarize(kv: dict[str, bytes]) -> dict:
    pats = sorted({int(m.group(1)) for k in kv for m in [re.match(rf"^{B}/patterns/(\d+)/", k)] if m})
    # trigs per sequence
    ticks = defaultdict(set)
    pitches = defaultdict(list)
    for k, v in kv.items():
        m = re.match(rf"^{B}/sequences/(\d+)/data/ticks/(\d+)/data/events/\d+$", k)
        if m:
            ticks[int(m.group(1))].add(int(m.group(2)))
        m = re.match(rf"^{B}/sequences/(\d+)/data/events/\d+/data/data/data/data/data/pitch/some$", k)
        if m:
            pitches[int(m.group(1))].append(v[0])
    out = {"root": kv.get("/project/tag", b"").decode("ascii", "replace"),
           "keys": len(kv), "patterns": [], "samples": []}
    for p in pats:
        md = f"{s.pattern_prefix(p)}/data/metadata/data"
        length = c.dec_u32(kv.get(f"{md}/pattern_length", b"")) or 0
        tracks = []
        for t in range(16):
            sid = c.dec_u16(kv.get(f"{s.pattern_prefix(p)}/data/tracks/{t:05d}/data/sequence_id", b""))
            if sid is None:
                continue
            if ticks.get(sid):
                ps = pitches.get(sid, [])
                tracks.append({"track": t + 1, "sequence": sid, "trigs": len(ticks[sid]),
                               "notes": len(ps), "range": [min(ps), max(ps)] if ps else None})
        kit_nodes = {int(m.group(1)) for k in kv
                     for m in [re.match(rf"^{s.kit_prefix(p)}/data/presets/(\d+)/", k)] if m}
        name = kv.get(f"{md}/name", b"").decode("utf-8", "replace")
        out["patterns"].append({
            "slot": p, "label": f"{'ABCDEFGH'[p // 16]}{p % 16 + 1:02d}", "name": name,
            "bpm": c.dec_bpm(kv.get(f"{md}/bpm", b"")), "steps": length // c.TICKS_PER_STEP,
            "swing": c.dec_u8(kv.get(f"{md}/swing", b"")), "tracks": tracks,
            "kit_presets": len(kit_nodes),
        })
    for k in sorted(kv):
        m = re.match(rf"^{B}/samples/(\d+)/data/data$", k)
        if m:
            out["samples"].append(kv[k].decode("utf-8", "replace"))
    return out


def format_summary(sm: dict) -> str:
    lines = [f"Progetto {sm['root']} — {sm['keys']} chiavi, {len(sm['patterns'])} pattern, "
             f"{len(sm['samples'])} sample"]
    for p in sm["patterns"]:
        lines.append(f"  {p['label']} {p['name'] or '(senza nome)':<12} {p['bpm'] or 0:6.2f} BPM  "
                     f"{p['steps']:3d} step  swing {p['swing']}  suoni: {p['kit_presets']} preset")
        for t in p["tracks"]:
            rng = f"note {t['range'][0]}-{t['range'][1]}" if t["range"] else ""
            lines.append(f"      T{t['track']:<2} {t['trigs']:3d} trig {t['notes']:3d} note  {rng}")
    for smp in sm["samples"][:20]:
        lines.append(f"  sample: {smp}")
    if len(sm["samples"]) > 20:
        lines.append(f"  … altri {len(sm['samples']) - 20} sample")
    return "\n".join(lines)


def dump(kv: dict[str, bytes]) -> str:
    """Full key/value dump (text), handy to share a template for debugging."""
    lines = []
    for k in sorted(kv):
        v = kv[k]
        try:
            t = v.decode("ascii")
            shown = repr(t) if t.isprintable() and len(v) > 1 else ""
        except UnicodeDecodeError:
            shown = ""
        lines.append(f"{k} = {v.hex()} {shown}".rstrip())
    return "\n".join(lines)
