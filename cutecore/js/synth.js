/* cutecore — offline synthesizer.
 * Renders a Song (song.js) into an AudioBuffer with an OfflineAudioContext:
 * FM music-box bells, sparkle glass, plucky arp, supersaw future-bass stabs
 * with sidechain pumping, soft pads, sub bass, and a small drum kit.
 */
(function (root) {
  'use strict';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function makeNoise(ctx) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function makeIR(ctx, seconds, decay) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const pre = Math.floor(sr * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = pre; i < len; i++) {
        const p = (i - pre) / (len - pre);
        const a = 0.55 - 0.47 * p;            // darker tail
        y += ((Math.random() * 2 - 1) - y) * a;
        d[i] = y * Math.pow(1 - p, decay);
      }
    }
    return buf;
  }


  const tick = () => new Promise((r) => setTimeout(r, 0));
  const OAC = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;

  /* Render steps [s0, s1) plus a tail into a 6-channel buffer:
   * 0-1 dry, 2-3 reverb send, 4-5 delay send. Small graphs render fast. */
  function renderChunk(song, sr, stepDur, s0, s1, tail) {
    const t0 = s0 * stepDur;
    const dur = (s1 - s0) * stepDur + tail;
    const Ctx = OAC();
    const ctx = new Ctx(6, Math.ceil(dur * sr), sr);
    ctx.destination.channelInterpretation = 'discrete';
    const noise = makeNoise(ctx);
    const T = (step) => step * stepDur - t0;
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };

    const merger = ctx.createChannelMerger(6);
    merger.connect(ctx.destination);
    const outBus = (i) => {
      const g = gain(1);
      g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers';
      const sp = ctx.createChannelSplitter(2);
      g.connect(sp); sp.connect(merger, 0, i); sp.connect(merger, 1, i + 1);
      return g;
    };
    const dryOut = outBus(0), revOut = outBus(2), dlyOut = outBus(4);
    const duck = gain(1);
    duck.connect(dryOut);

    function bus(level, revAmt, dlyAmt, ducked) {
      const g = gain(level);
      g.connect(ducked ? duck : dryOut);
      if (revAmt) { const s = gain(revAmt); g.connect(s); s.connect(revOut); }
      if (dlyAmt) { const s = gain(dlyAmt); g.connect(s); s.connect(dlyOut); }
      return g;
    }
    const B = {
      bell: bus(0.26, 0.35, 0.3),
      spark: bus(0.13, 0.65, 0.5),
      arp: bus(0.075, 0.22, 0.18),
      pad: bus(0.05, 0.5, 0, true),
      chord: bus(0.045, 0.25, 0.06, true),
      bass: bus(0.4, 0, 0, true),
      kick: bus(0.9, 0, 0),
      snare: bus(0.32, 0.25, 0),
      hat: bus(0.11, 0.05, 0),
      fx: bus(0.2, 0.45, 0),
      crash: bus(0.13, 0.5, 0),
    };

    const pan = (node, p, dest) => {
      const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pn) { pn.pan.value = p; node.connect(pn); pn.connect(dest); }
      else node.connect(dest);
    };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const noiseSrc = (t, d) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.start(t, Math.random() * 1.4, d + 0.05);
      return s;
    };
    // ---- voices
    function bell(n, t, d, o) {
      const f = mtof(n.midi), v = n.vel;
      const car = osc('sine', f), mod = osc('sine', f * o.ratio);
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * o.index * v, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(0.5, f * 0.03), t + o.mdec);
      mod.connect(mg); mg.connect(car.frequency);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(v, t + 0.003);
      amp.gain.exponentialRampToValueAtTime(v * 0.3, t + Math.max(0.05, d));
      amp.gain.exponentialRampToValueAtTime(0.0001, t + d + o.decay);
      car.connect(amp);
      const tine = osc('sine', f * 4.01), tg = ctx.createGain();
      tg.gain.setValueAtTime(v * 0.12, t);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      tine.connect(tg); tg.connect(amp);
      pan(amp, o.pan, o.bus);
      const end = t + d + o.decay + 0.05;
      [car, mod].forEach((x) => { x.start(t); x.stop(end); });
      tine.start(t); tine.stop(t + 0.2);
    }

    function arp(n, t, d, p) {
      const f = mtof(n.midi);
      const a = osc('square', f), b = osc('triangle', f * 2);
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.Q.value = 3;
      flt.frequency.setValueAtTime(5000, t);
      flt.frequency.exponentialRampToValueAtTime(700, t + 0.14);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(n.vel, t + 0.003);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, d) + 0.1);
      a.connect(flt); b.connect(flt); flt.connect(amp);
      pan(amp, p, B.arp);
      const end = t + d + 0.15;
      a.start(t); b.start(t); a.stop(end); b.stop(end);
    }

    function padGroup(group, t, d) {
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.Q.value = 0.6;
      flt.frequency.value = group[0].cut || 1200;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(1, t + 0.35);
      amp.gain.setValueAtTime(1, t + d);
      amp.gain.linearRampToValueAtTime(0, t + d + 0.9);
      const merge = ctx.createChannelMerger(2);
      const end = t + d + 1;
      group.forEach((n) => {
        const f = mtof(n.midi);
        const l = osc('sawtooth', f), r = osc('sawtooth', f);
        l.detune.value = -9; r.detune.value = 9;
        const gl = gain(n.vel), gr = gain(n.vel);
        l.connect(gl); r.connect(gr);
        gl.connect(merge, 0, 0); gr.connect(merge, 0, 1);
        l.start(t); r.start(t); l.stop(end); r.stop(end);
      });
      merge.connect(flt); flt.connect(amp); amp.connect(B.pad);
    }

    function chordGroup(group, t, d) {
      const v = group[0].vel;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.Q.value = 1.4;
      flt.frequency.setValueAtTime(5500, t);
      flt.frequency.exponentialRampToValueAtTime(900, t + Math.max(0.08, d * 0.95));
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(v, t + 0.004);
      amp.gain.setTargetAtTime(v * 0.6, t + 0.02, 0.08);
      amp.gain.setValueAtTime(v * 0.6, t + d);
      amp.gain.linearRampToValueAtTime(0, t + d + 0.1);
      const merge = ctx.createChannelMerger(2);
      const end = t + d + 0.12;
      group.forEach((n) => {
        const f = mtof(n.midi);
        [[-14, 0], [14, 1], [0, 0], [0, 1]].forEach(([det, chn], i) => {
          if (i === 3) return;
          const o = osc('sawtooth', f); o.detune.value = det;
          const g = gain(i === 2 ? 0.7 : 1);
          o.connect(g);
          if (i === 2) { g.connect(merge, 0, 0); g.connect(merge, 0, 1); }
          else g.connect(merge, 0, chn);
          o.start(t); o.stop(end);
        });
      });
      merge.connect(flt); flt.connect(amp); amp.connect(B.chord);
    }

    function bass(n, t, d) {
      const f = mtof(n.midi);
      const a = osc('sine', f), b = osc('triangle', f * 2);
      const bg = gain(0.22);
      const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 900;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(n.vel, t + 0.006);
      amp.gain.setValueAtTime(n.vel, t + d);
      amp.gain.linearRampToValueAtTime(0, t + d + 0.07);
      a.connect(flt); b.connect(bg); bg.connect(flt); flt.connect(amp); amp.connect(B.bass);
      const end = t + d + 0.1;
      a.start(t); b.start(t); a.stop(end); b.stop(end);
    }

    function kick(h, t) {
      const o = osc('sine', 170);
      o.frequency.setValueAtTime(170, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(h.vel, t);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      o.connect(amp); amp.connect(B.kick);
      o.start(t); o.stop(t + 0.45);
      const c = noiseSrc(t, 0.012);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(h.vel * 0.25, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
      c.connect(hp); hp.connect(cg); cg.connect(B.kick);
    }

    function snare(h, t) {
      const s = noiseSrc(t, 0.25);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 3200; bp.gain.value = 6;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(h.vel, t);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      s.connect(hp); hp.connect(bp); bp.connect(amp); amp.connect(B.snare);
      const o = osc('triangle', 220);
      o.frequency.setValueAtTime(230, t);
      o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
      const og = ctx.createGain();
      og.gain.setValueAtTime(h.vel * 0.7, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(og); og.connect(B.snare);
      o.start(t); o.stop(t + 0.12);
    }

    let hatSide = 1;
    function hat(h, t, open) {
      const d = open ? 0.22 : 0.04;
      const s = noiseSrc(t, d);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(h.vel, t);
      amp.gain.exponentialRampToValueAtTime(0.001, t + d);
      s.connect(hp); hp.connect(amp);
      hatSide = -hatSide;
      pan(amp, hatSide * 0.25, B.hat);
    }

    function crash(h, t) {
      const s = noiseSrc(t, 1.9);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(h.vel, t);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      s.connect(hp); hp.connect(amp); amp.connect(B.crash);
    }

    function riser(h, t) {
      const d = (h.len || 32) * stepDur;
      const s = noiseSrc(t, d);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(9000, t + d);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(h.vel, t + d);
      amp.gain.linearRampToValueAtTime(0, t + d + 0.02);
      s.connect(bp); bp.connect(amp); amp.connect(B.fx);
    }


    // ---- schedule notes
    const groups = new Map();
    let sparkSide = 1;
    let arpSide = 1;
    for (const n of song.notes) {
      if (n.step < s0) continue;
      if (n.step >= s1) break;
      const t = T(n.step), d = n.len * stepDur;
      if (n.inst === 'pad' || n.inst === 'chord') {
        const key = n.inst + '@' + n.step;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
      } else if (n.inst === 'bell') {
        bell(n, t, d, { ratio: 3.5, index: 2.4, mdec: 0.4, decay: 1.2, pan: (n.midi - 74) / 40, bus: B.bell });
      } else if (n.inst === 'spark') {
        sparkSide = -sparkSide;
        bell(n, t, d, { ratio: 7.02, index: 1.3, mdec: 0.2, decay: 0.9, pan: sparkSide * (0.4 + Math.random() * 0.45), bus: B.spark });
      } else if (n.inst === 'arp') {
        arpSide = -arpSide;
        arp(n, t, d, arpSide * 0.45);
      } else if (n.inst === 'bass') {
        bass(n, t, d);
      }
    }
    groups.forEach((g, key) => {
      const n = g[0];
      const t = T(n.step), d = n.len * stepDur;
      if (key[0] === 'p') padGroup(g, t, d); else chordGroup(g, t, d);
    });

    // ---- schedule hits (+ sidechain pumping)
    for (const h of song.hits) {
      if (h.step < s0) continue;
      if (h.step >= s1) break;
      const t = T(h.step);
      switch (h.inst) {
        case 'kick': kick(h, t); break;
        case 'snare': snare(h, t); break;
        case 'hat': hat(h, t, false); break;
        case 'ohat': hat(h, t, true); break;
        case 'crash': crash(h, t); break;
        case 'riser': riser(h, t); break;
      }
      if (h.inst === 'kick' && h.duck) {
        duck.gain.setValueAtTime(0.22, t);
        duck.gain.setTargetAtTime(1, t + 0.03, 0.07);
      }
    }
    return startRendering(ctx);
  }

  function startRendering(ctx) {
    return new Promise((resolve, reject) => {
      let done = false;
      ctx.oncomplete = (e) => { if (!done) { done = true; resolve(e.renderedBuffer); } };
      const p = ctx.startRendering();
      if (p && p.then) p.then((b) => { if (!done) { done = true; resolve(b); } }, reject);
    });
  }

  async function render(song, sampleRate, onProgress) {
    const sr = Math.min(sampleRate || 44100, 44100);
    const stepDur = 60 / song.bpm / 4;
    const steps = song.bars * 16;
    const total = steps * stepDur;
    const len = Math.ceil(total * sr);
    const Ctx = OAC();
    const mix = new Ctx(2, len, sr);
    const stems = [mix.createBuffer(2, len, sr), mix.createBuffer(2, len, sr), mix.createBuffer(2, len, sr)];
    const sd = stems.map((b) => [b.getChannelData(0), b.getChannelData(1)]);

    const CHUNK = 32, TAIL = 2.6;
    const n = Math.ceil(steps / CHUNK);
    for (let c = 0; c < n; c++) {
      const s0 = c * CHUNK, s1 = Math.min(steps, s0 + CHUNK);
      const buf = await renderChunk(song, sr, stepDur, s0, s1, TAIL);
      const off = Math.round(s0 * stepDur * sr);
      for (let k = 0; k < 6; k++) {
        const src = buf.getChannelData(k);
        const dst = sd[k >> 1][k & 1];
        const m = Math.min(src.length, len - off);
        for (let i = 0; i < m; i++) dst[off + i] += src[i];
      }
      if (onProgress) onProgress(0.9 * (c + 1) / n);
      await tick();
    }

    // ---- final pass: shared reverb, ping-pong delay, glue compressor, limiter
    const ctx = mix;
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const play = (b) => { const s = ctx.createBufferSource(); s.buffer = b; s.start(0); return s; };
    const master = gain(0.42);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3.5;
    comp.attack.value = 0.006; comp.release.value = 0.14;
    const makeup = gain(1.5);
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.001; lim.release.value = 0.06;
    const trim = gain(0.84);
    master.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(trim); trim.connect(ctx.destination);

    const rev = ctx.createConvolver();
    rev.buffer = makeIR(ctx, 3.2, 3);
    const revRet = gain(0.55);
    rev.connect(revRet); revRet.connect(master);

    const dIn = gain(1);
    dIn.channelCount = 1; dIn.channelCountMode = 'explicit';
    const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
    dL.delayTime.value = stepDur * 3; dR.delayTime.value = stepDur * 3;
    const fbL = gain(0.42), fbR = gain(0.42);
    const dTone = ctx.createBiquadFilter(); dTone.type = 'lowpass'; dTone.frequency.value = 4200;
    const merge = ctx.createChannelMerger(2);
    dIn.connect(dTone); dTone.connect(dL);
    dL.connect(fbL); fbL.connect(dR);
    dR.connect(fbR); fbR.connect(dL);
    dL.connect(merge, 0, 0); dR.connect(merge, 0, 1);
    const dRet = gain(0.5);
    merge.connect(dRet); dRet.connect(master);
    const dRev = gain(0.25); dRet.connect(dRev); dRev.connect(rev);

    play(stems[0]).connect(master);
    play(stems[1]).connect(rev);
    play(stems[2]).connect(dIn);

    if (onProgress && typeof ctx.suspend === 'function') {
      for (let k = 1; k < 5; k++) {
        const at = Math.round((total * k / 5 * sr) / 128) * 128 / sr;
        try { ctx.suspend(at).then(() => { onProgress(0.9 + 0.1 * k / 5); ctx.resume(); }).catch(() => {}); } catch (e) { break; }
      }
    }
    return startRendering(ctx);
  }

  root.Synth = { render, mtof };
})(window);
