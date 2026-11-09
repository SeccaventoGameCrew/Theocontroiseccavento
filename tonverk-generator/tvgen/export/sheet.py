"""Arrangement sheet: a self-contained HTML page describing the generated song."""
from __future__ import annotations

import html

from ..layout import Layout
from ..spec import Song

ROLE_COLORS = ["#d9480f", "#c2255c", "#9c36b5", "#5f3dc4", "#1971c2", "#0c8599", "#2b8a3e", "#e67700"]

CSS = """
:root{--bg:#f6f5f2;--fg:#191919;--muted:#6b6b6b;--line:#dcd9d2;--card:#fff;--on:#191919;--off:#ebe8e1;--acc:#d9480f}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121212;--fg:#ececec;--muted:#9a9a9a;--line:#2c2c2c;--card:#1b1b1b;--on:#ececec;--off:#262626;--acc:#ff8a4c}}
:root[data-theme=dark]{--bg:#121212;--fg:#ececec;--muted:#9a9a9a;--line:#2c2c2c;--card:#1b1b1b;--on:#ececec;--off:#262626;--acc:#ff8a4c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;letter-spacing:.04em;margin:0 0 4px}h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:36px 0 12px}
.meta{color:var(--muted);font-variant-numeric:tabular-nums}.desc{max-width:70ch;white-space:pre-wrap}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.tl{display:flex;height:44px;border-radius:6px;overflow:hidden;border:1px solid var(--line)}.tl div{border-right:1px solid var(--bg);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#fff;overflow:hidden;white-space:nowrap;min-width:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:0 0 14px;overflow-x:auto}
.card h3{margin:0 0 10px;font-size:15px}.card h3 span{color:var(--muted);font-weight:400}
.grid{display:grid;grid-template-columns:110px 1fr;gap:3px 10px;align-items:center;min-width:560px}.lbl{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.steps{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:2px}.steps i{height:14px;border-radius:2px;background:var(--off)}.steps i.on{background:var(--c)}.steps i.bar{box-shadow:inset 2px 0 0 var(--line)}
ol li{margin:0 0 6px}code{background:var(--off);padding:1px 5px;border-radius:4px}.warn{color:var(--acc)}
"""


def sheet_html(song: Song, layout: Layout, project_name: str, notes: list[str] | None = None) -> str:
    e = html.escape
    color = {}
    for i, p in enumerate(song.patterns):
        color[p.id] = ROLE_COLORS[i % len(ROLE_COLORS)]
    mins, secs = divmod(int(round(song.duration_seconds())), 60)
    total_bars = max(1, song.total_bars())

    out = [f"<!doctype html><html lang=it><head><meta charset=utf-8>"
           f"<meta name=viewport content='width=device-width,initial-scale=1'>"
           f"<title>{e(song.title)}</title><style>{CSS}</style></head><body><main>"]
    out.append(f"<h1>{e(song.title)}</h1><div class=meta>{e(song.genre)} · {song.bpm:g} BPM · "
               f"{e(song.key)} {e(song.scale.replace('_', ' '))} · swing {song.swing}% · "
               f"{len(song.patterns)} pattern · {song.total_bars()} battute · {mins}:{secs:02d}</div>")
    if song.description:
        out.append(f"<p class=desc>{e(song.description)}</p>")

    out.append("<h2>Arrangiamento</h2><div class=tl>")
    for r in song.arrangement:
        p = song.pattern(r.pattern)
        w = 100 * p.bars * r.repeats / total_bars
        out.append(f"<div style='width:{w:.3f}%;background:{color[p.id]}' title='{e(r.label)}'>"
                   f"{e(song.slot_label(song.slot_of(p.id)))}</div>")
    out.append("</div><table><tr><th>#</th><th>Pattern</th><th>Sezione</th><th>Battute</th><th>Ripetizioni</th><th>Mute</th></tr>")
    for i, r in enumerate(song.arrangement, 1):
        p = song.pattern(r.pattern)
        mutes = ", ".join(f"T{m}" for m in r.mutes) or "—"
        out.append(f"<tr><td>{i}</td><td><b style='color:{color[p.id]}'>{song.slot_label(song.slot_of(p.id))}</b> "
                   f"{e(p.name)}</td><td>{e(r.label)}</td><td>{p.bars}</td><td>×{r.repeats}</td><td>{mutes}</td></tr>")
    out.append("</table>")

    out.append("<h2>Tracce e suoni</h2><table><tr><th>Traccia</th><th>Ruolo</th><th>Suono suggerito</th></tr>")
    for t in song.tracks:
        slot = layout.slot(t.track)
        kind = " (drum)" if slot and slot.kind == "drum" else ""
        out.append(f"<tr><td>T{t.track}</td><td>{e(t.role)}{kind}</td><td>{e(t.sound)}</td></tr>")
    out.append("</table>")

    out.append("<h2>Pattern</h2>")
    for p in song.patterns:
        out.append(f"<div class=card><h3>{song.slot_label(song.slot_of(p.id))} · {e(p.name)} "
                   f"<span>{p.bars} battute</span></h3><div class=grid>")
        view = min(p.steps, 64)
        for t in range(1, 9):
            evs = p.expanded(t)
            if not evs:
                continue
            on = {int(ev.step) for ev in evs if ev.step < view}
            slot = layout.slot(t)
            role = slot.role if slot else ""
            cells = "".join(f"<i class='{'on ' if s in on else ''}{'bar' if s % 16 == 0 and s else ''}'></i>"
                            for s in range(view))
            out.append(f"<div class=lbl>T{t} {e(role)} · {len(evs)}</div>"
                       f"<div class=steps style='--n:{view};--c:{ROLE_COLORS[(t - 1) % 8]}'>{cells}</div>")
        if p.steps > view:
            out.append(f"<div></div><div class=lbl>prime 4 battute di {p.bars}</div>")
        out.append("</div></div>")

    out.append("<h2>Caricare il progetto sul Tonverk</h2><ol>"
               "<li>Spegni il Tonverk o mettilo in modalità USB disk e collega la scheda SD al computer.</li>"
               f"<li>Copia la cartella <code>{e(project_name)}</code> accanto al progetto template, nella stessa cartella dei progetti della scheda.</li>"
               "<li>Riaccendi, apri il menu progetti e carica il progetto.</li>"
               "<li>I pattern sono in ordine nel banco A (A01, A02…). Per suonare l'arrangiamento: "
               "crea una Song nel song mode con le righe della tabella qui sopra, oppure importa "
               "<code>songverk.json</code> in Songverk per suonarlo subito via MIDI.</li></ol>")
    if notes:
        out.append("<h2>Note della generazione</h2><ul>")
        for n in notes:
            out.append(f"<li class=warn>{e(n)}</li>")
        out.append("</ul>")
    out.append("</main></body></html>")
    return "".join(out)


def write_sheet(song: Song, layout: Layout, path: str, project_name: str, notes=None):
    with open(path, "w", encoding="utf-8") as f:
        f.write(sheet_html(song, layout, project_name, notes))
