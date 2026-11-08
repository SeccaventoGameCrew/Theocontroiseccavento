/* cutecore — app wiring: engines, meters, tracker, mixer, note editor, FX, UI. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const P = window.Panels;
  const fmtTime = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); const r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0'); };
  const fmtDb = (v) => (v <= -69.9 ? '-∞' : v.toFixed(1));
  const lufs = (ms) => (ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -70);
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ audio graph
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* iOS ringer */ }

  const out = ctx.createGain();
  const anM = ctx.createAnalyser(); anM.fftSize = 4096; anM.smoothingTimeConstant = 0.6;
  const split = ctx.createChannelSplitter(2);
  const anL = ctx.createAnalyser(); anL.fftSize = 2048; anL.smoothingTimeConstant = 0;
  const anR = ctx.createAnalyser(); anR.fftSize = 2048; anR.smoothingTimeConstant = 0;
  out.connect(ctx.destination);
  out.connect(anM);
  out.connect(split);
  split.connect(anL, 0); split.connect(anR, 1);
  // K-weighted metering path (BS.1770 approximation) for live loudness
  const kShelf = ctx.createBiquadFilter(); kShelf.type = 'highshelf'; kShelf.frequency.value = 1500; kShelf.gain.value = 4;
  const kHp = ctx.createBiquadFilter(); kHp.type = 'highpass'; kHp.frequency.value = 38; kHp.Q.value = 0.5;
  const kSplit = ctx.createChannelSplitter(2);
  const anKL = ctx.createAnalyser(); anKL.fftSize = 2048;
  const anKR = ctx.createAnalyser(); anKR.fftSize = 2048;
  out.connect(kShelf); kShelf.connect(kHp); kHp.connect(kSplit);
  kSplit.connect(anKL, 0); kSplit.connect(anKR, 1);

  // live synth (generated songs)
  const live = new Synth.LiveSynth(ctx, out);
  live.onPlayState = () => updatePlayButton();

  // buffer player (user audio files)
  const filePlayer = {
    buffer: null, src: null, offset: 0, t0: 0, playing: false, gain: ctx.createGain(),
    get duration() { return this.buffer ? this.buffer.duration : 0; },
    get stepDur() { return track ? track.stepDur : 0.134; },
    time() {
      if (!this.buffer) return 0;
      if (!this.playing) return this.offset;
      const t = ctx.currentTime - this.t0 - (ctx.outputLatency || 0);
      const d = this.duration;
      return ((t % d) + d) % d;
    },
    play() {
      if (!this.buffer || this.playing) return;
      ctx.resume();
      const s = ctx.createBufferSource();
      s.buffer = this.buffer; s.loop = true;
      s.connect(this.gain);
      s.start(0, this.offset % this.duration);
      this.src = s;
      this.t0 = ctx.currentTime - this.offset;
      this.playing = true;
      updatePlayButton();
    },
    pause() {
      if (!this.playing) return;
      this.offset = this.time();
      try { this.src.stop(); } catch (e) { /* already stopped */ }
      this.src.disconnect();
      this.src = null;
      this.playing = false;
      updatePlayButton();
    },
    seek(t) {
      const was = this.playing;
      if (was) this.pause();
      this.offset = Math.max(0, Math.min(this.duration - 0.01, t));
      if (was) this.play();
    },
    load(buf) { this.pause(); this.buffer = buf; this.offset = 0; },
  };
  filePlayer.gain.connect(out);

  let engine = live;
  let track = null;

  // ------------------------------------------------------------------ meters
  // File tracks: loudness precomputed from the buffer. Generated tracks: measured live.
  const liveMeter = {
    reset(duration) {
      this.blockDur = 0.1;
      this.nb = Math.max(1, Math.ceil(duration / 0.1));
      this.rms = new Float32Array(this.nb);
      this.shortTerm = new Float32Array(this.nb).fill(-70);
      this.hist = []; this.gate = [];
      this.integrated = -70; this.maxPeak = 0; this.lastBlock = -1;
      this.m = -70; this.s = -70;
    },
    push(t, now, ms, rms, peak) {
      const h = this.hist;
      h.push(now, ms);
      while (h.length > 2 && now - h[0] > 3) h.splice(0, 2);
      let sm = 0, sc = 0, mm = 0, mc = 0;
      for (let i = 0; i < h.length; i += 2) {
        sm += h[i + 1]; sc++;
        if (now - h[i] <= 0.4) { mm += h[i + 1]; mc++; }
      }
      this.m = lufs(mm / Math.max(1, mc));
      this.s = lufs(sm / Math.max(1, sc));
      const b = Math.min(this.nb - 1, Math.floor(t / 0.1));
      if (rms > this.rms[b]) this.rms[b] = rms;
      this.shortTerm[b] = this.s;
      if (peak > this.maxPeak) this.maxPeak = peak;
      if (b !== this.lastBlock) {
        this.lastBlock = b;
        if (this.m > -70) {
          const msm = mm / Math.max(1, mc);
          this.gate.push(msm);
          if (this.gate.length > 6000) this.gate.shift();
          let s = 0;
          for (const v of this.gate) s += v;
          const rel = lufs(s / this.gate.length) - 10;
          let s2 = 0, c2 = 0;
          for (const v of this.gate) if (lufs(v) > rel) { s2 += v; c2++; }
          this.integrated = c2 ? lufs(s2 / c2) : -70;
        }
      }
    },
    momentaryAt() { return this.m; },
    shortAt() { return this.s; },
    peakAt() { return this.maxPeak; },
  };
  function fileMeter(L) {
    return {
      blockDur: L.blockDur, nb: L.nb, rms: L.rms, shortTerm: L.shortTerm, integrated: L.integrated,
      idx(t) { return Math.min(L.nb - 1, Math.floor(t / L.blockDur)); },
      momentaryAt(t) { return L.momentary[this.idx(t)]; },
      shortAt(t) { return L.shortTerm[this.idx(t)]; },
      peakAt(t) { return L.peakPrefix[this.idx(t)]; },
    };
  }

  // ------------------------------------------------------------------ panels
  const panels = {
    sheet: new P.Sheet($('[data-cv=sheet]')),
    wave: new P.Wave($('[data-cv=wave]')),
    scope: new P.Scope($('[data-cv=scope]')),
    spectrum: new P.Spectrum($('[data-cv=spectrum]')),
    vector: new P.Vector($('[data-cv=vector]')),
    roll: new P.Roll($('[data-cv=roll]')),
    roots: new P.Roots($('[data-cv=roots]')),
    fountain: new P.Fountain($('[data-cv=fountain]')),
    orbit: new P.Orbit($('[data-cv=orbit]')),
  };

  // FX generator: stage panel + optional overlay over the whole board
  const fx = {
    recipe: Fx.generate(Math.floor(Math.random() * 100000)),
    stage: new Fx.FxRenderer(new P.Surface($('[data-cv=fx]'))),
    overlay: null,
    overlayOn: false,
    shake: 0, zoom: 0, flash: 0,
  };
  const overlayEl = $('#fx-overlay');

  const audibleNote = (n) => track && track.kind === 'gen' ? live.audibleNote(n) : true;
  const audibleHit = (h) => track && track.kind === 'gen' ? live.audibleHit(h) : true;

  // ------------------------------------------------------------------ tracker
  const tracker = {
    ni: 0, hi: 0, last: -1,
    reset() {
      this.ni = 0; this.hi = 0; this.last = -1e9;
      panels.roots.reset(); panels.sheet.reset(); panels.fountain.reset();
    },
    advance(step) {
      if (!track) return;
      if (step < this.last - 1) this.reset();
      const jump = step - this.last > 48;
      const notes = track.notes, hits = track.hits;
      while (this.ni < notes.length && notes[this.ni].step <= step) {
        const n = notes[this.ni++];
        if (!audibleNote(n)) continue;
        const instant = jump && n.step < step - 4;
        panels.roots.onNote(n, instant);
        panels.fountain.onNote(n, instant);
        fx.stage.onNote(n, instant, fx.recipe);
        if (fx.overlay) fx.overlay.onNote(n, instant, fx.recipe);
      }
      while (this.hi < hits.length && hits[this.hi].step <= step) {
        const h = hits[this.hi++];
        if (!audibleHit(h)) continue;
        const instant = jump && h.step < step - 4;
        panels.roots.onHit(h, instant, S);
        fx.stage.onHit(h, instant, fx.recipe);
        if (fx.overlay) fx.overlay.onHit(h, instant, fx.recipe);
        if (!instant) postHit(h);
      }
      this.last = step;
    },
    // after an edit, re-sync the cursors without replaying old events
    resync(step) {
      if (!track) return;
      this.ni = P.lowerBound(track.notes, step + 1e-6);
      while (this.ni < track.notes.length && track.notes[this.ni].step <= step) this.ni++;
    },
  };

  function postHit(h) {
    const R = fx.recipe;
    if (h.inst === 'kick') {
      S.kickPulse = 1;
      kaoBeat();
      if (R.post.zoom) fx.zoom = 1;
      if (R.post.flash) fx.flash = Math.max(fx.flash, 0.7);
      if (R.post.rgb) rgbPulse();
      if (R.post.shake) fx.shake = Math.max(fx.shake, 0.6);
    } else if (h.inst === 'snare') {
      if (R.post.shake) fx.shake = 1;
    } else if (h.inst === 'crash') {
      if (R.post.flash) fx.flash = 1;
    }
  }
  let rgbTimer = 0;
  const board = $('.board');
  function rgbPulse() {
    board.classList.add('fx-rgb');
    clearTimeout(rgbTimer);
    rgbTimer = setTimeout(() => board.classList.remove('fx-rgb'), 110);
  }

  // ------------------------------------------------------------------ frame state
  const S = {
    track: null, t: 0, step: 0, duration: 1, playing: false, dt: 0.016, bpm: 112,
    tl: new Float32Array(2048), tr: new Float32Array(2048),
    kl: new Float32Array(2048), kr: new Float32Array(2048),
    freq: new Float32Array(2048),
    bands6: new Float32Array(6), bandsSpec: new Float32Array(26),
    rmsL: 0, rmsR: 0, lows: 0, mids: 0, highs: 0, sides: 0, kickPulse: 0,
    loud: null, audibleNote, audibleHit,
  };
  const binHz = () => ctx.sampleRate / anM.fftSize;
  const SIX = [[30, 120], [120, 350], [350, 900], [900, 2200], [2200, 5500], [5500, 16000]];
  const SPEC = [];
  for (let i = 0; i <= 26; i++) SPEC.push(40 * Math.pow(16000 / 40, i / 26));

  function bandDb(f0, f1) {
    const hz = binHz();
    const a = Math.max(1, Math.floor(f0 / hz)), b = Math.max(a, Math.min(S.freq.length - 1, Math.ceil(f1 / hz)));
    let p = 0;
    for (let k = a; k <= b; k++) p += Math.pow(10, S.freq[k] / 10);
    return 10 * Math.log10(p / (b - a + 1) + 1e-20);
  }

  function computeFrame(dt) {
    S.dt = dt;
    S.track = track;
    S.playing = engine.playing;
    S.duration = engine.duration || 1;
    S.t = engine.time();
    S.step = track ? (S.t - track.offset) / track.stepDur : 0;
    S.bpm = track ? track.bpm : 112;
    anL.getFloatTimeDomainData(S.tl);
    anR.getFloatTimeDomainData(S.tr);
    anM.getFloatFrequencyData(S.freq);
    for (let i = 0; i < 6; i++) S.bands6[i] = Math.max(0, Math.min(1, (bandDb(SIX[i][0], SIX[i][1]) + 95) / 65));
    for (let i = 0; i < 26; i++) S.bandsSpec[i] = Math.max(0, Math.min(1, (bandDb(SPEC[i], SPEC[i + 1]) + 100) / 75));
    let l = 0, r = 0, m = 0, s = 0, pk = 0;
    for (let i = 0; i < S.tl.length; i++) {
      const a = S.tl[i], b = S.tr[i];
      l += a * a; r += b * b;
      m += (a + b) * (a + b); s += (a - b) * (a - b);
      const x = Math.max(a < 0 ? -a : a, b < 0 ? -b : b);
      if (x > pk) pk = x;
    }
    const N = S.tl.length;
    S.rmsL = Math.sqrt(l / N); S.rmsR = Math.sqrt(r / N);
    S.sides = m > 1e-9 ? Math.min(1, Math.sqrt(s / m)) : 0;
    const lv = (a, b) => Math.max(0, (bandDb(a, b) + 100) / 70);
    const lo = lv(20, 250), mi = lv(250, 4000), hi = lv(4000, 16000), tot = lo + mi + hi + 1e-9;
    S.lows = lo / tot; S.mids = mi / tot; S.highs = hi / tot;
    S.kickPulse *= Math.pow(0.02, dt);
    if (track && track.kind === 'gen') {
      if (engine.playing) {
        anKL.getFloatTimeDomainData(S.kl);
        anKR.getFloatTimeDomainData(S.kr);
        let kl = 0, kr = 0;
        for (let i = 0; i < N; i++) { kl += S.kl[i] * S.kl[i]; kr += S.kr[i] * S.kr[i]; }
        liveMeter.push(S.t, ctx.currentTime, (kl + kr) / N, Math.sqrt((l + r) / (2 * N)), pk);
      }
      S.loud = liveMeter;
    } else S.loud = track ? track.meter : null;
  }

  // ------------------------------------------------------------------ stats (DOM)
  const statEls = {};
  document.querySelectorAll('[data-stat]').forEach((el) => { statEls[el.dataset.stat] = el; });
  const setStat = (k, v) => { const el = statEls[k]; if (el && el.textContent !== v) el.textContent = v; };

  function soundingNotes(step) {
    if (!track) return [];
    const res = [];
    const notes = track.notes;
    for (let i = P.lowerBound(notes, step - 34); i < notes.length; i++) {
      const n = notes[i];
      if (n.step > step) break;
      if (n.step + n.len > step && audibleNote(n)) res.push(n);
    }
    return res;
  }
  const names = (arr, max) => {
    const u = Array.from(new Set(arr.map((n) => n.midi))).sort((a, b) => a - b).map(Song.noteName);
    if (!u.length) return '—';
    return u.length > max ? u.slice(0, max).join(' ') + ' …' : u.join(' ');
  };

  function updateStats() {
    if (!track || !S.loud) return;
    const L = S.loud;
    const bar = Math.max(0, Math.floor(S.step / 16));
    const beat = Math.max(0, Math.floor((S.step - bar * 16) / 4));
    const barStr = (bar + 1) + '.' + (beat + 1);
    const bpm = track.bpm + ' BPM';
    setStat('printed', Math.round(S.t / S.duration * 100) + ' %');
    setStat('pen', panels.sheet.penName);
    setStat('time', fmtTime(S.t));
    setStat('momentary', fmtDb(L.momentaryAt(S.t)) + ' LUFS');
    setStat('shortterm', fmtDb(L.shortAt(S.t)));
    setStat('integrated', fmtDb(L.integrated) + ' LUFS');
    const pk = 20 * Math.log10(L.peakAt(S.t) + 1e-9);
    setStat('peak', (pk < -69 ? '-∞' : pk.toFixed(1)) + ' dBFS');
    const all = soundingNotes(S.step);
    setStat('bar', barStr); setStat('bar2', barStr);
    setStat('tempo', bpm); setStat('tempo2', bpm);
    setStat('parts', track.channels.length ? 'ch ' + track.channels.join(' ') : '—');
    setStat('sounding', names(all, 3));
    const chs = Array.from(new Set(all.map((n) => n.ch))).sort();
    setStat('sounding2', chs.length ? 'ch ' + chs.join(' ') : '—');
    setStat('revolution', (track.stepDur * 16).toFixed(2) + ' s');
    const r = panels.roots;
    setStat('notes', String(r.nodes.size));
    const mp = r.mostPlayed();
    setStat('most', mp ? Song.noteName(mp.midi) : '—');
    setStat('now', names(all.filter((n) => n.ch === 1 || n.ch === 4 || n.ch === 5), 2));
    setStat('hits', String(r.hitCount));
    setStat('sparks', String(panels.fountain.sparks));
    setStat('sides', Math.round(S.sides * 100) + ' · ' + Math.round(S.lows * 100) + ' %');
    setStat('middle', Math.round(S.mids * 100) + ' · ' + Math.round(S.highs * 100) + ' %');
    $('#tnow').textContent = fmtTime(S.t);
    $('#tdur').textContent = fmtTime(S.duration);
    if (!scrubbing) $('#scrub').value = String(Math.round(S.t / S.duration * 1000));
  }

  // ------------------------------------------------------------------ loop
  let lastTs = performance.now(), statTimer = 0;
  let stageVisible = true;
  new IntersectionObserver((es) => { stageVisible = es.some((e) => e.isIntersecting); }).observe($('.p-fx'));

  function loop(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    computeFrame(dt);
    if (track) {
      tracker.advance(S.step);
      panels.sheet.draw(S);
      panels.wave.draw(S);
      panels.scope.draw(S);
      panels.spectrum.draw(S);
      panels.vector.draw(S);
      panels.roll.draw(S);
      panels.roots.draw(S);
      panels.fountain.draw(S);
      panels.orbit.draw(S);
      fx.stage.active = stageVisible || document.body.classList.contains('stage-full');
      if (fx.stage.active) fx.stage.draw(S, fx.recipe);
      if (fx.overlay) fx.overlay.draw(S, fx.recipe);
      drawPost(dt);
      statTimer -= dt;
      if (statTimer <= 0) { updateStats(); statTimer = 0.08; }
    }
    requestAnimationFrame(loop);
  }

  const flashEl = $('#fx-flash');
  function drawPost(dt) {
    const R = fx.recipe;
    fx.shake *= Math.pow(0.0005, dt);
    fx.zoom *= Math.pow(0.002, dt);
    fx.flash *= Math.pow(0.003, dt);
    if (reduceMotion || document.body.classList.contains('stage-full')) { fx.shake = 0; fx.zoom = 0; }
    const sx = R.post.shake && fx.shake > 0.02 ? (Math.random() - 0.5) * 9 * fx.shake * R.intensity : 0;
    const sy = R.post.shake && fx.shake > 0.02 ? (Math.random() - 0.5) * 6 * fx.shake * R.intensity : 0;
    const sc = R.post.zoom ? 1 + fx.zoom * 0.014 * R.intensity : 1;
    const tf = sx || sy || sc !== 1 ? 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) scale(' + sc.toFixed(4) + ')' : '';
    if (board.style.transform !== tf) board.style.transform = tf;
    const fo = R.post.flash ? (fx.flash * 0.16 * R.intensity).toFixed(3) : '0';
    if (flashEl.style.opacity !== fo) flashEl.style.opacity = fo;
  }

  // ------------------------------------------------------------------ track setup
  function refreshMeta(tr) {
    let lo = 127, hi = 0;
    for (const n of tr.notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
    if (lo > hi) { lo = 48; hi = 96; }
    tr.rollLo = Math.max(24, Math.min(48, lo - 1));
    tr.rollHi = Math.min(108, Math.max(84, hi + 1));
    tr.channels = Array.from(new Set(tr.notes.map((n) => n.ch))).sort();
  }

  function setTrack(tr) {
    track = tr;
    S.track = tr;
    refreshMeta(tr);
    tracker.reset();
    panels.roll.selected = null;
    fx.stage.reset();
    $('#title').textContent = tr.title;
    renderMeta();
    $('#tdur').textContent = fmtTime(tr.duration);
    document.body.classList.toggle('is-file', tr.kind === 'file');
    if (tr.kind === 'file') setEdit(false);
    renderLegend();
    renderInspector();
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: tr.title, artist: 'cutecore', album: tr.keyName }); } catch (e) { /* noop */ }
    }
  }
  function renderMeta() {
    const tr = track;
    $('#meta').textContent = [tr.kind === 'gen' ? 'SEED ' + String(tr.seed).padStart(4, '0') : 'FILE', tr.keyName, tr.bpm + ' BPM', tr.bars + ' BARS'].join(' · ');
  }

  function renderLegend() {
    const tr = track;
    if (!tr) return;
    const leg = $('#legend');
    leg.innerHTML = '';
    tr.parts.filter((p) => tr.channels.includes(p.ch)).forEach((p) => {
      const s = document.createElement('span');
      s.className = 'chip';
      s.innerHTML = '<i></i>CH ' + p.ch + ' <em></em>';
      s.querySelector('i').style.background = P.partColor(p.ch);
      s.querySelector('em').textContent = p.label;
      leg.appendChild(s);
    });
    document.querySelectorAll('.mx-row').forEach((row) => {
      const ch = +row.dataset.ch;
      row.querySelector('.sw').style.background = ch === 6 ? P.C.muted : P.partColor(ch);
    });
  }

  function generate(seed, autoplay) {
    const was = engine.playing;
    engine.pause();
    const song = Song.compose(seed);
    song.stepDur = 60 / song.bpm / 4;
    song.duration = song.bars * 16 * song.stepDur;
    if (engine !== live) engine = live;
    live.setSong(song);
    liveMeter.reset(live.duration);
    setTrack(song);
    syncTempoUI();
    try { history.replaceState(null, '', '#seed=' + song.seed); } catch (e) { /* sandboxed */ }
    if (autoplay || was) engine.play();
  }

  let busy = false;
  async function loadFile(file) {
    if (busy || !file) return;
    busy = true;
    document.body.classList.add('busy');
    const was = engine.playing;
    try {
      engine.pause();
      setBusy('DECODING', 0);
      const ab = await file.arrayBuffer();
      const buf = await new Promise((res, rej) => {
        const p = ctx.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      });
      const data = await Analysis.analyzeTrack(buf, (p) => setBusy('LISTENING', p));
      data.title = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
      data.stepDur = 60 / data.bpm / 4;
      data.duration = buf.duration;
      const L = Analysis.loudness(buf);
      L.peakPrefix = new Float32Array(L.nb);
      let m = 0;
      for (let i = 0; i < L.nb; i++) { m = Math.max(m, L.peak[i]); L.peakPrefix[i] = m; }
      data.meter = fileMeter(L);
      filePlayer.load(buf);
      engine = filePlayer;
      setTrack(data);
      hideOverlay();
      engine.play();
    } catch (err) {
      console.error(err);
      $('#busy').textContent = 'FILE NON LEGGIBILE';
      setTimeout(() => { $('#busy').textContent = ''; }, 4000);
      if (was) engine.play();
    } finally {
      busy = false;
      document.body.classList.remove('busy');
      if ($('#busy').textContent.indexOf('NON') < 0) $('#busy').textContent = '';
    }
  }
  function setBusy(label, p) { $('#busy').textContent = label + ' ' + Math.round(p * 100) + '%'; }

  // ------------------------------------------------------------------ transport UI
  const overlay = $('#overlay');
  function hideOverlay() { overlay.classList.add('gone'); }
  function updatePlayButton() {
    const b = $('#play');
    const on = engine.playing;
    b.textContent = on ? '❚❚' : '▶';
    b.setAttribute('aria-label', on ? 'Pausa' : 'Play');
    document.body.classList.toggle('is-playing', on);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
  }
  function toggle() {
    if (!track) return;
    if (engine.playing) engine.pause(); else { hideOverlay(); engine.play(); }
    updatePlayButton();
  }

  const kaoFaces = ['(=^･ω･^=)', '(=^･ｪ･^=)', '(=ↀωↀ=)', 'ฅ^•ﻌ•^ฅ', '(=^‥^=)'];
  let kaoI = 0;
  function kaoBeat() {
    const k = $('#kao');
    kaoI = (kaoI + 1) % kaoFaces.length;
    k.textContent = kaoFaces[kaoI];
    k.classList.remove('bop'); void k.offsetWidth; k.classList.add('bop');
  }

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('cutecore-theme', t); } catch (e) { /* private mode */ }
    P.readTheme();
    $('meta[name=theme-color]').setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    $('#theme').textContent = t === 'kawaii' ? '♡ KAWAII' : '◎ LAB';
    renderLegend();
  }

  let scrubbing = false;
  const scrub = $('#scrub');
  scrub.addEventListener('input', () => { scrubbing = true; if (track) $('#tnow').textContent = fmtTime(scrub.value / 1000 * engine.duration); });
  scrub.addEventListener('change', () => { scrubbing = false; if (track) engine.seek(scrub.value / 1000 * engine.duration); });

  $('#play').addEventListener('click', toggle);
  $('#ov-play').addEventListener('click', () => { hideOverlay(); ctx.resume(); engine.play(); updatePlayButton(); });
  $('#new').addEventListener('click', () => { ctx.resume(); hideOverlay(); generate(Math.floor(Math.random() * 10000), true); });
  $('#file').addEventListener('change', (e) => { ctx.resume(); loadFile(e.target.files[0]); e.target.value = ''; });
  $('#theme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'kawaii' ? 'lab' : 'kawaii'));
  $('#pen').addEventListener('click', () => setStat('pen', panels.sheet.cyclePen()));

  // ------------------------------------------------------------------ mixer
  const mixer = $('#mixer');
  const PITCHED = { 1: 'bell', 2: 'arp', 3: 'chord', 4: 'bass', 5: 'spark' };
  function buildMixer() {
    const rows = Synth.PARTS.map((d) => {
      const extra = d.id === 'drums'
        ? ['kick', 'snare', 'hat', 'fx'].map((k) => '<button class="tg pc on" data-piece="' + k + '" aria-pressed="true">' + k.toUpperCase() + '</button>').join('')
        : '<button class="tg tr" data-tr="-12" title="Un\'ottava giù">−8va</button><button class="tg tr" data-tr="-1" title="Un semitono giù">♭</button><button class="tg tr" data-tr="1" title="Un semitono su">♯</button><button class="tg tr" data-tr="12" title="Un\'ottava su">+8va</button>';
      const knob = (k, label, v) => '<label class="knob"><span>' + label + ' <b data-v="' + k + '"></b></span><input type="range" id="mx-' + d.id + '-' + k + '" data-k="' + k + '" min="0" max="' + (k === 'vol' ? 150 : 100) + '" value="' + v + '"></label>';
      return '<div class="mx-row" data-part="' + d.id + '" data-ch="' + d.ch + '">' +
        '<div class="mx-head"><i class="sw"></i><b class="nm">' + d.label + '</b><span class="chn">' + (d.ch === 6 ? 'HITS' : 'CH ' + d.ch) + '</span>' +
        '<button class="tg m" data-t="mute" aria-pressed="false" title="Muto">M</button><button class="tg s" data-t="solo" aria-pressed="false" title="Solo">S</button>' +
        '<span class="extra">' + extra + '</span></div>' +
        '<div class="mx-knobs">' + knob('vol', 'VOL', 100) + knob('tone', 'TONE', 50) + knob('decay', 'DECAY', 50) + knob('space', 'SPACE', 50) + '</div></div>';
    }).join('');
    mixer.innerHTML = rows;
    mixer.querySelectorAll('.mx-row').forEach(syncRow);
  }
  function syncRow(row) {
    const q = live.params[row.dataset.part];
    row.querySelectorAll('input[type=range]').forEach((inp) => {
      const k = inp.dataset.k;
      inp.value = String(Math.round(q[k] * 100));
      row.querySelector('[data-v=' + k + ']').textContent = Math.round(q[k] * 100) + (k === 'vol' ? '%' : '');
    });
    row.querySelector('.m').setAttribute('aria-pressed', String(q.mute));
    row.querySelector('.s').setAttribute('aria-pressed', String(q.solo));
    row.classList.toggle('silent', !live.audible(row.dataset.part));
    row.querySelectorAll('[data-piece]').forEach((b) => {
      const on = q[b.dataset.piece] !== false;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function syncAllRows() { mixer.querySelectorAll('.mx-row').forEach(syncRow); }
  mixer.addEventListener('input', (e) => {
    const inp = e.target;
    if (!inp.dataset.k) return;
    const row = inp.closest('.mx-row');
    live.params[row.dataset.part][inp.dataset.k] = inp.value / 100;
    live.applyMix();
    row.querySelector('[data-v=' + inp.dataset.k + ']').textContent = inp.value + (inp.dataset.k === 'vol' ? '%' : '');
  });
  mixer.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const row = b.closest('.mx-row');
    const id = row.dataset.part;
    const q = live.params[id];
    if (b.dataset.t) { q[b.dataset.t] = !q[b.dataset.t]; live.applyMix(); syncAllRows(); }
    else if (b.dataset.piece) { q[b.dataset.piece] = q[b.dataset.piece] === false; syncRow(row); }
    else if (b.dataset.tr) transposePart(+row.dataset.ch, +b.dataset.tr);
  });
  function transposePart(ch, by) {
    if (!track || track.kind !== 'gen') return;
    let ok = true;
    for (const n of track.notes) if (n.ch === ch && (n.midi + by < 24 || n.midi + by > 108)) ok = false;
    if (!ok) return;
    for (const n of track.notes) if (n.ch === ch) n.midi += by;
    refreshMeta(track);
    renderInspector();
    const first = track.notes.find((n) => n.ch === ch && n.step >= S.step) || track.notes.find((n) => n.ch === ch);
    if (first) live.preview(first);
  }

  // global controls
  const tempoIn = $('#g-tempo'), swingIn = $('#g-swing'), masterIn = $('#g-master');
  function syncTempoUI() {
    if (!track) return;
    tempoIn.value = String(track.bpm);
    $('#v-tempo').textContent = track.bpm;
  }
  tempoIn.addEventListener('input', () => {
    if (!track || track.kind !== 'gen') return;
    live.setTempo(+tempoIn.value);
    track.bpm = live.bpm;
    track.stepDur = live.stepDur;
    track.duration = live.duration;
    liveMeter.reset(live.duration);
    $('#v-tempo').textContent = live.bpm;
    renderMeta();
  });
  swingIn.addEventListener('input', () => { live.swing = swingIn.value / 100; $('#v-swing').textContent = swingIn.value + '%'; });
  masterIn.addEventListener('input', () => {
    const v = masterIn.value / 100;
    live.setMaster(v);
    filePlayer.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    $('#v-master').textContent = masterIn.value + '%';
  });
  $('#mx-reset').addEventListener('click', () => {
    Synth.PARTS.forEach((d) => {
      const q = live.params[d.id];
      Object.assign(q, { vol: 1, mute: false, solo: false, tone: 0.5, decay: 0.5, space: 0.5 });
      if (d.id === 'drums') Object.assign(q, { kick: true, snare: true, hat: true, fx: true });
    });
    live.applyMix();
    syncAllRows();
    swingIn.value = '0'; live.swing = 0; $('#v-swing').textContent = '0%';
  });

  // ------------------------------------------------------------------ note editor (ROLL)
  const roll = panels.roll;
  const insp = $('#insp');
  const INST_OF_CH = { 1: 'bell', 2: 'arp', 3: 'chord', 4: 'bass', 5: 'spark' };
  function setEdit(on) {
    roll.edit = on;
    $('#edit').setAttribute('aria-pressed', String(on));
    $('#edit').textContent = on ? '✓ DONE' : '✎ EDIT';
    insp.hidden = !on;
    document.body.classList.toggle('editing', on);
    if (!on) roll.selected = null;
    renderInspector();
  }
  function renderInspector() {
    $('#ed-part').textContent = 'PART: ' + (Synth.PARTS.find((p) => p.ch === roll.focusCh) || {}).label;
    $('#ed-part-sw').style.background = P.partColor(roll.focusCh);
    const n = roll.selected;
    const lbl = $('#insp-note');
    insp.classList.toggle('has-sel', !!n);
    if (!n) { lbl.textContent = 'Tocca una nota per selezionarla · tocca uno spazio vuoto per aggiungerne una'; return; }
    const bar = Math.floor(n.step / 16), beat = Math.floor((n.step % 16) / 4), six = Math.floor(n.step % 4);
    lbl.textContent = Song.noteName(n.midi) + '  ·  BAR ' + (bar + 1) + '.' + (beat + 1) + '.' + (six + 1) + '  ·  LEN ' + n.len + '/16  ·  VEL ' + Math.round(n.vel * 100);
  }
  function reinsert(n) {
    const notes = track.notes;
    const i = notes.indexOf(n);
    if (i >= 0) notes.splice(i, 1);
    notes.splice(P.lowerBound(notes, n.step), 0, n);
    tracker.resync(S.step);
  }
  function editOp(op) {
    if (!track || track.kind !== 'gen') return;
    if (op === 'part') {
      const order = [1, 2, 3, 4, 5];
      roll.focusCh = order[(order.indexOf(roll.focusCh) + 1) % order.length];
      roll.selected = null;
      renderInspector();
      return;
    }
    const n = roll.selected;
    if (!n) return;
    let preview = false;
    switch (op) {
      case 'p-1': n.midi = Math.max(24, n.midi - 1); preview = true; break;
      case 'p+1': n.midi = Math.min(108, n.midi + 1); preview = true; break;
      case 'o-1': if (n.midi - 12 >= 24) n.midi -= 12; preview = true; break;
      case 'o+1': if (n.midi + 12 <= 108) n.midi += 12; preview = true; break;
      case 'l-': n.len = Math.max(0.5, n.len <= 1 ? n.len - 0.5 : n.len - 1); break;
      case 'l+': n.len = Math.min(32, n.len < 1 ? n.len + 0.5 : n.len + 1); break;
      case 'v-': n.vel = Math.max(0.1, Math.round((n.vel - 0.1) * 10) / 10); preview = true; break;
      case 'v+': n.vel = Math.min(1, Math.round((n.vel + 0.1) * 10) / 10); preview = true; break;
      case 'm-': n.step = Math.max(0, n.step - 1); reinsert(n); break;
      case 'm+': n.step = Math.min(track.bars * 16 - 1, n.step + 1); reinsert(n); break;
      case 'del': {
        const i = track.notes.indexOf(n);
        if (i >= 0) track.notes.splice(i, 1);
        roll.selected = null;
        tracker.resync(S.step);
        break;
      }
    }
    refreshMeta(track);
    renderInspector();
    if (preview) live.preview(n);
  }
  insp.addEventListener('click', (e) => { const b = e.target.closest('[data-ed]'); if (b) editOp(b.dataset.ed); });
  $('#edit').addEventListener('click', () => setEdit(!roll.edit));

  // pointer: tap to select/add (edit mode), drag to scrub while paused
  const rollEl = $('[data-cv=roll]');
  let pd = null;
  rollEl.addEventListener('pointerdown', (e) => {
    const r = rollEl.getBoundingClientRect();
    pd = { x: e.clientX - r.left, y: e.clientY - r.top, t0: engine.time(), drag: false, id: e.pointerId };
  });
  rollEl.addEventListener('pointermove', (e) => {
    if (!pd || engine.playing || !track || !roll.geo) return;
    const r = rollEl.getBoundingClientRect();
    const dx = e.clientX - r.left - pd.x;
    if (!pd.drag && Math.abs(dx) > 6) { pd.drag = true; try { rollEl.setPointerCapture(pd.id); } catch (err) { /* noop */ } }
    if (pd.drag) {
      const steps = -dx / roll.geo.w * roll.geo.view;
      const t = Math.max(0, Math.min(engine.duration - 0.01, pd.t0 + steps * track.stepDur));
      engine.seek(t);
    }
  });
  rollEl.addEventListener('pointerup', (e) => {
    if (!pd) return;
    const wasDrag = pd.drag;
    pd = null;
    if (wasDrag || !roll.edit || !track || track.kind !== 'gen') return;
    const r = rollEl.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = roll.hitTest(x, y, track);
    if (hit) {
      roll.selected = hit === roll.selected ? null : hit;
      if (roll.selected) live.preview(hit);
    } else {
      const c = roll.cellAt(x, y);
      if (c.step < 0 || c.step >= track.bars * 16) return;
      const inst = INST_OF_CH[roll.focusCh];
      const n = { step: c.step, len: 2, midi: Math.max(24, Math.min(108, c.midi)), vel: 0.8, inst, ch: roll.focusCh };
      track.notes.splice(P.lowerBound(track.notes, n.step), 0, n);
      tracker.resync(S.step);
      refreshMeta(track);
      roll.selected = n;
      live.preview(n);
    }
    renderInspector();
  });
  rollEl.addEventListener('pointercancel', () => { pd = null; });

  // ------------------------------------------------------------------ FX UI
  const fxLayers = $('#fx-layers'), fxPosts = $('#fx-posts');
  function buildFxUI() {
    fxLayers.innerHTML = Fx.LAYERS.map((l) => '<button class="tg chipbtn" data-layer="' + l.id + '">' + l.label + '</button>').join('');
    fxPosts.innerHTML = Fx.POSTS.map((l) => '<button class="tg chipbtn" data-post="' + l.id + '">' + l.label + '</button>').join('');
  }
  function syncFxUI() {
    const R = fx.recipe;
    $('#fx-name').textContent = R.name;
    $('#fx-seed').textContent = '#' + String(R.seed).padStart(5, '0');
    fxLayers.querySelectorAll('[data-layer]').forEach((b) => { const on = !!R.layers[b.dataset.layer]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    fxPosts.querySelectorAll('[data-post]').forEach((b) => { const on = !!R.post[b.dataset.post]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('#fx-shape').textContent = 'SHAPE: ' + R.shape.toUpperCase();
    $('#fx-pal').textContent = 'COLORS: ' + R.palKind.toUpperCase();
    $('#fx-blend').textContent = 'BLEND: ' + R.blend.toUpperCase();
    $('#fx-int').value = String(Math.round(R.intensity * 100));
    $('#fx-trail').value = String(Math.round((R.trail - 0.3) / 0.65 * 100));
    $('#fx-sym').value = String(R.sym);
    $('#fx-spin').value = String(Math.round(R.spin * 50));
    $('#v-fx-sym').textContent = '×' + R.sym;
    $('#fx-overlay-btn').setAttribute('aria-pressed', String(fx.overlayOn));
    overlayEl.style.mixBlendMode = R.blend;
    $('#fx-scan').hidden = !R.post.scan;
  }
  function newRecipe() {
    fx.recipe = Fx.generate(Math.floor(Math.random() * 100000));
    fx.stage.reset();
    if (fx.overlay) fx.overlay.reset();
    syncFxUI();
  }
  $('#fx-gen').addEventListener('click', newRecipe);
  $('.p-fx').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const R = fx.recipe;
    if (b.dataset.layer) R.layers[b.dataset.layer] = !R.layers[b.dataset.layer];
    else if (b.dataset.post) R.post[b.dataset.post] = !R.post[b.dataset.post];
    else if (b.id === 'fx-shape') R.shape = Fx.SHAPES[(Fx.SHAPES.indexOf(R.shape) + 1) % Fx.SHAPES.length];
    else if (b.id === 'fx-pal') { R.palKind = Fx.PALETTES[(Fx.PALETTES.indexOf(R.palKind) + 1) % Fx.PALETTES.length]; R.palette = Fx.makePalette(R.palKind, R.hue); }
    else if (b.id === 'fx-blend') R.blend = Fx.BLENDS[(Fx.BLENDS.indexOf(R.blend) + 1) % Fx.BLENDS.length];
    else if (b.id === 'fx-overlay-btn') setOverlay(!fx.overlayOn);
    else if (b.id === 'fx-full') setStageFull(true);
    else if (b.id === 'fx-exit') setStageFull(false);
    else return;
    syncFxUI();
  });
  $('.p-fx').addEventListener('input', (e) => {
    const R = fx.recipe, v = +e.target.value;
    if (e.target.id === 'fx-int') R.intensity = v / 100;
    else if (e.target.id === 'fx-trail') R.trail = 0.3 + v / 100 * 0.65;
    else if (e.target.id === 'fx-sym') { R.sym = v; $('#v-fx-sym').textContent = '×' + v; }
    else if (e.target.id === 'fx-spin') R.spin = v / 50;
  });
  function setOverlay(on) {
    fx.overlayOn = on;
    overlayEl.hidden = !on;
    if (on && !fx.overlay) fx.overlay = new Fx.FxRenderer(new P.Surface(overlayEl, 1), { overlay: true });
    if (!on && fx.overlay) { fx.overlay.s.clear(); fx.overlay = null; }
  }
  function setStageFull(on) {
    document.body.classList.toggle('stage-full', on);
    if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.body.classList.remove('stage-full'); });

  // ------------------------------------------------------------------ keyboard, drop, media session
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.target.tagName === 'INPUT' && e.target.type === 'range' && e.key.startsWith('Arrow')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
    if (roll.edit && roll.selected) {
      const map = { ArrowUp: 'p+1', ArrowDown: 'p-1', ArrowLeft: 'm-', ArrowRight: 'm+', Delete: 'del', Backspace: 'del' };
      if (map[e.key]) { e.preventDefault(); editOp(map[e.key]); return; }
    }
    if (e.key === 'Escape') { if (document.body.classList.contains('stage-full')) setStageFull(false); else if (roll.edit) setEdit(false); }
    else if (e.key === 'ArrowRight' && track) engine.seek(engine.time() + track.stepDur * 16);
    else if (e.key === 'ArrowLeft' && track) engine.seek(engine.time() - track.stepDur * 16);
    else if (e.key === 'n' || e.key === 'N') $('#new').click();
    else if (e.key === 't' || e.key === 'T') $('#theme').click();
    else if (e.key === 'p' || e.key === 'P') $('#pen').click();
    else if (e.key === 'e' || e.key === 'E') { if (track && track.kind === 'gen') setEdit(!roll.edit); }
    else if (e.key === 'g' || e.key === 'G') newRecipe();
    else if (e.key === 'f' || e.key === 'F') setStageFull(!document.body.classList.contains('stage-full'));
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { ctx.resume(); loadFile(f); } });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => { hideOverlay(); engine.play(); updatePlayButton(); });
      navigator.mediaSession.setActionHandler('pause', () => { engine.pause(); updatePlayButton(); });
    } catch (e) { /* noop */ }
  }

  // ------------------------------------------------------------------ boot
  let theme = 'lab';
  try { theme = localStorage.getItem('cutecore-theme') || 'lab'; } catch (e) { /* noop */ }
  buildMixer();
  buildFxUI();
  setTheme(theme);
  const m = /seed=(\d+)/.exec(location.hash);
  generate(m ? parseInt(m[1], 10) : Song.DEFAULT_SEED, false);
  syncFxUI();
  $('#ov-status').textContent = track.title + ' · ' + track.keyName + ' · ' + track.bpm + ' BPM';
  $('#ov-play').disabled = false;
  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !/claude/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.cutecore = { live, get engine() { return engine; }, get track() { return track; }, ctx, generate, S, fx, setEdit, editOp, roll };
})();
