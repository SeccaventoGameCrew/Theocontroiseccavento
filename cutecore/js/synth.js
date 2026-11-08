/* cutecore — live synthesizer.
 * Plays a Song (song.js) in real time with a look-ahead scheduler, so parts can
 * be muted, soloed and re-voiced, and notes edited, while the song is playing.
 * Instruments: FM music-box bells, sparkle glass, plucky arp, supersaw
 * future-bass chords and pads with sidechain pumping, sub bass, drum kit.
 */
(function (root) {
  'use strict';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mod = (a, n) => ((a % n) + n) % n;

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
        const a = 0.55 - 0.47 * p;
        y += ((Math.random() * 2 - 1) - y) * a;
        d[i] = y * Math.pow(1 - p, decay);
      }
    }
    return buf;
  }

  function lowerBound(arr, step) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].step < step) lo = m + 1; else hi = m; }
    return lo;
  }

  // Mixer parts. base = fader level at vol 1, rev/dly = send levels at space 0.5.
  const PARTS = [
    { id: 'bell',  ch: 1, label: 'BELL',   base: 0.26,  rev: 0.35, dly: 0.3 },
    { id: 'arp',   ch: 2, label: 'ARP',    base: 0.075, rev: 0.22, dly: 0.18 },
    { id: 'chord', ch: 3, label: 'CHORDS', base: 0.045, rev: 0.4,  dly: 0.04, duck: true },
    { id: 'bass',  ch: 4, label: 'BASS',   base: 0.4,   rev: 0,    dly: 0,    duck: true },
    { id: 'spark', ch: 5, label: 'SPARK',  base: 0.13,  rev: 0.65, dly: 0.5 },
    { id: 'drums', ch: 6, label: 'DRUMS',  base: 1,     rev: 0.2,  dly: 0 },
  ];
  const PART_OF_INST = { bell: 'bell', spark: 'spark', arp: 'arp', pad: 'chord', chord: 'chord', bass: 'bass' };
  const PART_OF_CH = { 1: 'bell', 2: 'arp', 3: 'chord', 4: 'bass', 5: 'spark', 6: 'drums' };
  const DRUM_GROUP = { kick: 'kick', snare: 'snare', hat: 'hat', ohat: 'hat', crash: 'fx', riser: 'fx' };

  const defaultParams = () => {
    const p = {};
    PARTS.forEach((d) => { p[d.id] = { vol: 1, mute: false, solo: false, tone: 0.5, decay: 0.5, space: 0.5 }; });
    p.drums.kick = true; p.drums.snare = true; p.drums.hat = true; p.drums.fx = true;
    return p;
  };
  const F = (x) => 0.35 + 1.3 * x;   // 0.5 -> 1

  class LiveSynth {
    constructor(ctx, output) {
      this.ctx = ctx;
      this.noise = makeNoise(ctx);
      this.params = defaultParams();
      this.swing = 0;
      this.song = null;
      this.total = 16;
      this.stepDur = 0.134;
      this.playing = false;
      this.posStep = 0;
      this.anchorStep = 0; this.anchorTime = 0; this.schedStep = 0;
      this.sess = null;
      this.timer = null;
      this.onPlayState = null;

      const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
      this.gain = gain;

      // master chain
      this.master = gain(0.42);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3.5;
      comp.attack.value = 0.006; comp.release.value = 0.14;
      const makeup = gain(1.5);
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
      lim.attack.value = 0.001; lim.release.value = 0.06;
      this.masterVol = gain(0.84);
      this.master.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(this.masterVol); this.masterVol.connect(output);

      // reverb
      this.rev = ctx.createConvolver();
      this.rev.buffer = makeIR(ctx, 3.2, 3);
      const revRet = gain(0.55);
      this.rev.connect(revRet); revRet.connect(this.master);

      // ping-pong delay (3/16)
      this.dIn = gain(1);
      this.dIn.channelCount = 1; this.dIn.channelCountMode = 'explicit';
      this.dL = ctx.createDelay(2); this.dR = ctx.createDelay(2);
      const fbL = gain(0.42), fbR = gain(0.42);
      const dTone = ctx.createBiquadFilter(); dTone.type = 'lowpass'; dTone.frequency.value = 4200;
      const merge = ctx.createChannelMerger(2);
      this.dIn.connect(dTone); dTone.connect(this.dL);
      this.dL.connect(fbL); fbL.connect(this.dR);
      this.dR.connect(fbR); fbR.connect(this.dL);
      this.dL.connect(merge, 0, 0); this.dR.connect(merge, 0, 1);
      const dRet = gain(0.5);
      merge.connect(dRet); dRet.connect(this.master);
      const dRev = gain(0.25); dRet.connect(dRev); dRev.connect(this.rev);

      // sidechain duck bus
      this.duck = gain(1);
      this.duck.connect(this.master);

      // parts: in -> fader -> (duck|master), fader -> sends
      this.parts = {};
      PARTS.forEach((d) => {
        const p = { def: d, in: gain(1), fader: gain(d.base), revS: gain(d.rev), dlyS: gain(d.dly) };
        p.in.connect(p.fader);
        p.fader.connect(d.duck ? this.duck : this.master);
        p.fader.connect(p.revS); p.revS.connect(this.rev);
        p.fader.connect(p.dlyS); p.dlyS.connect(this.dIn);
        this.parts[d.id] = p;
      });
      // drum pieces with their own reverb sends
      const D = this.parts.drums;
      this.drumBus = {};
      [['kick', 0.9, 0], ['snare', 0.32, 0.25], ['hat', 0.11, 0.05], ['fx', 0.2, 0.45], ['crash', 0.13, 0.5]].forEach(([k, lvl, send]) => {
        const g = gain(lvl);
        g.connect(D.in);
        const s = gain(send);
        g.connect(s); s.connect(this.rev);
        this.drumBus[k] = { g, s, send };
      });
      this.applyMix();
    }

    // ---------------------------------------------------------------- mix
    audible(id) {
      const p = this.params;
      const anySolo = PARTS.some((d) => p[d.id].solo);
      return !p[id].mute && (!anySolo || p[id].solo);
    }
    audibleNote(n) {
      return this.audible(PART_OF_CH[n.ch] || 'bell');
    }
    audibleHit(h) {
      const g = DRUM_GROUP[h.inst];
      return this.audible('drums') && (!g || this.params.drums[g] !== false);
    }
    applyMix() {
      const now = this.ctx.currentTime;
      PARTS.forEach((d) => {
        const p = this.parts[d.id], q = this.params[d.id];
        const on = this.audible(d.id) ? 1 : 0;
        p.fader.gain.setTargetAtTime(d.base * q.vol * on, now, 0.015);
        p.revS.gain.setTargetAtTime(d.rev * q.space * 2, now, 0.03);
        p.dlyS.gain.setTargetAtTime(d.dly * q.space * 2, now, 0.03);
      });
      const sp = this.params.drums.space * 2;
      Object.values(this.drumBus).forEach((b) => b.s.gain.setTargetAtTime(b.send * sp, now, 0.03));
    }
    setMaster(v) { this.masterVol.gain.setTargetAtTime(0.84 * v, this.ctx.currentTime, 0.02); }

    // ---------------------------------------------------------------- transport
    setSong(song) {
      const was = this.playing;
      if (was) this.pause();
      this.song = song;
      this.total = song.bars * 16;
      this.posStep = 0;
      this.setTempo(song.bpm);
      if (was) this.play();
    }
    get duration() { return this.total * this.stepDur; }
    absAt(t) { return this.anchorStep + (t - this.anchorTime) / this.stepDur; }
    tAtAbs(x) { return this.anchorTime + (x - this.anchorStep) * this.stepDur; }
    time() {
      if (!this.song) return 0;
      if (!this.playing) return this.posStep * this.stepDur;
      const now = this.ctx.currentTime - (this.ctx.outputLatency || 0);
      return mod(this.absAt(now), this.total) * this.stepDur;
    }
    setTempo(bpm) {
      bpm = clamp(Math.round(bpm), 60, 200);
      if (this.playing) {
        this.anchorStep = this.absAt(this.ctx.currentTime);
        this.anchorTime = this.ctx.currentTime;
      }
      this.bpm = bpm;
      if (this.song) this.song.bpm = bpm;
      this.stepDur = 60 / bpm / 4;
      const now = this.ctx.currentTime;
      this.dL.delayTime.setTargetAtTime(this.stepDur * 3, now, 0.05);
      this.dR.delayTime.setTargetAtTime(this.stepDur * 3, now, 0.05);
    }
    newSession() {
      const s = {};
      PARTS.forEach((d) => { s[d.id] = this.gain(1); s[d.id].connect(this.parts[d.id].in); });
      Object.keys(this.drumBus).forEach((k) => { s['d_' + k] = this.gain(1); s['d_' + k].connect(this.drumBus[k].g); });
      this.sess = s;
    }
    killSession() {
      const s = this.sess;
      if (!s) return;
      const now = this.ctx.currentTime;
      Object.values(s).forEach((g) => g.gain.setTargetAtTime(0, now, 0.012));
      setTimeout(() => Object.values(s).forEach((g) => g.disconnect()), 250);
      this.sess = null;
    }
    play() {
      if (!this.song || this.playing) return;
      this.ctx.resume();
      this.newSession();
      this.anchorTime = this.ctx.currentTime + 0.06;
      this.anchorStep = this.posStep;
      this.schedStep = this.posStep;
      this.playing = true;
      this.timer = setInterval(() => this.tick(), 25);
      this.tick();
      if (this.onPlayState) this.onPlayState(true);
    }
    pause() {
      if (!this.playing) return;
      this.posStep = mod(this.absAt(this.ctx.currentTime), this.total);
      clearInterval(this.timer);
      this.killSession();
      this.playing = false;
      if (this.onPlayState) this.onPlayState(false);
    }
    seek(sec) {
      const was = this.playing;
      if (was) this.pause();
      this.posStep = clamp(sec / this.stepDur, 0, this.total - 0.01);
      if (was) this.play();
    }

    // ---------------------------------------------------------------- scheduler
    tick() {
      if (!this.playing || !this.song) return;
      const ctx = this.ctx;
      const look = document.hidden ? 1.5 : 0.22;
      const until = this.absAt(ctx.currentTime + look);
      let guard = 0;
      while (this.schedStep < until && guard++ < 4) {
        const base = Math.floor(this.schedStep / this.total) * this.total;
        const from = this.schedStep - base;
        const to = Math.min(until - base, this.total);
        this.scheduleRange(from, to, base);
        this.schedStep = base + to;
      }
    }
    when(base, step) {
      let t = this.tAtAbs(base + step);
      if (this.swing && step % 2 === 1) t += this.swing * this.stepDur;
      return t;
    }
    scheduleRange(from, to, base) {
      const song = this.song, now = this.ctx.currentTime, s = this.sess;
      if (!s) return;
      const notes = song.notes;
      const groups = new Map();
      for (let i = lowerBound(notes, from); i < notes.length && notes[i].step < to; i++) {
        const n = notes[i];
        const t = this.when(base, n.step);
        if (t < now - 0.01) continue;
        const d = n.len * this.stepDur;
        const pid = PART_OF_INST[n.inst] || PART_OF_CH[n.ch] || 'bell';
        if (n.inst === 'pad' || n.inst === 'chord') {
          const key = n.inst + '@' + n.step;
          if (!groups.has(key)) groups.set(key, { t, d, list: [] });
          groups.get(key).list.push(n);
        } else this.voice(n, t, d, s[pid]);
      }
      groups.forEach((g, key) => {
        if (key[0] === 'p') this.padGroup(g.list, g.t, g.d, s.chord);
        else this.chordGroup(g.list, g.t, g.d, s.chord);
      });
      const hits = song.hits;
      const dp = this.params.drums;
      for (let i = lowerBound(hits, from); i < hits.length && hits[i].step < to; i++) {
        const h = hits[i];
        const grp = DRUM_GROUP[h.inst];
        if (grp && dp[grp] === false) continue;
        const t = this.when(base, h.step);
        if (t < now - 0.01) continue;
        this.hit(h, t, s);
        if (h.inst === 'kick' && h.duck && this.audible('drums')) {
          this.duck.gain.setValueAtTime(0.22, t);
          this.duck.gain.setTargetAtTime(1, t + 0.03, 0.07);
        }
      }
    }

    // audition a single note immediately (used by the editor)
    preview(n) {
      this.ctx.resume();
      const t = this.ctx.currentTime + 0.02;
      const d = Math.min(n.len, 4) * this.stepDur;
      const pid = PART_OF_INST[n.inst] || PART_OF_CH[n.ch] || 'bell';
      const dest = this.parts[pid].in;
      if (n.inst === 'pad') this.padGroup([n], t, d, dest);
      else if (n.inst === 'chord') this.chordGroup([n], t, d, dest);
      else this.voice(n, t, d, dest);
    }

    // ---------------------------------------------------------------- voices
    osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
    pan(node, p, dest) {
      const ctx = this.ctx;
      if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = p; node.connect(pn); pn.connect(dest); }
      else node.connect(dest);
    }
    noiseSrc(t, d) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      s.start(t, Math.random() * 1.4, d + 0.05);
      return s;
    }
    voice(n, t, d, dest) {
      const P = this.params;
      if (n.inst === 'bell') {
        const q = P.bell;
        this.bell(n, t, d, { ratio: 3.5, index: 2.4 * F(q.tone), mdec: 0.4, decay: 1.2 * F(q.decay), pan: (n.midi - 74) / 40 }, dest);
      } else if (n.inst === 'spark') {
        const q = P.spark;
        this._sp = -(this._sp || 1);
        this.bell(n, t, d, { ratio: 7.02, index: 1.3 * F(q.tone), mdec: 0.2, decay: 0.9 * F(q.decay), pan: this._sp * (0.4 + Math.random() * 0.45) }, dest);
      } else if (n.inst === 'arp') {
        this._ap = -(this._ap || 1);
        this.arp(n, t, d, this._ap * 0.45, P.arp, dest);
      } else if (n.inst === 'bass') {
        this.bass(n, t, d, P.bass, dest);
      }
    }
    bell(n, t, d, o, dest) {
      const ctx = this.ctx;
      const f = mtof(n.midi), v = n.vel;
      const car = this.osc('sine', f), mod_ = this.osc('sine', f * o.ratio);
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * o.index * v, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(0.5, f * 0.03), t + o.mdec);
      mod_.connect(mg); mg.connect(car.frequency);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(v, t + 0.003);
      amp.gain.exponentialRampToValueAtTime(v * 0.3, t + Math.max(0.05, d));
      amp.gain.exponentialRampToValueAtTime(0.0001, t + d + o.decay);
      car.connect(amp);
      const tine = this.osc('sine', f * 4.01), tg = ctx.createGain();
      tg.gain.setValueAtTime(v * 0.12, t);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      tine.connect(tg); tg.connect(amp);
      this.pan(amp, clamp(o.pan, -1, 1), dest);
      const end = t + d + o.decay + 0.05;
      car.start(t); mod_.start(t); car.stop(end); mod_.stop(end);
      tine.start(t); tine.stop(t + 0.2);
    }
    arp(n, t, d, p, q, dest) {
      const ctx = this.ctx;
      const f = mtof(n.midi);
      const a = this.osc('square', f), b = this.osc('triangle', f * 2);
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.Q.value = 3;
      flt.frequency.setValueAtTime(5000 * F(q.tone), t);
      flt.frequency.exponentialRampToValueAtTime(700 * F(q.tone), t + 0.14 * F(q.decay));
      const amp = ctx.createGain();
      const tail = 0.1 * F(q.decay);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(n.vel, t + 0.003);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, d) + tail);
      a.connect(flt); b.connect(flt); flt.connect(amp);
      this.pan(amp, p, dest);
      const end = t + Math.max(0.12, d) + tail + 0.05;
      a.start(t); b.start(t); a.stop(end); b.stop(end);
    }
    padGroup(group, t, d, dest) {
      const ctx = this.ctx, q = this.params.chord;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.Q.value = 0.6;
      flt.frequency.value = (group[0].cut || 1200) * F(q.tone);
      const rel = 0.9 * F(q.decay);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(1.1, t + 0.35);
      amp.gain.setValueAtTime(1.1, t + d);
      amp.gain.linearRampToValueAtTime(0, t + d + rel);
      const merge = ctx.createChannelMerger(2);
      const end = t + d + rel + 0.05;
      group.forEach((n) => {
        const f = mtof(n.midi);
        const l = this.osc('sawtooth', f), r = this.osc('sawtooth', f);
        l.detune.value = -9; r.detune.value = 9;
        const gl = this.gain(n.vel), gr = this.gain(n.vel);
        l.connect(gl); r.connect(gr);
        gl.connect(merge, 0, 0); gr.connect(merge, 0, 1);
        l.start(t); r.start(t); l.stop(end); r.stop(end);
      });
      merge.connect(flt); flt.connect(amp); amp.connect(dest);
    }
    chordGroup(group, t, d, dest) {
      const ctx = this.ctx, q = this.params.chord;
      const v = group[0].vel;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.Q.value = 1.4;
      flt.frequency.setValueAtTime(5500 * F(q.tone), t);
      flt.frequency.exponentialRampToValueAtTime(900 * F(q.tone), t + Math.max(0.08, d * 0.95));
      const rel = 0.1 * F(q.decay);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(v, t + 0.004);
      amp.gain.setTargetAtTime(v * 0.6, t + 0.02, 0.08 * F(q.decay));
      amp.gain.setValueAtTime(v * 0.6, t + d);
      amp.gain.linearRampToValueAtTime(0, t + d + rel);
      const merge = ctx.createChannelMerger(2);
      const end = t + d + rel + 0.02;
      group.forEach((n) => {
        const f = mtof(n.midi);
        [[-14, 0, 1], [14, 1, 1], [0, -1, 0.7]].forEach(([det, chn, lvl]) => {
          const o = this.osc('sawtooth', f); o.detune.value = det;
          const g = this.gain(lvl);
          o.connect(g);
          if (chn < 0) { g.connect(merge, 0, 0); g.connect(merge, 0, 1); } else g.connect(merge, 0, chn);
          o.start(t); o.stop(end);
        });
      });
      merge.connect(flt); flt.connect(amp); amp.connect(dest);
    }
    bass(n, t, d, q, dest) {
      const ctx = this.ctx;
      const f = mtof(n.midi);
      const a = this.osc('sine', f), b = this.osc('triangle', f * 2);
      const bg = this.gain(0.22 * F(q.tone));
      const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 900 * F(q.tone);
      const rel = 0.07 * F(q.decay);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(n.vel, t + 0.006);
      amp.gain.setValueAtTime(n.vel, t + d);
      amp.gain.linearRampToValueAtTime(0, t + d + rel);
      a.connect(flt); b.connect(bg); bg.connect(flt); flt.connect(amp); amp.connect(dest);
      const end = t + d + rel + 0.03;
      a.start(t); b.start(t); a.stop(end); b.stop(end);
    }
    hit(h, t, s) {
      const ctx = this.ctx, q = this.params.drums;
      const dk = F(q.decay), tn = F(q.tone);
      switch (h.inst) {
        case 'kick': {
          const o = this.osc('sine', 170);
          o.frequency.setValueAtTime(170 * (0.8 + 0.2 * tn), t);
          o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
          const amp = ctx.createGain();
          amp.gain.setValueAtTime(h.vel, t);
          amp.gain.exponentialRampToValueAtTime(0.001, t + 0.42 * dk);
          o.connect(amp); amp.connect(s.d_kick);
          o.start(t); o.stop(t + 0.42 * dk + 0.03);
          const c = this.noiseSrc(t, 0.012);
          const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
          const cg = ctx.createGain();
          cg.gain.setValueAtTime(h.vel * 0.25 * tn, t);
          cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
          c.connect(hp); hp.connect(cg); cg.connect(s.d_kick);
          break;
        }
        case 'snare': {
          const n = this.noiseSrc(t, 0.25 * dk);
          const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900 * tn;
          const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 3200; pk.gain.value = 6;
          const amp = ctx.createGain();
          amp.gain.setValueAtTime(h.vel, t);
          amp.gain.exponentialRampToValueAtTime(0.001, t + 0.22 * dk);
          n.connect(hp); hp.connect(pk); pk.connect(amp); amp.connect(s.d_snare);
          const o = this.osc('triangle', 220);
          o.frequency.setValueAtTime(230, t);
          o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
          const og = ctx.createGain();
          og.gain.setValueAtTime(h.vel * 0.7, t);
          og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
          o.connect(og); og.connect(s.d_snare);
          o.start(t); o.stop(t + 0.12);
          break;
        }
        case 'hat':
        case 'ohat': {
          const d = (h.inst === 'ohat' ? 0.22 : 0.04) * dk;
          const n = this.noiseSrc(t, d);
          const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500 * (0.7 + 0.3 * tn);
          const amp = ctx.createGain();
          amp.gain.setValueAtTime(h.vel, t);
          amp.gain.exponentialRampToValueAtTime(0.001, t + d);
          n.connect(hp); hp.connect(amp);
          this._hp = -(this._hp || 1);
          this.pan(amp, this._hp * 0.25, s.d_hat);
          break;
        }
        case 'crash': {
          const n = this.noiseSrc(t, 1.9);
          const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
          const amp = ctx.createGain();
          amp.gain.setValueAtTime(h.vel, t);
          amp.gain.exponentialRampToValueAtTime(0.001, t + 1.8 * dk);
          n.connect(hp); hp.connect(amp); amp.connect(s.d_crash);
          break;
        }
        case 'riser': {
          const d = (h.len || 32) * this.stepDur;
          const n = this.noiseSrc(t, d);
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
          bp.frequency.setValueAtTime(300, t);
          bp.frequency.exponentialRampToValueAtTime(9000, t + d);
          const amp = ctx.createGain();
          amp.gain.setValueAtTime(0, t);
          amp.gain.linearRampToValueAtTime(h.vel, t + d);
          amp.gain.linearRampToValueAtTime(0, t + d + 0.02);
          n.connect(bp); bp.connect(amp); amp.connect(s.d_fx);
          break;
        }
      }
    }
  }

  root.Synth = { LiveSynth, PARTS, PART_OF_CH, PART_OF_INST, mtof, lowerBound };
})(window);
