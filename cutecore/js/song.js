/* cutecore — generative song composer.
 * Produces a deterministic (seeded) cutecore / kawaii future-bass track as
 * plain note + drum-hit data. synth.js turns it into audio, panels.js draws it.
 */
(function (root) {
  'use strict';

  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const DEFAULT_SEED = 112;

  function noteName(m) {
    m = Math.round(m);
    return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Chords, relative to the minor tonic.
  const CH = {
    i9:   { r: 0,  t: [0, 3, 7, 14] },
    III7: { r: 3,  t: [0, 4, 7, 11] },
    iv9:  { r: 5,  t: [0, 3, 7, 14] },
    v7:   { r: 7,  t: [0, 3, 7, 10] },
    VI7:  { r: 8,  t: [0, 4, 7, 11] },
    VII:  { r: 10, t: [0, 4, 7, 14] },
  };
  const VERSE_PROGS = [
    ['VI7', 'VII', 'v7', 'i9'],
    ['VI7', 'v7', 'iv9', 'VII'],
    ['i9', 'VI7', 'III7', 'VII'],
  ];
  const DROP_PROGS = [
    ['iv9', 'VI7', 'III7', 'VII'],
    ['VI7', 'VII', 'v7', 'i9'],
    ['VI7', 'VII', 'III7', 'i9'],
  ];
  const SCALE = [0, 2, 3, 5, 7, 8, 10];
  const PENTA = [0, 3, 5, 7, 10];

  // Melody onset templates over 2 bars (32 sixteenths).
  const RHY_A = [
    [0, 3, 6, 8, 10, 12, 14, 16, 19, 22, 24, 28],
    [0, 4, 6, 7, 8, 12, 16, 20, 22, 23, 24, 26, 28],
    [0, 3, 6, 10, 12, 14, 16, 19, 22, 26, 28],
  ];
  const RHY_B = [
    [0, 2, 4, 6, 8, 11, 14, 16, 18, 20, 22, 24, 27, 30],
    [0, 2, 3, 6, 8, 10, 11, 14, 16, 18, 19, 22, 24, 28, 30],
    [0, 3, 6, 8, 9, 10, 12, 14, 16, 19, 22, 24, 26, 27, 28, 30],
  ];
  const STABS = [[0, 3, 6, 10, 12], [0, 3, 6, 8, 11, 14]];
  const ARPS = [[0, 1, 2, 3], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3], [3, 2, 1, 0, 1, 2]];

  const FORM = [
    ['intro', 4], ['verse', 8], ['build', 4], ['drop', 8],
    ['break', 4], ['build', 4], ['drop2', 8], ['outro', 4],
  ];

  const PARTS = [
    { ch: 1, id: 'bell',  label: 'BELL' },
    { ch: 2, id: 'arp',   label: 'ARP' },
    { ch: 3, id: 'chord', label: 'CHORDS' },
    { ch: 4, id: 'bass',  label: 'BASS' },
    { ch: 5, id: 'spark', label: 'SPARK' },
  ];

  function compose(seed) {
    seed = (seed >>> 0) % 10000;
    const r = rng(seed * 7919 + 17);
    const isDefault = seed === DEFAULT_SEED;
    const T = isDefault ? 0 : pick(r, [0, -1, 1, -2, 2, -3, 3, -4]);
    const bpm = isDefault ? 112 : pick(r, [104, 108, 112, 116, 120, 124]);
    const tonic = 61 + T;                       // C♯4 transposed
    const tonicPc = ((tonic % 12) + 12) % 12;
    const vProg = isDefault ? VERSE_PROGS[0] : pick(r, VERSE_PROGS);
    const dProg = isDefault ? DROP_PROGS[0] : pick(r, DROP_PROGS);

    const scaleNotes = [];
    for (let m = 55; m <= 98; m++) if (SCALE.includes(((m - tonic) % 12 + 12) % 12)) scaleNotes.push(m);
    const center = scaleNotes.indexOf(tonic + 12);  // C♯5

    const chordNotes = (n) => {
      let rt = 49 + T + CH[n].r;
      while (rt < 53) rt += 12;
      while (rt > 64) rt -= 12;
      return CH[n].t.map((i) => rt + i);
    };
    const bassNote = (n) => {
      let m = 37 + T + CH[n].r;
      while (m < 40) m += 12;
      while (m > 51) m -= 12;
      return m;
    };
    const chordPcs = (n) => CH[n].t.map((i) => (((tonicPc + CH[n].r + i) % 12) + 12) % 12);
    const snap = (m, pcs) => {
      for (let d = 0; d < 7; d++) {
        if (pcs.includes(((m + d) % 12 + 12) % 12)) return m + d;
        if (pcs.includes(((m - d) % 12 + 12) % 12)) return m - d;
      }
      return m;
    };

    function makeMotif(templates, wild) {
      const R = pick(r, templates);
      const out = [];
      let c = 0;
      for (let i = 0; i < R.length; i++) {
        const s = R[i];
        const nx = i + 1 < R.length ? R[i + 1] : 32;
        let len = Math.min(nx - s, 6);
        if (r() < 0.25 && len > 2) len -= 1;
        out.push({ s, len, c });
        const x = r();
        c += x < 0.3 ? 1 : x < 0.55 ? -1 : x < 0.68 ? 2 : x < 0.8 ? -2 : x < 0.88 ? 0 : x < 0.94 ? (wild ? 5 : 3) : -3;
        if (c > 6) c -= 4;
        if (c < -4) c += 3;
      }
      return out;
    }

    const notes = [];
    const hits = [];
    const sections = [];

    function phrase(mot, startBar, prog, opt) {
      opt = opt || {};
      const tail = mot.map((o) => ({ s: o.s, len: o.len, c: o.c }));
      for (let i = Math.max(0, tail.length - 3); i < tail.length; i++) tail[i].c += pick(r, [-2, -1, 1, 2]);
      [mot, tail].forEach((seq, half) => {
        seq.forEach((o, i) => {
          if (opt.sparse && o.s % 4 !== 0) return;
          const s = half * 32 + o.s;
          const barOff = s >> 4;
          if (opt.bars && barOff >= opt.bars) return;
          const cname = prog[barOff % 4];
          const last = half === 1 && i === seq.length - 1;
          const si = clamp(center + o.c + (opt.lift || 0), 0, scaleNotes.length - 1);
          let midi = scaleNotes[si];
          if (o.s % 8 === 0 || last) midi = snap(midi, chordPcs(cname));
          let len = o.len;
          if (last) len = Math.max(len, Math.min(8, 64 - s));
          const vel = (o.s % 4 === 0 ? 0.85 : 0.66) * (opt.vel || 1);
          notes.push({ step: startBar * 16 + s, len, midi, vel, inst: 'bell', ch: 1 });
          if (opt.double && midi + 12 <= 98) {
            notes.push({ step: startBar * 16 + s, len: Math.min(len, 2), midi: midi + 12, vel: vel * 0.45, inst: 'spark', ch: 5 });
          }
        });
      });
    }

    const motA = makeMotif(RHY_A, false);
    const motA2 = makeMotif(RHY_A, false);
    const motB = makeMotif(RHY_B, true);
    const motB2 = makeMotif(RHY_B, true);
    const arpPat = pick(r, ARPS);

    let bar = 0;
    for (const [name, len] of FORM) {
      sections.push({ name, bar, len });
      const hot = name === 'drop' || name === 'drop2' || name === 'build';
      const prog = hot ? dProg : vProg;
      for (let b = 0; b < len; b++) {
        const B = bar + b;
        const S = B * 16;
        const cn = prog[b % 4];
        const chord = chordNotes(cn);
        const bass = bassNote(cn);
        const H = (s, inst, vel, extra) => hits.push(Object.assign({ step: S + s, inst, vel }, extra || {}));

        // ---- melody (4-bar phrases)
        if (b % 4 === 0) {
          if (name === 'intro') phrase(motA, B, prog, { sparse: true, vel: 0.75 });
          else if (name === 'verse') phrase(b < 4 ? motA : motA2, B, prog);
          else if (name === 'build') phrase(motA2, B, prog, { vel: 0.85, bars: 2 });
          else if (name === 'drop') phrase(b < 4 ? motB : motB2, B, prog, { lift: 2 });
          else if (name === 'drop2') phrase(b < 4 ? motB : motB2, B, prog, { lift: 2, double: true });
          else if (name === 'break') phrase(motA, B, prog, { sparse: true, vel: 0.8 });
          else if (name === 'outro') phrase(motA, B, prog, { sparse: true, vel: 0.6, bars: 3 });
        }
        if (name === 'outro' && b === len - 1) {
          notes.push({ step: S, len: 16, midi: tonic + 12, vel: 0.8, inst: 'bell', ch: 1 });
        }

        // ---- pads / stabs
        if (name === 'intro' || name === 'verse' || name === 'break' || name === 'outro') {
          const cut = name === 'intro' ? 700 : name === 'break' ? 1600 : name === 'outro' ? 900 : 1150;
          chord.forEach((m) => notes.push({ step: S, len: 16, midi: m, vel: 0.8, inst: 'pad', ch: 3, cut }));
        } else if (name === 'build') {
          if (b < 2) chord.forEach((m) => notes.push({ step: S, len: 16, midi: m, vel: 0.8, inst: 'pad', ch: 3, cut: 1400 + b * 600 }));
          else for (let s = 0; s < 16; s += b === 3 ? 2 : 4) chord.forEach((m) => notes.push({ step: S + s, len: 1.5, midi: m, vel: 0.5 + s / 40 + (b - 2) * 0.15, inst: 'chord', ch: 3 }));
        } else {
          const st = STABS[b % 2];
          st.forEach((s, i) => {
            const l = Math.min(3, (i + 1 < st.length ? st[i + 1] : 16) - s);
            const v = s === 0 ? 0.95 : 0.75;
            chord.forEach((m) => notes.push({ step: S + s, len: l, midi: m, vel: v, inst: 'chord', ch: 3 }));
            notes.push({ step: S + s, len: l, midi: chord[0] + 12, vel: v * 0.8, inst: 'chord', ch: 3 });
          });
        }

        // ---- arp
        const arpOn = (name === 'verse' && b >= 4) || hot;
        if (arpOn) {
          const tones = chord.map((m) => (m + 12 > 86 ? m : m + 12)).sort((a, z) => a - z);
          const every = name === 'verse' ? 2 : 1;
          for (let s = 0; s < 16; s += every) {
            const m = tones[arpPat[(s / every) % arpPat.length] % tones.length];
            notes.push({ step: S + s, len: every === 2 ? 1.5 : 0.9, midi: m, vel: s % 4 === 0 ? 0.9 : 0.6, inst: 'arp', ch: 2 });
          }
        }

        // ---- bass
        if (name === 'verse') {
          notes.push({ step: S, len: 6, midi: bass, vel: 0.9, inst: 'bass', ch: 4 });
          notes.push({ step: S + 10, len: 5, midi: bass, vel: 0.8, inst: 'bass', ch: 4 });
        } else if (name === 'build') {
          for (let s = 0; s < 16; s += 2) notes.push({ step: S + s, len: 1.2, midi: bass, vel: 0.75, inst: 'bass', ch: 4 });
        } else if (name === 'drop' || name === 'drop2') {
          notes.push({ step: S, len: 6, midi: bass, vel: 1, inst: 'bass', ch: 4 });
          notes.push({ step: S + 6, len: 4, midi: bass, vel: 0.85, inst: 'bass', ch: 4 });
          notes.push({ step: S + 10, len: 6, midi: b % 2 ? bass + 12 : bass, vel: 0.9, inst: 'bass', ch: 4 });
        } else if (name === 'outro' && b < 2) {
          notes.push({ step: S, len: 16, midi: bass, vel: 0.8, inst: 'bass', ch: 4 });
        }

        // ---- sparkles
        if (name === 'intro' || name === 'break' || name === 'drop2' || name === 'outro' || (name === 'drop' && b % 2)) {
          const n = 2 + Math.floor(r() * 3);
          for (let k = 0; k < n; k++) {
            const s = 1 + 2 * Math.floor(r() * 8);
            let m = tonic + 24 + pick(r, PENTA);
            if (r() < 0.35) m += 12;
            if (m > 98) m -= 12;
            notes.push({ step: S + s, len: 1, midi: m, vel: 0.35 + r() * 0.3, inst: 'spark', ch: 5 });
          }
        }

        // ---- drums
        if (name === 'intro') {
          if (b >= 2) for (let s = 2; s < 16; s += 4) H(s, 'hat', 0.25);
          if (b === 3) { H(12, 'snare', 0.3); H(14, 'snare', 0.45); }
        } else if (name === 'verse') {
          H(0, 'kick', 0.95, { duck: true });
          H(10, 'kick', 0.8, { duck: true });
          H(8, 'snare', 0.8);
          for (let s = 0; s < 16; s += 2) H(s, s === 14 && b % 2 ? 'ohat' : 'hat', s % 4 === 0 ? 0.5 : 0.32);
          if (b === 7) { H(12, 'snare', 0.4); H(14, 'snare', 0.55); H(15, 'snare', 0.6); }
        } else if (name === 'build') {
          if (b < 3) for (let s = 0; s < 16; s += 4) H(s, 'kick', 0.85, { duck: true });
          if (b < 2) { H(4, 'snare', 0.6); H(12, 'snare', 0.6); }
          else if (b === 2) for (let s = 0; s < 16; s += 2) H(s, 'snare', 0.35 + s / 40);
          else for (let s = 0; s < 14; s++) H(s, 'snare', 0.4 + s / 28);
          for (let s = 0; s < 16; s += b < 2 ? 2 : 1) H(s, 'hat', s % 4 === 0 ? 0.45 : 0.28);
          if (b === 2) H(0, 'riser', 0.9, { len: 32 });
        } else if (name === 'drop' || name === 'drop2') {
          if (b === 0) H(0, 'crash', 0.9);
          H(0, 'kick', 1, { duck: true });
          H(6, 'kick', 0.85, { duck: true });
          H(10, 'kick', 0.9, { duck: true });
          if (b % 2) H(14, 'kick', 0.7, { duck: true });
          H(4, 'snare', 0.9);
          H(12, 'snare', 0.9);
          for (let s = 0; s < 16; s++) {
            const v = s % 4 === 0 ? 0.5 : s % 2 === 0 ? 0.36 : 0.22;
            H(s, s === 14 && !(b % 2) ? 'ohat' : 'hat', v);
            if (b % 2 && s >= 12) H(s + 0.5, 'hat', 0.2 + (s - 12) * 0.05);
          }
          if (b === len - 1) { H(13, 'snare', 0.5); H(14, 'snare', 0.6); H(15, 'snare', 0.7); }
        } else if (name === 'break') {
          if (b >= 2) for (let s = 0; s < 16; s += 2) H(s, 'hat', 0.2 + (b - 2) * 0.08);
        } else if (name === 'outro') {
          if (b === 0) { H(0, 'crash', 0.6); H(0, 'kick', 0.9); }
          if (b === 1) H(0, 'kick', 0.7);
        }
      }
      bar += len;
    }

    notes.sort((a, z) => a.step - z.step || a.midi - z.midi);
    hits.sort((a, z) => a.step - z.step);

    return {
      kind: 'gen',
      seed,
      title: 'cutecore #' + String(seed).padStart(4, '0'),
      keyName: NAMES[tonicPc] + ' minor',
      bpm,
      bars: bar,
      offset: 0,
      notes,
      hits,
      sections,
      parts: PARTS.slice(),
    };
  }

  root.Song = { compose, noteName, DEFAULT_SEED, NAMES, PARTS };
})(window);
