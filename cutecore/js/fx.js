/* cutecore — visual effects generator.
 * generate(seed) makes a "recipe" (layers, symmetry, shape, palette, trails,
 * spin, post effects). FxRenderer draws a recipe on a canvas, driven by the
 * music: notes spawn shapes, kicks fire shockwaves, highs make glitter.
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const LAYERS = [
    { id: 'tunnel', label: 'TUNNEL' },
    { id: 'rings', label: 'RINGS' },
    { id: 'spokes', label: 'SPOKES' },
    { id: 'shapes', label: 'SHAPES' },
    { id: 'glitter', label: 'GLITTER' },
    { id: 'wave', label: 'WAVE' },
    { id: 'grid', label: 'GRID' },
  ];
  const POSTS = [
    { id: 'shake', label: 'SHAKE' },
    { id: 'zoom', label: 'ZOOM' },
    { id: 'rgb', label: 'RGB SPLIT' },
    { id: 'flash', label: 'FLASH' },
    { id: 'scan', label: 'SCANLINES' },
  ];
  const SHAPES = ['heart', 'star', 'circle', 'flower', 'diamond', 'tri'];
  const PALETTES = ['pastel', 'candy', 'mono', 'ice', 'sunset'];
  const BLENDS = ['difference', 'multiply', 'screen', 'normal'];
  const WORD_A = ['sugar', 'pastel', 'glitter', 'bubble', 'candy', 'dreamy', 'fluffy', 'neon', 'milk', 'strawberry', 'cloud', 'moon', 'velvet', 'lilac'];
  const WORD_B = ['tunnel', 'bloom', 'orbit', 'storm', 'garden', 'portal', 'kaleido', 'rain', 'pulse', 'halo', 'carousel', 'comet'];

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
  const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

  function makePalette(kind, hue) {
    const P = (h, s, l) => ({ h: (h + 360) % 360, s, l });
    switch (kind) {
      case 'candy': return [P(hue, 95, 66), P(hue + 150, 90, 70), P(hue + 60, 95, 74), P(hue, 30, 96)];
      case 'mono': return [P(hue, 85, 62), P(hue, 80, 74), P(hue, 70, 86), P(hue, 90, 48)];
      case 'ice': return [P(195, 90, 72), P(225, 85, 76), P(170, 70, 80), P(260, 80, 82)];
      case 'sunset': return [P(330, 90, 70), P(20, 95, 68), P(280, 70, 72), P(45, 95, 75)];
      default: return [P(hue, 85, 74), P(hue + 40, 85, 76), P(hue + 180, 70, 78), P(hue + 260, 75, 80)];
    }
  }

  function generate(seed) {
    seed = (seed >>> 0) % 100000;
    const r = rng(seed * 2654435761 + 7);
    const layers = {};
    LAYERS.forEach((l) => { layers[l.id] = r() < 0.38; });
    if (!layers.tunnel && !layers.shapes) layers[r() < 0.5 ? 'tunnel' : 'shapes'] = true;
    if (Object.values(layers).filter(Boolean).length < 3) layers[pick(r, ['rings', 'glitter', 'spokes'])] = true;
    const post = {};
    POSTS.forEach((p) => { post[p.id] = r() < 0.3; });
    const sym = pick(r, [1, 2, 3, 4, 5, 6, 8]);
    const palKind = pick(r, PALETTES);
    const hue = Math.floor(r() * 360);
    return {
      seed,
      name: pick(r, WORD_A) + ' ' + pick(r, WORD_B) + ' ×' + sym,
      layers,
      post,
      sym,
      shape: pick(r, SHAPES),
      palKind,
      hue,
      palette: makePalette(palKind, hue),
      hueDrift: r() < 0.45 ? 8 + r() * 30 : 0,
      trail: 0.55 + r() * 0.37,
      spin: (r() - 0.5) * 1.4,
      intensity: 0.85,
      blend: pick(r, BLENDS),
    };
  }

  // ---- shape paths (unit size, centered)
  function shapePath(g, kind, x, y, s, rot) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    switch (kind) {
      case 'heart':
        g.moveTo(0, s * 0.35);
        g.bezierCurveTo(-s, -s * 0.4, -s * 0.45, -s * 1.1, 0, -s * 0.45);
        g.bezierCurveTo(s * 0.45, -s * 1.1, s, -s * 0.4, 0, s * 0.35);
        break;
      case 'star':
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? s * 0.42 : s;
          const a = i * Math.PI / 5 - Math.PI / 2;
          if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        g.closePath();
        break;
      case 'flower':
        for (let i = 0; i < 5; i++) {
          const a = i * TAU / 5;
          g.moveTo(Math.cos(a) * s * 0.55 + s * 0.42, Math.sin(a) * s * 0.55);
          g.arc(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55, s * 0.42, 0, TAU);
        }
        break;
      case 'diamond':
        g.moveTo(0, -s); g.lineTo(s * 0.62, 0); g.lineTo(0, s); g.lineTo(-s * 0.62, 0); g.closePath();
        break;
      case 'tri':
        for (let i = 0; i < 3; i++) {
          const a = i * TAU / 3 - Math.PI / 2;
          if (i === 0) g.moveTo(Math.cos(a) * s, Math.sin(a) * s); else g.lineTo(Math.cos(a) * s, Math.sin(a) * s);
        }
        g.closePath();
        break;
      default:
        g.moveTo(s, 0); g.arc(0, 0, s, 0, TAU);
    }
    g.restore();
  }

  class FxRenderer {
    constructor(surface, opts) {
      this.s = surface;
      this.overlay = !!(opts && opts.overlay);
      this.rings = [];
      this.shapes = [];
      this.sparks = [];
      this.phase = 0;
      this.gridPhase = 0;
      this.time = 0;
      this.pulse = 0;
      this.active = true;
    }
    reset() { this.rings.length = 0; this.shapes.length = 0; this.sparks.length = 0; }
    col(R, i, a) {
      const p = R.palette[i % R.palette.length];
      return 'hsla(' + ((p.h + this.time * R.hueDrift) % 360).toFixed(1) + ',' + p.s + '%,' + p.l + '%,' + a + ')';
    }
    onNote(n, instant, R) {
      if (instant || !this.active || !R.layers.shapes) return;
      if (n.ch !== 1 && n.ch !== 5 && n.ch !== 4) return;
      if (this.shapes.length > 160) this.shapes.shift();
      const frac = Math.max(0, Math.min(1, (n.midi - 40) / 58));
      this.shapes.push({
        a: (n.midi % 12) / 12 * TAU + Math.random() * 0.15,
        r: 0.12 + frac * 0.6,
        s: (n.ch === 4 ? 0.07 : n.ch === 5 ? 0.025 : 0.045) * (0.6 + n.vel * 0.6),
        life: 1,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 3,
        c: n.ch === 5 ? 2 : n.ch === 4 ? 3 : 0,
      });
    }
    onHit(h, instant, R) {
      if (instant || !this.active) return;
      if (h.inst === 'kick') {
        this.pulse = 1;
        if (R.layers.rings) this.rings.push({ r: 0.06, life: 1, c: 0, dash: false });
      } else if (h.inst === 'snare' && R.layers.rings) {
        this.rings.push({ r: 0.04, life: 0.8, c: 1, dash: true });
      } else if (h.inst === 'crash') {
        this.pulse = 1.4;
        if (R.layers.rings) for (let i = 0; i < 3; i++) this.rings.push({ r: 0.02 + i * 0.05, life: 1, c: i, dash: i === 1 });
      }
      if (this.rings.length > 40) this.rings.shift();
    }

    draw(S, R) {
      const { g, w, h } = this.s;
      const dt = Math.min(0.05, S.dt);
      this.time += dt;
      const k = R.intensity;
      const cx = w / 2, cy = h / 2;
      const Rad = Math.min(w, h) * 0.5;
      const rot = this.time * R.spin;
      const energy = Math.min(1, (S.rmsL + S.rmsR) * 2.2);
      this.pulse *= Math.pow(0.015, dt);

      // trails: fade what is already on the canvas
      const remain = Math.pow(R.trail, dt * 60);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,' + (1 - remain).toFixed(3) + ')';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = this.overlay ? 'source-over' : 'lighter';
      g.lineCap = 'round';

      if (!this.overlay && this.pulse > 0.02) {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, Rad * 0.9);
        gr.addColorStop(0, this.col(R, 0, 0.22 * this.pulse * k));
        gr.addColorStop(1, this.col(R, 0, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }

      const L = R.layers;
      const sym = R.sym;

      if (L.grid) {
        this.gridPhase = (this.gridPhase + dt * (S.bpm || 112) / 60 * 0.5) % 1;
        const y0 = h * 0.58;
        g.strokeStyle = this.col(R, 2, 0.35 * k);
        g.lineWidth = 1;
        g.beginPath();
        for (let i = -12; i <= 12; i++) { g.moveTo(cx + i * w * 0.012, y0); g.lineTo(cx + i * w * 0.16, h); }
        for (let i = 0; i < 10; i++) {
          const p = ((i + this.gridPhase) % 10) / 10;
          const y = y0 + (h - y0) * p * p;
          g.moveTo(0, y); g.lineTo(w, y);
        }
        g.stroke();
      }

      if (L.tunnel) {
        this.phase = (this.phase + dt * (0.2 + energy * 0.9) + this.pulse * dt * 1.2) % 1;
        const N = 8;
        const sides = sym >= 3 ? sym : 0;
        for (let i = 0; i < N; i++) {
          const p = ((i + this.phase) % N) / N;
          const rr = p * p * Rad * 1.6;
          g.strokeStyle = this.col(R, i, (0.15 + 0.6 * p) * k);
          g.lineWidth = 0.6 + p * 4 * k;
          g.beginPath();
          if (!sides) g.arc(cx, cy, rr, 0, TAU);
          else {
            for (let j = 0; j <= sides; j++) {
              const a = rot + i * 0.14 + j * TAU / sides;
              const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
              if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
          }
          g.stroke();
        }
      }

      if (L.spokes && S.bandsSpec) {
        const n = S.bandsSpec.length;
        const seg = TAU / sym;
        const r0 = Rad * 0.2;
        g.lineWidth = Math.max(1.2, Rad * 0.012);
        for (let b = 0; b < n; b++) {
          const v = S.bandsSpec[b];
          if (v < 0.05) continue;
          g.strokeStyle = this.col(R, b % 4, 0.75 * k);
          g.beginPath();
          for (let j = 0; j < sym; j++) {
            for (const sgn of [1, -1]) {
              const a = rot * 0.5 + j * seg + sgn * (b / n) * seg * 0.5;
              g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
              g.lineTo(cx + Math.cos(a) * (r0 + v * Rad * 0.75 * k), cy + Math.sin(a) * (r0 + v * Rad * 0.75 * k));
            }
          }
          g.stroke();
        }
      }

      if (L.wave && S.tl) {
        g.strokeStyle = this.col(R, 1, 0.9 * k);
        g.lineWidth = 1.6;
        g.beginPath();
        const M = 200;
        for (let i = 0; i <= M; i++) {
          const a = rot * 0.3 + i / M * TAU;
          const v = S.tl[(i % M) * 8] || 0;
          const rr = Rad * 0.42 + v * Rad * 0.45 * k;
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }

      if (L.rings) {
        this.rings = this.rings.filter((r) => r.life > 0);
        for (const r of this.rings) {
          r.r += dt * (0.9 + 0.6 * r.life);
          r.life -= dt * 1.1;
          g.strokeStyle = this.col(R, r.c, Math.max(0, r.life) * 0.9 * k);
          g.lineWidth = 1 + r.life * 5 * k;
          if (r.dash) g.setLineDash([6, 8]);
          g.beginPath();
          const sides = sym >= 3 ? sym : 0;
          const rr = r.r * Rad;
          if (!sides) g.arc(cx, cy, rr, 0, TAU);
          else for (let j = 0; j <= sides; j++) {
            const a = -rot + j * TAU / sides;
            const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
            if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
          g.setLineDash([]);
        }
      }

      if (L.shapes) {
        this.shapes = this.shapes.filter((s) => s.life > 0);
        const seg = TAU / sym;
        for (const s of this.shapes) {
          s.life -= dt * 0.55;
          s.r += dt * 0.08;
          s.rot += s.vr * dt;
          const a0 = s.a;
          g.fillStyle = this.col(R, s.c, Math.max(0, s.life) * 0.85 * k);
          g.beginPath();
          for (let j = 0; j < sym; j++) {
            const angles = sym > 1 ? [a0 + rot + j * seg, -a0 + rot + j * seg] : [a0 + rot];
            for (const a of angles) {
              shapePath(g, R.shape, cx + Math.cos(a) * s.r * Rad, cy + Math.sin(a) * s.r * Rad, s.s * Rad * (0.6 + 0.4 * s.life + this.pulse * 0.2), s.rot);
            }
          }
          g.fill();
        }
      }

      if (L.glitter) {
        const rate = (S.highs * 4 + this.pulse * 2 + energy) * 40 * k;
        let n = Math.floor(rate * dt + Math.random());
        while (n-- > 0 && this.sparks.length < 220) {
          this.sparks.push({ x: Math.random() * w, y: Math.random() * h, life: 1, s: 1.5 + Math.random() * 4, c: Math.floor(Math.random() * 4) });
        }
        this.sparks = this.sparks.filter((p) => p.life > 0);
        g.lineWidth = 1;
        for (const p of this.sparks) {
          p.life -= dt * 1.8;
          const s = p.s * (0.4 + p.life);
          g.strokeStyle = this.col(R, p.c, Math.max(0, p.life) * k);
          g.beginPath();
          g.moveTo(p.x - s, p.y); g.lineTo(p.x + s, p.y);
          g.moveTo(p.x, p.y - s); g.lineTo(p.x, p.y + s);
          g.stroke();
        }
      }

      g.globalCompositeOperation = 'source-over';
      g.lineCap = 'butt';
    }
  }

  root.Fx = { generate, FxRenderer, LAYERS, POSTS, SHAPES, PALETTES, BLENDS, makePalette };
})(window);
