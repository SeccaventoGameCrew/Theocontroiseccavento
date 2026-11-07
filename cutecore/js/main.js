/* cutecore — app wiring: audio playback, analysers, tracker, UI. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const P = window.Panels;
  const fmtTime = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); const r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0'); };
  const fmtDb = (v) => (v <= -69.9 ? '-∞' : v.toFixed(1));

  // ------------------------------------------------------------------ audio
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

  const player = {
    buffer: null, src: null, offset: 0, t0: 0, playing: false,
    get duration() { return this.buffer ? this.buffer.duration : 0; },
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
      s.connect(out);
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
    load(buf) {
      this.pause();
      this.buffer = buf;
      this.offset = 0;
    },
  };

  // ------------------------------------------------------------------ track
  let track = null;

  function prepare(data, buffer) {
    const tr = Object.assign({}, data);
    tr.buffer = buffer;
    tr.duration = buffer.duration;
    tr.stepDur = 60 / tr.bpm / 4;
    tr.loud = Analysis.loudness(buffer);
    tr.peakPrefix = new Float32Array(tr.loud.nb);
    let m = 0;
    for (let i = 0; i < tr.loud.nb; i++) { m = Math.max(m, tr.loud.peak[i]); tr.peakPrefix[i] = m; }
    let lo = 127, hi = 0;
    for (const n of tr.notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
    if (lo > hi) { lo = 48; hi = 96; }
    tr.rollLo = Math.max(24, Math.min(48, lo - 1));
    tr.rollHi = Math.min(108, Math.max(84, hi + 1));
    tr.channels = Array.from(new Set(tr.notes.map((n) => n.ch))).sort();
    return tr;
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

  // ------------------------------------------------------------------ tracker
  const tracker = {
    ni: 0, hi: 0, last: -1,
    reset() {
      this.ni = 0; this.hi = 0; this.last = -1e9;
      panels.roots.reset(); panels.sheet.reset(); panels.fountain.reset();
      stats.hits = 0;
    },
    advance(step) {
      if (!track) return;
      if (step < this.last - 1) this.reset();
      const jump = step - this.last > 48;
      const notes = track.notes, hits = track.hits;
      while (this.ni < notes.length && notes[this.ni].step <= step) {
        const n = notes[this.ni++];
        const instant = jump && n.step < step - 4;
        panels.roots.onNote(n, instant);
        panels.fountain.onNote(n, instant);
      }
      while (this.hi < hits.length && hits[this.hi].step <= step) {
        const h = hits[this.hi++];
        const instant = jump && h.step < step - 4;
        panels.roots.onHit(h, instant, S);
        if (h.inst === 'kick' && !instant) { S.kickPulse = 1; kaoBeat(); }
      }
      this.last = step;
    },
  };
  const stats = { hits: 0 };

  // ------------------------------------------------------------------ frame state
  const S = {
    track: null, t: 0, step: 0, duration: 1, playing: false, dt: 0.016,
    tl: new Float32Array(2048), tr: new Float32Array(2048),
    freq: new Float32Array(2048),
    bands6: new Float32Array(6), bandsSpec: new Float32Array(26),
    rmsL: 0, rmsR: 0, lows: 0, mids: 0, highs: 0, sides: 0, kickPulse: 0,
    loud: null,
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
    S.playing = player.playing;
    S.duration = player.duration || 1;
    S.t = player.time();
    S.step = track ? (S.t - track.offset) / track.stepDur : 0;
    S.loud = track ? track.loud : null;
    anL.getFloatTimeDomainData(S.tl);
    anR.getFloatTimeDomainData(S.tr);
    anM.getFloatFrequencyData(S.freq);
    for (let i = 0; i < 6; i++) S.bands6[i] = Math.max(0, Math.min(1, (bandDb(SIX[i][0], SIX[i][1]) + 95) / 65));
    for (let i = 0; i < 26; i++) S.bandsSpec[i] = Math.max(0, Math.min(1, (bandDb(SPEC[i], SPEC[i + 1]) + 100) / 75));
    let l = 0, r = 0, m = 0, s = 0;
    for (let i = 0; i < S.tl.length; i++) {
      const a = S.tl[i], b = S.tr[i];
      l += a * a; r += b * b;
      m += (a + b) * (a + b); s += (a - b) * (a - b);
    }
    S.rmsL = Math.sqrt(l / S.tl.length); S.rmsR = Math.sqrt(r / S.tr.length);
    S.sides = m > 1e-9 ? Math.min(1, Math.sqrt(s / m)) : 0;
    const lv = (a, b) => Math.max(0, (bandDb(a, b) + 100) / 70);
    const lo = lv(20, 250), mi = lv(250, 4000), hi = lv(4000, 16000), tot = lo + mi + hi + 1e-9;
    S.lows = lo / tot; S.mids = mi / tot; S.highs = hi / tot;
    S.kickPulse *= Math.pow(0.02, dt);
  }

  // ------------------------------------------------------------------ stats (DOM)
  const statEls = {};
  document.querySelectorAll('[data-stat]').forEach((el) => { statEls[el.dataset.stat] = el; });
  const setStat = (k, v) => { const el = statEls[k]; if (el && el.textContent !== v) el.textContent = v; };

  function soundingNotes(step, filter) {
    if (!track) return [];
    const out = [];
    const notes = track.notes;
    for (let i = P.lowerBound(notes, step - 34); i < notes.length; i++) {
      const n = notes[i];
      if (n.step > step) break;
      if (n.step + n.len > step && (!filter || filter(n))) out.push(n);
    }
    return out;
  }
  const names = (arr, max) => {
    const u = Array.from(new Set(arr.map((n) => n.midi))).sort((a, b) => a - b).map(Song.noteName);
    if (!u.length) return '—';
    return u.length > max ? u.slice(0, max).join(' ') + ' …' : u.join(' ');
  };

  function updateStats() {
    if (!track) return;
    const L = track.loud;
    const bi = Math.min(L.nb - 1, Math.floor(S.t / L.blockDur));
    const bar = Math.max(0, Math.floor(S.step / 16));
    const beat = Math.max(0, Math.floor((S.step - bar * 16) / 4));
    const barStr = (bar + 1) + '.' + (beat + 1);
    const bpm = track.bpm + ' BPM';
    setStat('printed', Math.round(S.t / S.duration * 100) + ' %');
    setStat('pen', panels.sheet.penName);
    setStat('time', fmtTime(S.t));
    setStat('momentary', fmtDb(L.momentary[bi]) + ' LUFS');
    setStat('shortterm', fmtDb(L.shortTerm[bi]));
    setStat('integrated', fmtDb(L.integrated) + ' LUFS');
    const pk = 20 * Math.log10(track.peakPrefix[bi] + 1e-9);
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
    if (!scrubbing) $('#scrub').value = String(Math.round(S.t / S.duration * 1000));
  }

  // ------------------------------------------------------------------ loop
  let lastTs = performance.now(), statTimer = 0;
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
      statTimer -= dt;
      if (statTimer <= 0) { updateStats(); statTimer = 0.08; }
    }
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ UI
  const overlay = $('#overlay');
  const ovStatus = $('#ov-status');
  const ovBar = $('#ov-bar > i');
  const ovPlay = $('#ov-play');
  let busy = false;

  function setProgress(label, p) {
    ovStatus.textContent = label;
    ovBar.style.width = Math.round(p * 100) + '%';
    $('#busy').textContent = p < 1 ? label + ' ' + Math.round(p * 100) + '%' : '';
  }

  function updatePlayButton() {
    const b = $('#play');
    b.textContent = player.playing ? '❚❚' : '▶';
    b.setAttribute('aria-label', player.playing ? 'Pausa' : 'Play');
    document.body.classList.toggle('is-playing', player.playing);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = player.playing ? 'playing' : 'paused';
  }

  function setTrack(tr) {
    track = tr;
    S.track = tr;
    tracker.reset();
    $('#title').textContent = tr.title;
    $('#meta').textContent = [tr.kind === 'gen' ? 'SEED ' + String(tr.seed).padStart(4, '0') : 'FILE', tr.keyName, tr.bpm + ' BPM', tr.bars + ' BARS'].join(' · ');
    $('#tdur').textContent = fmtTime(tr.duration);
    renderLegend();
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: tr.title, artist: 'cutecore', album: tr.keyName }); } catch (e) { /* noop */ }
    }
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
  }

  async function generate(seed, autoplay) {
    if (busy) return;
    busy = true;
    document.body.classList.add('busy');
    const was = player.playing;
    try {
      const song = Song.compose(seed);
      setProgress('PRESSING', 0);
      const buf = await Synth.render(song, ctx.sampleRate, (p) => setProgress('PRESSING', p));
      setProgress('PRESSING', 1);
      player.load(buf);
      setTrack(prepare(song, buf));
      try { history.replaceState(null, '', '#seed=' + song.seed); } catch (e) { /* file:// */ }
      if (autoplay || was) player.play();
    } catch (err) {
      console.error(err);
      ovStatus.textContent = 'ERRORE: ' + err.message;
    } finally {
      busy = false;
      document.body.classList.remove('busy');
      $('#busy').textContent = '';
    }
  }

  async function loadFile(file) {
    if (busy || !file) return;
    busy = true;
    document.body.classList.add('busy');
    const was = player.playing;
    try {
      player.pause();
      setProgress('DECODING', 0);
      const ab = await file.arrayBuffer();
      const buf = await new Promise((res, rej) => {
        const p = ctx.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      });
      const data = await Analysis.analyzeTrack(buf, (p) => setProgress('LISTENING', p));
      data.title = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
      player.load(buf);
      setTrack(prepare(data, buf));
      hideOverlay();
      player.play();
    } catch (err) {
      console.error(err);
      alert('Impossibile leggere il file audio: ' + err.message);
      if (was) player.play();
    } finally {
      busy = false;
      document.body.classList.remove('busy');
      $('#busy').textContent = '';
    }
  }

  function hideOverlay() { overlay.classList.add('gone'); }

  function toggle() {
    if (!track) return;
    if (player.playing) player.pause(); else { hideOverlay(); player.play(); }
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
  scrub.addEventListener('input', () => { scrubbing = true; if (track) $('#tnow').textContent = fmtTime(scrub.value / 1000 * player.duration); });
  scrub.addEventListener('change', () => { scrubbing = false; if (track) player.seek(scrub.value / 1000 * player.duration); });

  $('#play').addEventListener('click', toggle);
  ovPlay.addEventListener('click', () => { hideOverlay(); ctx.resume(); player.play(); });
  $('#new').addEventListener('click', () => { ctx.resume(); generate(Math.floor(Math.random() * 10000), true); });
  $('#file').addEventListener('change', (e) => { ctx.resume(); loadFile(e.target.files[0]); e.target.value = ''; });
  $('#theme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'kawaii' ? 'lab' : 'kawaii'));
  $('#pen').addEventListener('click', () => setStat('pen', panels.sheet.cyclePen()));

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight' && track) player.seek(player.time() + track.stepDur * 16);
    else if (e.key === 'ArrowLeft' && track) player.seek(player.time() - track.stepDur * 16);
    else if (e.key === 'n' || e.key === 'N') $('#new').click();
    else if (e.key === 't' || e.key === 'T') $('#theme').click();
    else if (e.key === 'p' || e.key === 'P') $('#pen').click();
  });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { ctx.resume(); loadFile(f); } });

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => { hideOverlay(); player.play(); });
      navigator.mediaSession.setActionHandler('pause', () => player.pause());
    } catch (e) { /* noop */ }
  }

  // ------------------------------------------------------------------ boot
  let theme = 'lab';
  try { theme = localStorage.getItem('cutecore-theme') || 'lab'; } catch (e) { /* noop */ }
  setTheme(theme);
  const m = /seed=(\d+)/.exec(location.hash);
  const seed = m ? parseInt(m[1], 10) : Song.DEFAULT_SEED;
  generate(seed, false).then(() => {
    if (track) { ovStatus.textContent = track.title + ' · ' + track.keyName + ' · ' + track.bpm + ' BPM'; ovPlay.disabled = false; }
  });
  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.cutecore = { player, get track() { return track; }, ctx, generate, S };
})();
