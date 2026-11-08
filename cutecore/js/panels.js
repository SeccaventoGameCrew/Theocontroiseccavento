/* cutecore — visual panels.
 * Each panel owns a canvas (sized by its .cv wrapper) and implements
 * reset() / onNote() / onHit() / draw(S). S is the per-frame state built in main.js.
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const C = {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function rgba(hex, a) {
    hex = (hex || '#000').trim().replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
    const n = parseInt(hex, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    ['bg', 'paper', 'ink', 'muted', 'grid', 'accent', 'accent2', 'accent3', 'soft'].forEach((k) => {
      C[k] = cs.getPropertyValue('--' + k).trim();
    });
    C.kawaii = document.documentElement.dataset.theme === 'kawaii';
    C.mono = cs.getPropertyValue('--mono').trim() || 'monospace';
  }

  function partColor(ch) {
    return ch === 1 ? C.accent : ch === 2 ? C.accent2 : ch === 3 ? C.soft : ch === 4 ? C.ink : C.accent3;
  }

  function lowerBound(arr, step) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].step < step) lo = m + 1; else hi = m; }
    return lo;
  }

  // ---- canvas helper
  class Surface {
    constructor(el, maxDpr) {
      this.el = el;
      this.maxDpr = maxDpr || 2;
      this.c = document.createElement('canvas');
      el.appendChild(this.c);
      this.g = this.c.getContext('2d');
      this.w = 1; this.h = 1;
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(el);
      this.resize();
    }
    resize() {
      const r = this.el.getBoundingClientRect();
      const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.dirty = true;
    }
    clear() { this.g.clearRect(0, 0, this.w, this.h); }
    font(px, weight) { this.g.font = (weight || 400) + ' ' + px + 'px ' + C.mono; }
  }

  // Tiny heart & star paths for the kawaii theme.
  function heart(g, x, y, s) {
    g.moveTo(x, y + s * 0.35);
    g.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.45, y - s * 1.1, x, y - s * 0.45);
    g.bezierCurveTo(x + s * 0.45, y - s * 1.1, x + s, y - s * 0.4, x, y + s * 0.35);
  }
  function star(g, x, y, s) {
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? s * 0.4 : s;
      const a = i * Math.PI / 4 - Math.PI / 2;
      if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
  }

  // =====================================================================
  // 01 SHEET — the song "printed" as six woven frequency ribbons
  // =====================================================================
  const PENS = ['Mesh', 'Braid', 'Dots'];
  class Sheet {
    constructor(el) {
      this.s = new Surface(el);
      this.COLS = 360;
      this.hist = new Float32Array(this.COLS * 6);
      this.lv = new Float32Array(6);
      this.pen = 0;
      this.reset();
    }
    reset() { this.hist.fill(0); this.lastCol = -1; }
    cyclePen() { this.pen = (this.pen + 1) % PENS.length; return PENS[this.pen]; }
    get penName() { return PENS[this.pen]; }
    draw(S) {
      const { g, w, h } = this.s;
      const COLS = this.COLS;
      for (let b = 0; b < 6; b++) this.lv[b] += (S.bands6[b] - this.lv[b]) * 0.35;
      const p = S.duration ? S.t / S.duration : 0;
      const col = clamp(Math.floor(p * COLS), 0, COLS - 1);
      if (col < this.lastCol - 2) this.reset();
      if (S.playing) {
        const from = col - this.lastCol > COLS / 4 ? col : Math.max(0, this.lastCol);
        for (let c = from; c <= col; c++) {
          for (let b = 0; b < 6; b++) {
            const i = c * 6 + b;
            this.hist[i] = c === col ? Math.max(this.hist[i], this.lv[b]) : Math.max(this.hist[i], this.lv[b] * 0.9);
          }
        }
        this.lastCol = Math.max(this.lastCol, col);
      }
      const upto = Math.max(0, this.lastCol);
      this.s.clear();
      const rh = h / 6;
      const X = (c) => (c + 0.5) / COLS * w;
      const K = this.pen === 1 ? 3 : 5;
      const freq = this.pen === 1 ? 0.55 : 0.32;
      const strand = (b, k, c) => {
        const cy = (b + 0.5) * rh;
        return cy + this.hist[c * 6 + b] * rh * 0.47 * Math.sin(c * freq + k * TAU / K + b * 0.9);
      };
      const W = 42;
      const x0 = X(Math.max(0, upto - W)), x1 = X(upto);
      const grad = g.createLinearGradient(x0, 0, x1 + 1, 0);
      grad.addColorStop(0, rgba(C.accent, 0));
      grad.addColorStop(1, rgba(C.accent, 1));

      for (let pass = 0; pass < 2; pass++) {
        const c0 = pass === 0 ? 0 : Math.max(0, upto - W);
        g.strokeStyle = pass === 0 ? rgba(C.ink, 0.42) : grad;
        g.fillStyle = pass === 0 ? rgba(C.ink, 0.5) : grad;
        g.lineWidth = pass === 0 ? 0.6 : 0.9;
        for (let b = 0; b < 6; b++) {
          if (this.pen === 2) {
            g.beginPath();
            for (let c = c0; c <= upto; c += 2) {
              for (let k = 0; k < K; k++) g.rect(X(c), strand(b, k, c), 1.1, 1.1);
            }
            g.fill();
            continue;
          }
          g.beginPath();
          for (let k = 0; k < K; k++) {
            for (let c = c0; c <= upto; c++) {
              const y = strand(b, k, c);
              if (c === c0) g.moveTo(X(c), y); else g.lineTo(X(c), y);
            }
          }
          if (this.pen === 0) {
            const cy = (b + 0.5) * rh;
            for (let c = c0 - (c0 % 3); c <= upto; c += 3) {
              if (c < c0) continue;
              const a = this.hist[c * 6 + b] * rh * 0.47;
              if (a < 0.6) continue;
              g.moveTo(X(c), cy - a); g.lineTo(X(c), cy + a);
            }
          }
          g.stroke();
        }
      }
      // ribbon baselines for the unprinted part
      g.strokeStyle = rgba(C.grid, 0.8);
      g.lineWidth = 0.5;
      g.setLineDash([2, 3]);
      g.beginPath();
      for (let b = 0; b < 6; b++) { const cy = (b + 0.5) * rh; g.moveTo(x1 + 4, cy); g.lineTo(w, cy); }
      g.stroke();
      g.setLineDash([]);
      // pen
      g.strokeStyle = C.accent;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x1 + 0.5, 0); g.lineTo(x1 + 0.5, h); g.stroke();
      let lb = 0;
      for (let b = 1; b < 6; b++) if (this.lv[b] > this.lv[lb]) lb = b;
      const py = strand(lb, 0, upto);
      g.fillStyle = C.paper;
      g.strokeStyle = C.ink;
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(x1, py, 5, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = C.ink;
      g.beginPath(); g.arc(x1, py, 1.6, 0, TAU); g.fill();
    }
  }

  // =====================================================================
  // 02 WAVEFORM + LOUDNESS strip
  // =====================================================================
  class Wave {
    constructor(el) { this.s = new Surface(el); }
    draw(S) {
      const { g, w, h } = this.s;
      this.s.clear();
      const L = S.loud;
      if (!L) return;
      const n = Math.max(1, Math.floor(w / 2));
      const per = L.nb / n;
      const pos = S.t / S.duration;
      const cur = pos * w;
      const yOf = (lufs) => h - 2 - clamp((lufs + 50) / 50, 0, 1) * (h - 6);
      // rms bars
      for (let i = 0; i < n; i++) {
        let m = 0;
        const a = Math.floor(i * per), b = Math.max(a + 1, Math.floor((i + 1) * per));
        for (let k = a; k < b && k < L.nb; k++) if (L.rms[k] > m) m = L.rms[k];
        const db = 20 * Math.log10(m + 1e-6);
        const bh = clamp((db + 48) / 48, 0, 1) * (h * 0.7);
        const x = i * 2;
        g.fillStyle = x < cur ? rgba(C.ink, 0.55) : rgba(C.muted, 0.45);
        g.fillRect(x, h * 0.62 - bh / 2, 1.2, Math.max(0.6, bh));
      }
      // short-term loudness curve
      g.strokeStyle = C.accent;
      g.lineWidth = 1.3;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const k = Math.min(L.nb - 1, Math.floor(i * per));
        const x = i * 2;
        if (x > cur) break;
        const y = yOf(L.shortTerm[k]);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      // integrated reference
      g.strokeStyle = rgba(C.accent, 0.35);
      g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(0, yOf(L.integrated)); g.lineTo(w, yOf(L.integrated)); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = C.accent;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(cur, 0); g.lineTo(cur, h); g.stroke();
    }
  }

  // ---- SCOPE
  class Scope {
    constructor(el) { this.s = new Surface(el); }
    draw(S) {
      const { g, w, h } = this.s;
      this.s.clear();
      gridLines(g, w, h, 4, 4);
      const N = 512;
      const tl = S.tl, tr = S.tr;
      let start = 0;
      for (let i = 1; i < tl.length - N; i++) if (tl[i - 1] < 0 && tl[i] >= 0) { start = i; break; }
      [[tr, rgba(C.muted, 0.9), 0.8], [tl, C.accent, 1.2]].forEach(([d, col, lw]) => {
        g.strokeStyle = col; g.lineWidth = lw;
        g.beginPath();
        for (let i = 0; i < N; i++) {
          const x = i / (N - 1) * w;
          const y = h / 2 - clamp(d[start + i] * 1.4, -1, 1) * h * 0.45;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      });
    }
  }

  function gridLines(g, w, h, nx, ny) {
    g.strokeStyle = rgba(C.grid, 0.9);
    g.lineWidth = 0.5;
    g.beginPath();
    for (let i = 1; i < nx; i++) { const x = Math.round(i * w / nx) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
    for (let i = 1; i < ny; i++) { const y = Math.round(i * h / ny) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
  }

  // ---- SPECTRUM
  class Spectrum {
    constructor(el) { this.s = new Surface(el); this.peaks = new Float32Array(64); }
    draw(S) {
      const { g, w, h } = this.s;
      this.s.clear();
      gridLines(g, w, h, 4, 4);
      const bands = S.bandsSpec;
      const n = bands.length;
      const bw = w / n;
      let mi = 0;
      for (let i = 1; i < n; i++) if (bands[i] > bands[mi]) mi = i;
      for (let i = 0; i < n; i++) {
        const v = bands[i];
        this.peaks[i] = Math.max(v, this.peaks[i] - 0.008);
        const bh = v * (h - 4);
        g.fillStyle = i === mi ? C.accent : C.ink;
        g.fillRect(i * bw + bw * 0.18, h - bh, bw * 0.64, bh);
        g.fillStyle = C.accent;
        g.fillRect(i * bw + bw * 0.3, h - this.peaks[i] * (h - 4) - 3, bw * 0.4, 1.6);
      }
    }
  }

  // ---- VECTOR (goniometer)
  class Vector {
    constructor(el) { this.s = new Surface(el); }
    draw(S) {
      const { g, w, h } = this.s;
      this.s.clear();
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42;
      g.strokeStyle = rgba(C.grid, 0.9);
      g.lineWidth = 0.6;
      g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 4;
        g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        g.lineTo(cx - Math.cos(a) * R, cy - Math.sin(a) * R);
      }
      g.stroke();
      const tl = S.tl, tr = S.tr;
      g.fillStyle = rgba(C.accent, 0.55);
      g.beginPath();
      for (let i = 0; i < tl.length; i += 2) {
        const l = tl[i], r = tr[i];
        const x = cx + clamp((r - l) * 0.9, -1, 1) * R;
        const y = cy - clamp((l + r) * 0.9, -1, 1) * R;
        g.rect(x, y, 1.2, 1.2);
      }
      g.fill();
      if (C.kawaii && S.kickPulse > 0.05) {
        g.fillStyle = rgba(C.accent, S.kickPulse);
        g.beginPath(); heart(g, cx, cy + 3, 6 + 6 * S.kickPulse); g.fill();
      }
    }
  }

  // =====================================================================
  // 03 ROLL — scrolling piano roll
  // =====================================================================
  class Roll {
    constructor(el) {
      this.s = new Surface(el);
      this.edit = false;
      this.selected = null;
      this.focusCh = 1;
      this.geo = null;
    }
    editRange(tr) {
      let lo = 127, hi = 0;
      for (const n of tr.notes) if (n.ch === this.focusCh) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
      if (lo > hi) { lo = 60; hi = 72; }
      lo -= 3; hi += 3;
      while (hi - lo < 18) { lo--; hi++; }
      return { lo: Math.max(12, lo), hi: Math.min(115, hi) };
    }
    // nearest note to a point (within slop px), honouring the focused part in edit mode
    hitTest(x, y, tr) {
      const G = this.geo;
      if (!G || !tr) return null;
      let best = null, bd = 12;
      const notes = tr.notes;
      for (let i = lowerBound(notes, G.left - 34); i < notes.length; i++) {
        const n = notes[i];
        if (n.step > G.left + G.view) break;
        if (this.edit && n.ch !== this.focusCh) continue;
        const x0 = (n.step - G.left) / G.view * G.w, x1 = Math.max(x0 + 4, (n.step + n.len - G.left) / G.view * G.w);
        const yc = (G.hi - n.midi + 0.5) * G.rowH;
        const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
        const dy = Math.max(0, Math.abs(y - yc) - G.rowH / 2);
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    }
    cellAt(x, y) {
      const G = this.geo;
      return { step: Math.floor(G.left + x / G.w * G.view), midi: Math.round(G.hi - (y / G.rowH) + 0.5) };
    }
    draw(S) {
      const { g, w, h } = this.s;
      this.s.clear();
      const tr = S.track;
      if (!tr) return;
      const edit = this.edit;
      const view = edit ? (w < 500 ? 32 : 48) : (w < 500 ? 56 : 80);
      const left = S.step - view * 0.32;
      const right = left + view;
      let lo = tr.rollLo, hi = tr.rollHi;
      if (edit) { const r = this.editRange(tr); lo = r.lo; hi = r.hi; }
      const rows = hi - lo + 1;
      const rowH = h / rows;
      const X = (st) => (st - left) / view * w;
      const Y = (m) => (hi - m) * rowH;
      this.geo = { left, view, lo, hi, rowH, w, h };
      this.s.font(9);
      // pitch grid
      g.lineWidth = 0.5;
      for (let m = lo; m <= hi; m++) {
        const y = Math.round(Y(m) + rowH) + 0.5;
        const isC = m % 12 === 0;
        g.strokeStyle = isC ? rgba(C.ink, 0.35) : rgba(C.grid, 0.55);
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
        if (isC && rowH * 12 > 18 && y > 22) {
          g.fillStyle = rgba(C.ink, 0.6);
          g.fillText('C' + (m / 12 - 1), 4, y - 2);
        } else if (edit && rowH > 9 && y > 22 && m % 12 !== 0) {
          g.fillStyle = rgba(C.muted, 0.7);
          g.fillText(Song.noteName(m), 4, y - 2);
        }
      }
      // bar & beat lines
      for (let st = Math.floor(left / 4) * 4; st <= right; st += 4) {
        const x = Math.round(X(st)) + 0.5;
        const isBar = st % 16 === 0;
        g.strokeStyle = isBar ? rgba(C.ink, 0.45) : rgba(C.grid, 0.4);
        g.beginPath(); g.moveTo(x, isBar ? 0 : 12); g.lineTo(x, h); g.stroke();
        if (isBar && st >= 0) { g.fillStyle = rgba(C.ink, 0.7); g.fillText(String(st / 16 + 1), x + 3, 10); }
      }
      // notes
      const notes = tr.notes;
      let i = lowerBound(notes, left - 34);
      const nh = Math.max(1.5, rowH * 0.78);
      for (; i < notes.length; i++) {
        const n = notes[i];
        if (n.step > right) break;
        const end = n.step + n.len;
        if (end < left) continue;
        const x0 = X(n.step), x1 = Math.max(x0 + 1.5, X(end) - 0.6);
        const y = Y(n.midi) + (rowH - nh) / 2;
        const sounding = n.step <= S.step && end > S.step;
        const col = partColor(n.ch);
        const dim = (edit && n.ch !== this.focusCh) || (S.audibleNote && !S.audibleNote(n));
        if (dim) {
          g.fillStyle = rgba(col, 0.18);
          g.fillRect(x0, y, x1 - x0, nh);
        } else if (sounding) {
          g.fillStyle = C.accent;
          g.fillRect(x0, y - 1, x1 - x0, nh + 2);
        } else {
          g.fillStyle = n.step > S.step ? rgba(col, 0.55) : col;
          g.fillRect(x0, y, x1 - x0, nh);
        }
      }
      // selected note
      const sel = this.selected;
      if (edit && sel && sel.step + sel.len >= left && sel.step <= right) {
        const x0 = X(sel.step), x1 = Math.max(x0 + 3, X(sel.step + sel.len));
        const y = Y(sel.midi);
        g.strokeStyle = C.ink;
        g.lineWidth = 1.5;
        g.strokeRect(x0 - 2, y - 2, x1 - x0 + 4, rowH + 4);
        g.fillStyle = C.accent;
        g.fillRect(x0, y + (rowH - nh) / 2, x1 - x0, nh);
      }
      // drum ticks along the bottom
      let j = lowerBound(tr.hits, left);
      for (; j < tr.hits.length; j++) {
        const hh = tr.hits[j];
        if (hh.step > right) break;
        const x = X(hh.step);
        const len = hh.inst === 'kick' ? 6 : hh.inst === 'snare' ? 4 : 2;
        g.fillStyle = hh.step <= S.step ? rgba(C.ink, 0.6) : rgba(C.muted, 0.5);
        g.fillRect(x, h - len, 1, len);
      }
      // playhead
      const px = Math.round(X(S.step)) + 0.5;
      g.strokeStyle = C.ink;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke();
    }
  }

  // =====================================================================
  // 04 ROOTS — a growing graph of the notes and the path between them
  // =====================================================================
  class Roots {
    constructor(el) {
      this.s = new Surface(el);
      this.reset();
    }
    reset() {
      this.nodes = new Map();
      this.edges = new Map();
      this.lastBy = {};
      this.dots = [];
      this.hitCount = 0;
      this.now = null;
    }
    node(midi) {
      let nd = this.nodes.get(midi);
      if (!nd) {
        const { w, h } = this.s;
        const from = this.now || { x: w * 0.66, y: h * 0.42 };
        const a = Math.random() * TAU;
        nd = { midi, x: from.x + Math.cos(a) * 24, y: from.y + Math.sin(a) * 24, vx: 0, vy: 0, dur: 0, count: 0, glow: 0 };
        this.nodes.set(midi, nd);
      }
      return nd;
    }
    onNote(n) {
      if (n.ch !== 1 && n.ch !== 4 && n.ch !== 5) return;
      const nd = this.node(n.midi);
      nd.dur += n.len;
      nd.count++;
      nd.glow = 1;
      const prev = this.lastBy[n.ch];
      if (prev !== undefined && prev !== n.midi) {
        const key = n.ch + ':' + Math.min(prev, n.midi) + ':' + Math.max(prev, n.midi);
        const e = this.edges.get(key);
        if (e) e.wt++; else this.edges.set(key, { a: prev, b: n.midi, ch: n.ch, wt: 1 });
      }
      this.lastBy[n.ch] = n.midi;
      if (n.ch === 1) this.now = nd;
    }
    onHit(hh, instant, S) {
      if (hh.inst === 'riser' || hh.inst === 'crash') return;
      this.hitCount++;
      if (instant || !this.now) return;
      const a = Math.random() * TAU, d = 12 + Math.random() * 18;
      this.dots.push({ x: this.now.x + Math.cos(a) * d, y: this.now.y + Math.sin(a) * d, inst: hh.inst, born: hh.step, to: this.now });
      if (this.dots.length > 180) this.dots.splice(0, this.dots.length - 180);
    }
    mostPlayed() {
      let best = null;
      this.nodes.forEach((n) => { if (!best || n.count > best.count) best = n; });
      return best;
    }
    simulate(dt) {
      const { w, h } = this.s;
      const arr = Array.from(this.nodes.values());
      const sc = Math.min(w, h) / 220;
      const cx = w * 0.66, cy = h * 0.42;
      const k = 60 * dt;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
          const f = Math.min(4, 420 * sc * sc / d2);
          const d = Math.sqrt(d2);
          a.vx += dx / d * f * k * 0.05; a.vy += dy / d * f * k * 0.05;
          b.vx -= dx / d * f * k * 0.05; b.vy -= dy / d * f * k * 0.05;
        }
      }
      this.edges.forEach((e) => {
        const a = this.nodes.get(e.a), b = this.nodes.get(e.b);
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = (e.ch === 1 ? 26 : 34) * sc;
        const f = (d - rest) * 0.004 * Math.min(3, Math.sqrt(e.wt)) * k;
        a.vx += dx / d * f; a.vy += dy / d * f;
        b.vx -= dx / d * f; b.vy -= dy / d * f;
      });
      for (const a of arr) {
        a.vx += (cx - a.x) * 0.0016 * k;
        a.vy += (cy - a.y) * 0.0022 * k;
        a.vx *= 0.86; a.vy *= 0.86;
        a.x = clamp(a.x + a.vx * k, w * 0.3, w - 8);
        a.y = clamp(a.y + a.vy * k, 8, h * 0.62);
        a.glow *= 0.92;
      }
    }
    draw(S) {
      const { g, w, h } = this.s;
      this.simulate(Math.min(0.05, S.dt));
      this.s.clear();
      // edges
      this.edges.forEach((e) => {
        const a = this.nodes.get(e.a), b = this.nodes.get(e.b);
        g.strokeStyle = e.ch === 1 ? rgba(C.accent, 0.5) : rgba(partColor(e.ch), 0.4);
        g.lineWidth = Math.min(2.4, 0.5 + e.wt * 0.15);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      });
      // hit dots (last 2 bars)
      this.dots = this.dots.filter((d) => S.step - d.born < 32 && S.step >= d.born - 1);
      for (const d of this.dots) {
        const life = 1 - (S.step - d.born) / 32;
        const col = d.inst === 'kick' ? C.accent : d.inst === 'snare' ? C.accent2 : C.soft;
        g.strokeStyle = rgba(col, 0.75 * life);
        g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.to.x, d.to.y); g.stroke();
        g.fillStyle = rgba(C.ink, 0.9 * life);
        g.beginPath(); g.arc(d.x, d.y, 1.7, 0, TAU); g.fill();
      }
      // nodes
      this.nodes.forEach((n) => {
        const r = clamp(1.5 + Math.sqrt(n.dur) * 0.75, 2, 9);
        const col = n.midi < 52 ? C.ink : n.midi > 84 ? C.accent3 : C.accent2;
        g.fillStyle = rgba(col, 0.85);
        g.beginPath();
        if (C.kawaii && n.midi > 84) star(g, n.x, n.y, r + 1); else g.arc(n.x, n.y, r, 0, TAU);
        g.fill();
        if (n.glow > 0.08) {
          g.strokeStyle = rgba(C.ink, n.glow);
          g.lineWidth = 1.2;
          g.beginPath(); g.arc(n.x, n.y, r + 3 + (1 - n.glow) * 6, 0, TAU); g.stroke();
        }
      });
      // most played callout
      const mp = this.mostPlayed();
      if (mp && mp.count > 2) {
        this.s.font(9, 600);
        const label = 'MOST PLAYED ' + Song.noteName(mp.midi);
        const tw = g.measureText(label).width;
        const lx = clamp(mp.x - tw - 26, 4, w - tw - 4), ly = clamp(mp.y - 18, 12, h - 4);
        g.fillStyle = rgba(C.paper, 0.75);
        g.fillRect(lx - 2, ly - 9, tw + 4, 12);
        g.fillStyle = C.ink;
        g.fillText(label, lx, ly);
        g.strokeStyle = C.ink;
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(lx + tw + 2, ly - 3);
        g.lineTo(mp.x - 4, mp.y - 3);
        g.stroke();
      }
    }
  }

  // =====================================================================
  // 05 FOUNTAIN — stereo particle fountain
  // =====================================================================
  class Fountain {
    constructor(el) {
      this.s = new Surface(el);
      this.MAX = 2600;
      this.px = new Float32Array(this.MAX); this.py = new Float32Array(this.MAX);
      this.vx = new Float32Array(this.MAX); this.vy = new Float32Array(this.MAX);
      this.life = new Float32Array(this.MAX); this.kind = new Uint8Array(this.MAX);
      this.head = 0;
      this.sparks = 0;
      this.acc = [0, 0];
    }
    reset() { this.sparks = 0; }
    geom() {
      const { w, h } = this.s;
      return { cx: w / 2, by: h * 0.86, rx: w * 0.36, ry: Math.min(h * 0.07, w * 0.06) };
    }
    spawn(x, y, vx, vy, kind) {
      const i = this.head;
      this.head = (this.head + 1) % this.MAX;
      this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy;
      this.life[i] = 1; this.kind[i] = kind;
      this.sparks++;
    }
    onNote(n, instant) {
      if (instant || (n.ch !== 1 && n.ch !== 5)) return;
      const { cx, by, rx, ry } = this.geom();
      const { h } = this.s;
      const side = n.midi % 2 ? 1 : -1;
      const a = side > 0 ? -0.25 + Math.random() * 0.5 : Math.PI - 0.25 + Math.random() * 0.5;
      const x = cx + Math.cos(a) * rx * 0.8, y = by + Math.sin(a) * ry;
      const k = n.ch === 5 ? 5 : 9;
      for (let i = 0; i < k; i++) {
        this.spawn(x, y, (Math.random() - 0.5) * 60, -(0.75 + Math.random() * 0.35) * h * 1.15 * (0.7 + n.vel * 0.3), 1);
      }
    }
    draw(S) {
      const { g, w, h } = this.s;
      const dt = Math.min(0.05, S.dt);
      const { cx, by, rx, ry } = this.geom();
      const G = h * 1.5;
      if (S.playing) {
        [S.rmsL, S.rmsR].forEach((e, side) => {
          this.acc[side] += Math.pow(e * 4, 1.5) * 170 * dt;
          let n = Math.floor(this.acc[side]);
          this.acc[side] -= n;
          n = Math.min(n, 40);
          for (let i = 0; i < n; i++) {
            const a = side === 0 ? Math.PI / 2 + Math.random() * Math.PI : -Math.PI / 2 + Math.random() * Math.PI;
            const x = cx + Math.cos(a) * rx, y = by + Math.sin(a) * ry;
            const lift = 0.62 + Math.min(0.3, e * 0.9) + Math.random() * 0.28;
            const vx = (Math.cos(a) * -0.15 + (Math.random() - 0.5) * 0.4) * w * 0.25;
            this.spawn(x, y, vx, -lift * h * 1.05, 0);
          }
        });
      }
      this.s.clear();
      // ring
      g.lineWidth = 2.4;
      g.strokeStyle = C.ink;
      g.beginPath(); g.ellipse(cx, by, rx, ry, 0, 0, TAU); g.stroke();
      g.lineWidth = 0.7;
      g.setLineDash([3, 3]);
      g.strokeStyle = rgba(C.accent, 0.8);
      g.beginPath(); g.ellipse(cx, by, rx * 0.86, ry * 0.7, 0, 0, TAU); g.stroke();
      g.setLineDash([]);
      // particles
      const dots = [], specials = [];
      for (let i = 0; i < this.MAX; i++) {
        if (this.life[i] <= 0) continue;
        this.vy[i] += G * dt;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        this.life[i] -= dt / (this.kind[i] ? 1.6 : 1.25);
        if (this.py[i] > by + ry * 1.2 && this.vy[i] > 0) this.life[i] = 0;
        if (this.life[i] > 0) (this.kind[i] ? specials : dots).push(i);
      }
      for (let pass = 0; pass < 3; pass++) {
        g.fillStyle = rgba(C.accent, pass === 0 ? 0.25 : pass === 1 ? 0.5 : 0.85);
        g.beginPath();
        for (const i of dots) {
          const l = this.life[i];
          const bucket = l < 0.33 ? 0 : l < 0.66 ? 1 : 2;
          if (bucket === pass) g.rect(this.px[i], this.py[i], 1.4, 1.4);
        }
        g.fill();
      }
      for (const i of specials) {
        const l = this.life[i];
        g.fillStyle = rgba(C.kawaii ? C.accent : C.ink, Math.min(1, l * 1.3));
        g.beginPath();
        if (C.kawaii) { if (i % 2) heart(g, this.px[i], this.py[i], 4); else star(g, this.px[i], this.py[i], 3.5); }
        else g.rect(this.px[i] - 1, this.py[i] - 1, 2.2, 2.2);
        g.fill();
      }
    }
  }

  // =====================================================================
  // 06 ORBIT — one revolution per bar
  // =====================================================================
  class Orbit {
    constructor(el) { this.s = new Surface(el); }
    draw(S) {
      const { g, w, h } = this.s;
      this.s.clear();
      const tr = S.track;
      if (!tr) return;
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) * 0.44;
      const rIn = R * 0.2;
      const rOut = R * 0.8;
      const bar = Math.floor(S.step / 16);
      const barStart = bar * 16;
      const ang = (st) => ((st - barStart) / 16) * TAU - Math.PI / 2;

      // dashed outer ring + ticks
      g.strokeStyle = rgba(C.muted, 0.8);
      g.lineWidth = 0.8;
      g.setLineDash([2, 4]);
      g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
      g.setLineDash([]);
      g.beginPath();
      for (let i = 0; i < 64; i++) {
        const a = i / 64 * TAU - Math.PI / 2;
        const len = i % 16 === 0 ? 10 : i % 4 === 0 ? 5 : 2.5;
        g.moveTo(cx + Math.cos(a) * (R + 3), cy + Math.sin(a) * (R + 3));
        g.lineTo(cx + Math.cos(a) * (R + 3 + len), cy + Math.sin(a) * (R + 3 + len));
      }
      g.stroke();
      this.s.font(10, 600);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const beat = Math.floor((S.step - barStart) / 4);
      ['1', '2', '3', '4'].forEach((t, i) => {
        const a = i / 4 * TAU - Math.PI / 2;
        g.fillStyle = i === beat ? C.accent : rgba(C.ink, 0.7);
        g.fillText(t, cx + Math.cos(a) * (R + 22), cy + Math.sin(a) * (R + 22));
      });

      // note arcs: this bar (live) + 3 previous bars (faded)
      const lo = tr.rollLo, hi = tr.rollHi;
      const rad = (m) => rIn + 8 + (m - lo) / Math.max(1, hi - lo) * (rOut - rIn - 8);
      const notes = tr.notes;
      g.lineCap = 'round';
      for (let back = 3; back >= 0; back--) {
        const b0 = barStart - back * 16;
        const i0 = lowerBound(notes, b0 - 8);
        for (let i = i0; i < notes.length; i++) {
          const n = notes[i];
          if (n.step >= b0 + 16) break;
          if (n.ch === 2 || n.ch === 3) continue;
          if (n.step + n.len <= b0) continue;
          let s0 = Math.max(n.step, b0), s1 = Math.min(n.step + n.len, b0 + 16);
          if (back === 0) { if (s0 > S.step) continue; s1 = Math.min(s1, S.step); }
          if (s1 <= s0) continue;
          const r = rad(n.midi);
          const sounding = back === 0 && n.step + n.len > S.step;
          g.strokeStyle = back === 0 ? (sounding ? C.accent : rgba(partColor(n.ch), 0.9)) : rgba(C.soft, 0.65 - back * 0.15);
          g.lineWidth = back === 0 ? (sounding ? 5 : 3.5) : 3;
          g.beginPath();
          g.arc(cx, cy, r, ang(s0 + back * 16), Math.max(ang(s0 + back * 16) + 0.02, ang(s1 + back * 16)));
          g.stroke();
        }
      }
      g.lineCap = 'butt';

      // center
      g.strokeStyle = rgba(C.ink, 0.5);
      g.lineWidth = 1;
      g.fillStyle = C.paper;
      g.beginPath(); g.arc(cx, cy, rIn, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = C.ink;
      this.s.font(Math.max(8, rIn * 0.22));
      g.fillText('BAR', cx, cy - rIn * 0.42);
      this.s.font(Math.max(14, rIn * 0.7), 600);
      g.fillText(String(Math.max(1, bar + 1)), cx, cy + rIn * 0.15);
      if (C.kawaii && S.kickPulse > 0.05) {
        g.fillStyle = rgba(C.accent, S.kickPulse * 0.8);
        g.beginPath(); heart(g, cx, cy + rIn * 0.75, 4 + S.kickPulse * 3); g.fill();
      }
      // hand
      const a = ang(S.step);
      g.strokeStyle = C.ink;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * rIn * 0.9, cy + Math.sin(a) * rIn * 0.9);
      g.lineTo(cx + Math.cos(a) * (R + 2), cy + Math.sin(a) * (R + 2));
      g.stroke();
      g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    }
  }

  root.Panels = { Surface, Sheet, Wave, Scope, Spectrum, Vector, Roll, Roots, Fountain, Orbit, readTheme, partColor, lowerBound, C, rgba };
})(window);
