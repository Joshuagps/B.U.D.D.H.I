/* B.U.D.D.H.I. singer: eSpeak says each word clearly, then TD-PSOLA moves every syllable onto its note
   (exact pitch, note length, vibrato) while keeping the voice's own vowel sounds. Runs in a worker.
   makeSinger(meSpeak) -> { renderTrack(events, opts) } ; events: [{ w: word, si, n, t, d, m }] (t,d seconds, m = MIDI). */
(function (root) {
  "use strict";
  const FS = 22050;
  function decodeWav(arr) {
    const u8 = arr instanceof Uint8Array ? arr : new Uint8Array(arr), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let p = 12, data = null, bits = 16, ch = 1;
    while (p + 8 <= u8.length) {
      const id = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]), size = dv.getUint32(p + 4, true);
      if (id === "fmt ") { ch = dv.getUint16(p + 10, true); bits = dv.getUint16(p + 22, true); }
      if (id === "data") { data = [p + 8, Math.min(size, u8.length - p - 8)]; break; }
      p += 8 + size + (size & 1);
    }
    if (!data || bits !== 16) return new Float32Array(0);
    const n = Math.floor(data[1] / 2 / ch), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(data[0] + i * 2 * ch, true) / 32768;
    return out;
  }
  // frame-wise pitch: returns {f0[], voiced[], hop}
  function pitchTrack(x) {
    const hop = 110, win = 900, minL = Math.floor(FS / 450), maxL = Math.floor(FS / 65), frames = Math.max(1, Math.floor((x.length - win) / hop) + 1);
    let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    const f0 = new Float32Array(frames), voiced = new Uint8Array(frames), rmsA = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const o = f * hop; let e = 0;
      for (let i = 0; i < win && o + i < x.length; i++) e += x[o + i] * x[o + i];
      const rms = Math.sqrt(e / win); rmsA[f] = rms;
      if (rms < peak * 0.04) continue;
      let best = 0, bl = 0;
      for (let L = minL; L <= maxL; L++) {
        let c = 0, e1 = 0, e2 = 0;
        for (let i = 0; i < win - L && o + i + L < x.length; i += 2) { const a = x[o + i], b = x[o + i + L]; c += a * b; e1 += a * a; e2 += b * b; }
        const r = c / Math.sqrt(e1 * e2 + 1e-9);
        if (r > best) { best = r; bl = L; }
      }
      if (best > 0.55) { voiced[f] = 1; f0[f] = FS / bl; }
    }
    // fill short gaps and smooth
    for (let f = 1; f < frames - 1; f++) if (!voiced[f] && voiced[f - 1] && voiced[f + 1]) { voiced[f] = 1; f0[f] = (f0[f - 1] + f0[f + 1]) / 2; }
    const sm = f0.slice(); for (let f = 2; f < frames - 2; f++) if (voiced[f]) { const v = [f0[f - 2], f0[f - 1], f0[f], f0[f + 1], f0[f + 2]].filter(Boolean).sort((a, b) => a - b); sm[f] = v[v.length >> 1]; }
    return { f0: sm, voiced, hop, rms: rmsA, peak };
  }
  // analysis marks: one per pitch period in voiced parts (on the waveform peak), every 5 ms elsewhere
  function marks(x, pt) {
    const out = [], hop = pt.hop; let i = 0;
    const at = s => Math.min(pt.f0.length - 1, Math.max(0, Math.floor(s / hop)));
    while (i < x.length) {
      const f = at(i);
      if (pt.voiced[f] && pt.f0[f] > 0) {
        const P = Math.round(FS / pt.f0[f]); let best = i, bv = -1;
        for (let k = i; k < Math.min(x.length, i + P); k++) if (Math.abs(x[k]) > bv) { bv = Math.abs(x[k]); best = k; }
        if (out.length && out[out.length - 1].v && best - out[out.length - 1].i < P * 0.6) best = out[out.length - 1].i + P;
        out.push({ i: best, p: P, v: 1 }); i = best + Math.round(P * 0.8);
        // snap the next mark close to one period later
        const nf = at(best + P); if (pt.voiced[nf]) { const P2 = Math.round(FS / (pt.f0[nf] || pt.f0[f])); let b2 = best + P2, v2 = -1; for (let k = best + Math.round(P2 * 0.8); k < Math.min(x.length, best + Math.round(P2 * 1.2)); k++) if (Math.abs(x[k]) > v2) { v2 = Math.abs(x[k]); b2 = k; } i = b2; }
      } else { out.push({ i, p: 110, v: 0 }); i += 110; }
    }
    return out;
  }
  // split a spoken word into n syllables at the quietest points between voiced stretches
  function splitSyllables(x, n, pt) {
    // trim silence
    const thr = pt.peak * 0.03; let a = 0, b = x.length - 1;
    while (a < b && Math.abs(x[a]) < thr) a++; while (b > a && Math.abs(x[b]) < thr) b--;
    a = Math.max(0, a - 200); b = Math.min(x.length, b + 300);
    if (n <= 1) return [[a, b]];
    const hop = pt.hop, fa = Math.floor(a / hop), fb = Math.floor(b / hop), cuts = [];
    for (let k = 1; k < n; k++) {
      const centre = fa + (fb - fa) * k / n, span = (fb - fa) / n * 0.45;
      let best = Math.round(centre), bv = Infinity;
      for (let f = Math.max(fa + 1, Math.round(centre - span)); f <= Math.min(fb - 1, Math.round(centre + span)); f++) { const v = pt.rms[f] * (pt.voiced[f] ? 1.6 : 1); if (v < bv) { bv = v; best = f; } }
      cuts.push(best * hop);
    }
    const edges = [a, ...cuts, b], segs = [];
    for (let k = 0; k < n; k++) segs.push([edges[k], edges[k + 1]]);
    return segs;
  }
  /* TD-PSOLA: segment x[s0..s1] -> out of `len` samples at frequency hz (with vibrato), consonants keep their length */
  function psola(x, s0, s1, pt, mk, hz, len, opts) {
    const out = new Float32Array(len), wsum = new Float32Array(len);
    const ms = mk.filter(m => m.i >= s0 && m.i < s1); if (!ms.length) return out;
    const segLen = s1 - s0; let U = 0;
    for (const m of ms) if (!m.v) U += m.p;
    U = Math.min(U, segLen * 0.9); const V = Math.max(1, segLen - U);
    const fu = len > U ? 1 : len / segLen, fv = len > U ? (len - U) / V : len / segLen;
    // map output time -> input time (unvoiced parts at natural speed, voiced parts stretched)
    const pieces = []; let tin = s0, tout = 0;
    for (let k = 0; k < ms.length; k++) { const end = k + 1 < ms.length ? ms[k + 1].i : s1, dur = end - tin, f = ms[k].v ? fv : fu; pieces.push([tout, tin, f]); tout += dur * f; tin = end; }
    const toIn = t => { let lo = 0, hi = pieces.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pieces[mid][0] <= t) lo = mid; else hi = mid - 1; } const pc = pieces[lo]; return pc[1] + (t - pc[0]) / pc[2]; };
    let ts = 0, k = 0;
    const vibStart = Math.min(0.25, len / FS * 0.35) * FS, vibDepth = opts.vibrato == null ? 0.011 : opts.vibrato;
    while (ts < len) {
      const ti = toIn(ts);
      while (k + 1 < ms.length && Math.abs(ms[k + 1].i - ti) <= Math.abs(ms[k].i - ti)) k++;
      const m = ms[k];
      let Ps;
      if (m.v) { const vib = ts > vibStart ? 1 + vibDepth * Math.sin(2 * Math.PI * 5.4 * (ts - vibStart) / FS) * Math.min(1, (ts - vibStart) / (0.2 * FS)) : 1; Ps = FS / (hz * vib); }
      else Ps = 110;
      const half = m.v ? Math.round(Math.max(m.p, Ps)) : 110;
      for (let j = -half; j < half; j++) {
        const src = m.i + j, dst = Math.round(ts) + j;
        if (src < 0 || src >= x.length || dst < 0 || dst >= len) continue;
        const w = 0.5 + 0.5 * Math.cos(Math.PI * j / half);
        out[dst] += x[src] * w; wsum[dst] += w;
      }
      ts += Ps;
    }
    for (let i = 0; i < len; i++) if (wsum[i] > 1) out[i] /= wsum[i];
    // gentle fades so syllables join without clicks
    const fi = Math.min(110, len >> 3), fo = Math.min(660, len >> 2);
    for (let i = 0; i < fi; i++) out[i] *= i / fi;
    for (let i = 0; i < fo; i++) out[len - 1 - i] *= i / fo;
    return out;
  }
  function makeSinger(meSpeak) {
    const cache = new Map();
    function word(w, opts) {
      const key = opts.voice + "|" + opts.variant + "|" + w;
      if (cache.has(key)) return cache.get(key);
      let raw = null;
      try { raw = meSpeak.speak(w, { rawdata: "array", speed: 135, pitch: opts.variant && opts.variant[0] === "f" ? 55 : 45, wordgap: 0, variant: opts.variant || undefined, voice: opts.voice }); } catch (e) { raw = null; }
      const x = raw ? decodeWav(raw) : new Float32Array(0), pt = pitchTrack(x), r = { x, pt, mk: marks(x, pt) };
      if (cache.size > 600) cache.clear();
      cache.set(key, r); return r;
    }
    function renderTrack(events, opts) {
      opts = opts || {};
      const end = events.reduce((m, e) => Math.max(m, e.t + e.d), 0) + 1;
      const track = new Float32Array(Math.ceil(end * FS));
      for (const e of events) {
        const clean = String(e.w).toLowerCase().replace(/[^\p{L}\p{N}'’-]+/gu, "");
        if (!clean) continue;
        const W = word(clean, opts); if (!W.x.length) continue;
        const segs = splitSyllables(W.x, Math.max(1, e.n), W.pt), seg = segs[Math.min(e.si, segs.length - 1)];
        const len = Math.max(400, Math.round(e.d * FS)), hz = 440 * Math.pow(2, (e.m - 69) / 12);
        const y = psola(W.x, seg[0], seg[1], W.pt, W.mk, hz, len, opts);
        const o = Math.round(e.t * FS);
        for (let i = 0; i < y.length && o + i < track.length; i++) track[o + i] += y[i];
      }
      let peak = 0; for (let i = 0; i < track.length; i++) peak = Math.max(peak, Math.abs(track[i]));
      if (peak > 0) { const g = 0.85 / peak; for (let i = 0; i < track.length; i++) track[i] *= g; }
      return track;
    }
    return { renderTrack, FS, _word: word, _psola: psola, _split: splitSyllables };
  }
  root.BuddhiSingerCore = { makeSinger, decodeWav, FS };
  if (typeof module !== "undefined" && module.exports) module.exports = root.BuddhiSingerCore;
})(typeof self !== "undefined" ? self : this);
