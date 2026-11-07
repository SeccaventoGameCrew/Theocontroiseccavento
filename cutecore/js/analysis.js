/* cutecore — offline audio analysis.
 * - loudness(): BS.1770-style K-weighted momentary / short-term / integrated
 *   loudness and peaks, in 100 ms blocks.
 * - analyzeTrack(): for user-loaded files, estimates tempo, pitched notes
 *   (harmonic salience) and drum hits (band onsets) so every panel works.
 */
(function (root) {
  'use strict';

  function kCoefs(fs) {
    // libebur128 formulation, valid for any sample rate.
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const s1 = {
      b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
      a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0,
    };
    f0 = 38.13547087602444; Q = 0.5003270373238773;
    K = Math.tan(Math.PI * f0 / fs);
    a0 = 1 + K / Q + K * K;
    const s2 = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
    return [s1, s2];
  }

  const toLufs = (ms) => (ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -70);

  function loudness(buffer) {
    const sr = buffer.sampleRate, n = buffer.length;
    const chs = Math.min(2, buffer.numberOfChannels);
    const block = Math.round(sr * 0.1);
    const nb = Math.ceil(n / block);
    const ms = new Float64Array(nb);
    const peak = new Float32Array(nb);
    const rms = new Float32Array(nb);
    const [s1, s2] = kCoefs(sr);
    for (let c = 0; c < chs; c++) {
      const x = buffer.getChannelData(c);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
      for (let i = 0; i < n; i++) {
        const xi = x[i];
        // stage 1: high shelf
        const y = s1.b0 * xi + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
        x2 = x1; x1 = xi; y2 = y1; y1 = y;
        // stage 2: high-pass
        const w = y + s2.b1 * u1 + s2.b2 * u2 - s2.a1 * z1 - s2.a2 * z2;
        u2 = u1; u1 = y; z2 = z1; z1 = w;
        const b = (i / block) | 0;
        ms[b] += w * w;
        rms[b] += xi * xi;
        const a = xi < 0 ? -xi : xi;
        if (a > peak[b]) peak[b] = a;
      }
    }
    for (let b = 0; b < nb; b++) {
      const cnt = Math.min(block, n - b * block);
      ms[b] /= cnt;
      rms[b] = Math.sqrt(rms[b] / (cnt * chs));
    }
    const momentary = new Float32Array(nb);
    const shortTerm = new Float32Array(nb);
    const m4 = new Float64Array(nb);
    for (let b = 0; b < nb; b++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, b - 3); k <= b; k++) { s += ms[k]; c++; }
      m4[b] = s / c;
      momentary[b] = toLufs(m4[b]);
      s = 0; c = 0;
      for (let k = Math.max(0, b - 29); k <= b; k++) { s += ms[k]; c++; }
      shortTerm[b] = toLufs(s / c);
    }
    // gated integrated loudness
    let sum = 0, cnt = 0;
    for (let b = 3; b < nb; b++) if (momentary[b] > -70) { sum += m4[b]; cnt++; }
    let integrated = -70;
    if (cnt) {
      const rel = toLufs(sum / cnt) - 10;
      sum = 0; cnt = 0;
      for (let b = 3; b < nb; b++) if (momentary[b] > rel) { sum += m4[b]; cnt++; }
      if (cnt) integrated = toLufs(sum / cnt);
    }
    let maxPeak = 0;
    for (let b = 0; b < nb; b++) if (peak[b] > maxPeak) maxPeak = peak[b];
    return { blockDur: block / sr, nb, momentary, shortTerm, peak, rms, integrated, maxPeak };
  }

  // ---- radix-2 FFT (in place)
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const xr = re[b] * cr - im[b] * ci;
          const xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function analyzeTrack(buffer, onProgress) {
    const sr = buffer.sampleRate, n = buffer.length;
    const chs = buffer.numberOfChannels;
    const mono = new Float32Array(n);
    for (let c = 0; c < chs; c++) {
      const x = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += x[i] / chs;
    }
    const N = 4096, H = 1024;
    const frames = Math.max(1, Math.floor((n - N) / H) + 1);
    const binHz = sr / N;
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2);
    const bandDefs = [[30, 150], [1500, 5000], [7000, 15000]];
    const bandBins = bandDefs.map(([a, b]) => [Math.max(1, Math.round(a / binHz)), Math.min(N / 2 - 1, Math.round(b / binHz))]);
    const bandE = bandDefs.map(() => new Float32Array(frames));
    const frameDb = new Float32Array(frames);
    const LO = 40, HI = 100;
    const picks = new Array(frames);
    const binOf = (f) => Math.round(f / binHz);
    const magAt = (f) => {
      const k = binOf(f);
      if (k < 1 || k >= N / 2 - 1) return 0;
      return Math.max(mag[k - 1], mag[k], mag[k + 1]);
    };
    const sal = new Float32Array(HI - LO + 1);
    const fund = new Float32Array(HI - LO + 1);

    for (let f = 0; f < frames; f++) {
      const off = f * H;
      let e = 0;
      for (let i = 0; i < N; i++) { const v = mono[off + i] || 0; re[i] = v * win[i]; im[i] = 0; e += v * v; }
      frameDb[f] = 10 * Math.log10(e / N + 1e-12);
      fft(re, im);
      let mmax = 0;
      for (let k = 0; k < N / 2; k++) { mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]); if (mag[k] > mmax) mmax = mag[k]; }
      bandBins.forEach(([a, b], i) => {
        let s = 0;
        for (let k = a; k <= b; k++) s += mag[k] * mag[k];
        bandE[i][f] = Math.log10(s + 1e-9);
      });
      let smax = 0;
      for (let m = LO; m <= HI; m++) {
        const fr = 440 * Math.pow(2, (m - 69) / 12);
        const f1 = magAt(fr);
        fund[m - LO] = f1;
        const s = f1 + 0.5 * magAt(fr * 2) + 0.33 * magAt(fr * 3) + 0.25 * magAt(fr * 4);
        sal[m - LO] = s;
        if (s > smax) smax = s;
      }
      const cand = [];
      for (let m = LO; m <= HI; m++) {
        const i = m - LO, s = sal[i];
        if (s < smax * 0.55 || fund[i] < mmax * 0.2) continue;
        if ((i > 0 && sal[i - 1] > s) || (i < sal.length - 1 && sal[i + 1] > s)) continue;
        cand.push([m, s]);
      }
      cand.sort((a, b) => b[1] - a[1]);
      const chosen = [];
      for (const [m] of cand) {
        if (chosen.length >= 3) break;
        if (chosen.some((p) => [12, 19, 24, 28, 31].includes(m - p))) continue;
        chosen.push(m);
      }
      picks[f] = chosen;
      if (f % 150 === 0) { if (onProgress) onProgress(f / frames * 0.9); await tick(); }
    }

    let maxDb = -120;
    for (let f = 0; f < frames; f++) if (frameDb[f] > maxDb) maxDb = frameDb[f];
    const tAt = (f) => (f * H + N / 2) / sr;

    // ---- note tracking
    const raw = [];
    const active = new Map();
    for (let f = 0; f < frames; f++) {
      const ok = frameDb[f] > maxDb - 38;
      const cur = ok ? picks[f] : [];
      for (const m of cur) {
        const a = active.get(m);
        if (a) a.last = f; else active.set(m, { start: f, last: f, db: frameDb[f] });
      }
      for (const [m, a] of active) {
        if (f - a.last > 1) {
          if (a.last - a.start + 1 >= 3) raw.push({ t0: tAt(a.start), t1: tAt(a.last + 1), midi: m, db: a.db });
          active.delete(m);
        }
      }
    }
    for (const [m, a] of active) if (a.last - a.start + 1 >= 3) raw.push({ t0: tAt(a.start), t1: tAt(a.last + 1), midi: m, db: a.db });

    // ---- onsets
    const onsets = bandDefs.map(() => []);
    const env = new Float32Array(frames);
    bandE.forEach((E, bi) => {
      const flux = new Float32Array(frames);
      for (let f = 1; f < frames; f++) flux[f] = Math.max(0, E[f] - E[f - 1]);
      let lastT = -1;
      for (let f = 2; f < frames - 2; f++) {
        env[f] += flux[f];
        let s = 0, s2 = 0, c = 0;
        for (let k = Math.max(0, f - 12); k < Math.min(frames, f + 12); k++) { s += flux[k]; s2 += flux[k] * flux[k]; c++; }
        const mean = s / c, sd = Math.sqrt(Math.max(0, s2 / c - mean * mean));
        if (flux[f] > mean + 1.4 * sd && flux[f] > 0.12 && flux[f] >= flux[f - 1] && flux[f] >= flux[f + 1] &&
            flux[f] >= flux[f - 2] && flux[f] >= flux[f + 2] && frameDb[f] > maxDb - 40) {
          const t = tAt(f);
          if (t - lastT > 0.09) { onsets[bi].push({ t, v: Math.min(1, flux[f]) }); lastT = t; }
        }
      }
    });

    // ---- tempo (autocorrelation with a log-normal prior around 120)
    const fps = sr / H;
    let best = 0, bestLag = Math.round(fps * 0.5);
    for (let lag = Math.floor(fps * 60 / 175); lag <= Math.ceil(fps * 60 / 75); lag++) {
      let s = 0;
      for (let f = 0; f + 2 * lag < frames; f++) s += env[f] * (env[f + lag] + 0.5 * env[f + 2 * lag]);
      const bpm = 60 * fps / lag;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.6, 2));
      if (s * w > best) { best = s * w; bestLag = lag; }
    }
    let bpm = Math.round(60 * fps / bestLag);
    if (!isFinite(bpm) || bpm < 60) bpm = 120;
    const beatF = 60 / bpm * fps;
    let bestP = 0, bestS = -1;
    for (let p = 0; p < Math.ceil(beatF); p++) {
      let s = 0;
      for (let x = p; x < frames; x += beatF) s += env[Math.round(x)] || 0;
      if (s > bestS) { bestS = s; bestP = p; }
    }
    const stepDur = 60 / bpm / 4;
    const barDur = stepDur * 16;
    let offset = tAt(bestP);
    offset -= Math.ceil(offset / barDur) * barDur; // <= 0, so steps start >= 0
    const toStep = (t) => (t - offset) / stepDur;

    const notes = raw.map((r) => {
      const vel = Math.max(0.3, Math.min(1, 1 + (r.db - maxDb) / 30));
      const ch = r.midi < 52 ? 4 : r.midi > 84 ? 5 : 1;
      return { step: toStep(r.t0), len: Math.max(0.5, (r.t1 - r.t0) / stepDur), midi: r.midi, vel, inst: ch === 4 ? 'bass' : ch === 5 ? 'spark' : 'bell', ch };
    }).sort((a, b) => a.step - b.step || a.midi - b.midi);

    const hits = [];
    const insts = ['kick', 'snare', 'hat'];
    onsets.forEach((list, i) => list.forEach((o) => hits.push({ step: toStep(o.t), inst: insts[i], vel: 0.4 + 0.6 * o.v })));
    hits.sort((a, b) => a.step - b.step);
    if (onProgress) onProgress(1);

    const duration = buffer.duration;
    return {
      kind: 'file',
      bpm,
      offset,
      bars: Math.ceil((duration - offset) / barDur),
      notes,
      hits,
      sections: [],
      parts: [
        { ch: 1, id: 'mid', label: 'MID' },
        { ch: 4, id: 'low', label: 'LOW' },
        { ch: 5, id: 'high', label: 'HIGH' },
      ],
      keyName: '—',
    };
  }

  root.Analysis = { loudness, analyzeTrack, fft };
})(window);
