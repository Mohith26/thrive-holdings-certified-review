// Seeded synthetic data generator for the certified-review concept.
// Produces (1) 88 benchmark returns with fact-level outcomes for every published configuration,
// calibrated so each configuration's pooled precision / recall / accuracy match the published values,
// and (2) a separate "last season" history of production review rows used only to train the risk model.
// Nothing here is real client data. Section names, firms and amounts are fictional.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function normalFrom(rng) {
  let u = 0; while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const randint = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// Section catalog: fact-count range, prior difficulty (log-odds shift), review minutes base.
export const SECTION_TYPES = {
  w2:    { label: 'W-2', facts: [6, 9], base: -1.1, minutes: 1.5 },
  int:   { label: '1099-INT', facts: [2, 4], base: -1.0, minutes: 0.8 },
  div:   { label: '1099-DIV', facts: [3, 6], base: -0.6, minutes: 1.0 },
  brk:   { label: '1099-B · Schedule D', facts: [6, 14], base: 0.2, minutes: 3.0 },
  ret:   { label: '1099-R', facts: [4, 7], base: 0.35, minutes: 2.0 },
  ssa:   { label: 'SSA-1099', facts: [2, 3], base: -0.8, minutes: 0.6 },
  schc:  { label: 'Schedule C', facts: [12, 24], base: 0.6, minutes: 5.0 },
  sche:  { label: 'Schedule E', facts: [12, 22], base: 0.7, minutes: 5.0 },
  k1p:   { label: 'K-1 (1065)', facts: [10, 20], base: 0.9, minutes: 4.5 },
  k1s:   { label: 'K-1 (1120-S)', facts: [8, 16], base: 0.8, minutes: 4.0 },
  scha:  { label: 'Schedule A · Itemized deductions', facts: [6, 12], base: 0.3, minutes: 3.0 },
  edu:   { label: '1098-T · Education', facts: [3, 5], base: 0.0, minutes: 1.0 },
  hsa:   { label: 'Form 8889 · HSA', facts: [3, 5], base: 0.1, minutes: 1.2 },
  est:   { label: 'Estimated payments', facts: [2, 5], base: -0.2, minutes: 1.0 },
  dep:   { label: 'Dependents', facts: [2, 6], base: -0.7, minutes: 0.8 },
  carry: { label: 'Prior-year carryovers', facts: [2, 6], base: 0.6, minutes: 2.0 },
};
export const QUALITY = ['clean PDF', 'scanned', 'handwritten notes', 'email / spreadsheet'];
const QUALITY_SHIFT = [0, 0.35, 0.8, 0.5];
const QUALITY_MIN = [1, 1.15, 1.4, 1.25];

const NAMES = {
  w2: ['Harbor Freight Logistics', 'St. Brendan Medical Group', 'Northline Utilities', 'Pinecrest School District', 'Atlas Mechanical', 'Meridian Software', 'County of Pasco', 'Lakeside Dental'],
  int: ['First Gulf Bank', 'Ally Savings', 'Suncoast Credit Union', 'Treasury Direct'],
  div: ['Vanguard', 'Schwab', 'Fidelity', 'Edward Jones'],
  ret: ['401(k) rollover', 'Traditional IRA', 'Pension annuity', 'Roth conversion'],
  schc: ['consulting practice', 'photography studio', 'landscaping', 'Etsy shop', 'film production'],
  sche: ['14 Elm St', '208 Bayview Ave', '3 Harbor Ct (duplex)', '77 Linden Rd', 'Unit 4B Seaside'],
  k1p: ['Oakridge Partners LP', 'Gulfview Real Estate Fund II', 'Cedar Lane Holdings LLC', 'Tidewater Ventures LP'],
  k1s: ['Brightside Dental PC', 'Keystone HVAC Inc', 'Marlin Marine Supply Inc'],
};

const TIERS = [
  { name: 'Simple', shift: 0.0, plan: { w2: [1, 2], int: [0, 2], div: [0, 1], dep: [0, 1], est: [0, 1], edu: [0, 1], ssa: [0, 1] } },
  { name: 'Medium', shift: 0.05, plan: { w2: [1, 3], int: [1, 2], div: [1, 2], brk: [0, 1], ret: [0, 1], schc: [0, 1], scha: [0, 1], hsa: [0, 1], est: [0, 1], dep: [0, 1] } },
  { name: 'Complex', shift: -0.2, plan: { w2: [0, 2], int: [1, 3], div: [1, 2], brk: [1, 1], ret: [0, 2], schc: [0, 2], sche: [1, 2], k1p: [1, 2], scha: [1, 1], est: [1, 1], carry: [0, 1], dep: [0, 1] } },
  { name: 'Ultra-complex', shift: 0.45, plan: { w2: [1, 3], int: [2, 4], div: [2, 3], brk: [1, 2], ret: [1, 2], schc: [1, 2], sche: [2, 4], k1p: [2, 3], k1s: [1, 2], scha: [1, 1], est: [1, 1], carry: [1, 1] } },
];
// Published cohort sizes on evals.thriveholdings.com: Simple 38, Medium 28, Complex 19, Ultra-complex 3.
export const BENCH_TIER_COUNTS = [38, 28, 19, 3];

export function makeReturns(seed, tierCounts, prefix) {
  const rng = mulberry32(seed);
  const returns = [];
  let k = 0;
  tierCounts.forEach((count, t) => {
    for (let r = 0; r < count; r++) {
      const tier = TIERS[t];
      const sections = []; const used = new Set();
      for (const [type, [lo, hi]] of Object.entries(tier.plan)) {
        const n = randint(rng, lo, hi);
        for (let j = 0; j < n; j++) {
          const T = SECTION_TYPES[type];
          const nFacts = randint(rng, T.facts[0], T.facts[1]);
          const q = rng() < 0.55 ? 0 : rng() < 0.45 ? 1 : rng() < 0.5 ? 2 : 3;
          const reconcile = (type === 'sche' || type === 'k1p' || type === 'schc' || type === 'ret' || type === 'brk') ? rng() < 0.55 : rng() < 0.12;
          const newEntity = rng() < 0.18;
          const d = 0.3 * T.base + tier.shift + 0.6 * QUALITY_SHIFT[q] + (reconcile ? 0.3 : 0) + (newEntity ? 0.25 : 0) + 0.35 * normalFrom(rng);
          let nm = '';
          if (NAMES[type]) { const free = NAMES[type].filter((x) => !used.has(type + x)); const choice = free.length ? pick(rng, free) : pick(rng, NAMES[type]) + ' (2)'; used.add(type + choice); nm = ' · ' + choice; }
          const label = type === 'sche' ? `Schedule E${nm} rental` : T.label + nm;
          const minutes = (T.minutes + 0.25 * nFacts) * QUALITY_MIN[q] + (reconcile ? 1.0 : 0);
          sections.push({ type, label, nFacts, quality: q, reconcile, newEntity, typeBase: T.base, d, minutes: Math.round(minutes * 10) / 10 });
        }
      }
      if (sections.length < 3) { r--; continue; }
      // stable per-fact shared hardness (same fact is hard for every model)
      for (const s of sections) { s.zf = Array.from({ length: s.nFacts }, () => normalFrom(rng)); s.zf2 = Array.from({ length: s.nFacts }, () => normalFrom(rng)); }
      returns.push({ id: `${prefix}-${String(++k).padStart(3, '0')}`, tier: t, tierName: tier.name, sections });
    }
  });
  return returns;
}

// Latent draws for one configuration on a set of returns (independent of thresholds, so calibration is monotone).
export function drawLatents(returns, seed) {
  const rng = mulberry32(seed);
  return returns.map((ret) => { const zr = normalFrom(rng); return ret.sections.map((s) => {
    const zs = normalFrom(rng); // section-level shock: e.g. the agent overlooked a document
    const zse = normalFrom(rng);
    const tM = new Float64Array(s.nFacts), tI = new Float64Array(s.nFacts), tE = new Float64Array(s.nFacts);
    for (let f = 0; f < s.nFacts; f++) {
      tM[f] = s.d + 0.8 * s.zf[f] + 0.55 * normalFrom(rng) + 0.7 * zs;
      tI[f] = s.d + 0.8 * s.zf2[f] + 0.6 * normalFrom(rng);
      tE[f] = 0.5 * s.d + 0.6 * normalFrom(rng) + 0.5 * zse + 0.9 * zr; // extras cluster by return (e.g. a duplicated entity)
    }
    return { tM, tI, tE, uDup: Array.from({ length: s.nFacts }, () => rng()), uOpen: rng(), uCite: normalFrom(rng) };
  }); });
}

// Per-return averaged metrics, exactly as the benchmark reports them (each return weighted equally):
// recall = C/(C+I+M), precision = C/(C+I+E), accuracy = C/(C+I+M+E).
export function meanMetrics(returns, lat, th) {
  let sr = 0, sp = 0, sa = 0;
  returns.forEach((ret, i) => {
    let C = 0, I = 0, M = 0, E = 0;
    ret.sections.forEach((s, j) => {
      const L = lat[i][j];
      for (let f = 0; f < s.nFacts; f++) {
        if (L.tM[f] > th.M) M++; else if (L.tI[f] > th.I) I++; else C++;
        if (L.tE[f] > th.E) E++;
      }
    });
    sr += C / (C + I + M); sp += C + I + E > 0 ? C / (C + I + E) : 1; sa += C / (C + I + M + E);
  });
  const n = returns.length; return { recall: sr / n, precision: sp / n, accuracy: sa / n };
}
export function targetMetrics(cfg) { return { recall: cfg.recall / 100, precision: cfg.precision / 100, accuracy: cfg.accuracy / 100 }; }
// Damped Newton solve of the three thresholds (missing, incorrect, extra) so that the per-return averaged
// recall, precision and accuracy equal the published values. Jacobian by central finite differences.
export function calibrate(returns, lat, target, iters = 24) {
  const keys = ['M', 'I', 'E'];
  let x = [1.5, 3.0, 1.5];
  const f = (v) => { const m = meanMetrics(returns, lat, { M: v[0], I: v[1], E: v[2] }); return [m.recall - target.recall, m.precision - target.precision, m.accuracy - target.accuracy]; };
  let fx = f(x);
  for (let it = 0; it < iters; it++) {
    const h = 0.08, J = [[], [], []];
    for (let k = 0; k < 3; k++) { const xp = [...x], xm = [...x]; xp[k] += h; xm[k] -= h; const fp = f(xp), fm = f(xm); for (let r = 0; r < 3; r++) J[r][k] = (fp[r] - fm[r]) / (2 * h); }
    const step = solve3(J, fx); if (!step) break;
    let t = 1, improved = false; const n0 = Math.hypot(...fx);
    for (let ls = 0; ls < 8; ls++) {
      const xn = x.map((v, k) => Math.max(-6, Math.min(12, v - t * step[k]))); const fn = f(xn);
      if (Math.hypot(...fn) < n0) { x = xn; fx = fn; improved = true; break; } t /= 2;
    }
    if (!improved || Math.hypot(...fx) < 2e-5) break;
  }
  return Object.fromEntries(keys.map((k, i) => [k, x[i]]));
}
function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null; for (let r = c + 1; r < 3; r++) { const q = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= q * M[c][k]; } }
  const x = [0, 0, 0]; for (let r = 2; r >= 0; r--) { let v = M[r][3]; for (let k = r + 1; k < 3; k++) v -= M[r][k] * x[k]; x[r] = v / M[r][r]; } return x;
}

// Outcome codes per fact: 0 correct, 1 incorrect, 2 missing. Extra facts counted per section.
export function outcomes(returns, lat, th) {
  return returns.map((ret, i) => ret.sections.map((s, j) => {
    const L = lat[i][j];
    const code = new Uint8Array(s.nFacts); let C = 0, I = 0, M = 0, E = 0;
    for (let f = 0; f < s.nFacts; f++) {
      if (L.tM[f] > th.M) { code[f] = 2; M++; } else if (L.tI[f] > th.I) { code[f] = 1; I++; } else C++;
      if (L.tE[f] > th.E) E++;
    }
    return { code, C, I, M, E };
  }));
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
// Observable signals (no reference needed): citation coverage, disagreement with a cheap second-opinion run,
// and whether the agent itself left an open item on the section.
export function signals(returns, lat, out, secondOut, secondLat) {
  return returns.map((ret, i) => ret.sections.map((s, j) => {
    const o = out[i][j], o2 = secondOut[i][j], L = lat[i][j];
    const missShare = o.M / s.nFacts;
    // a document the agent never opened shows up as uncited pages; facts missed on a page it did read barely move coverage
    const cite = missShare > 0.6 ? Math.max(0, 0.1 + 0.08 * L.uCite) : Math.min(1, Math.max(0, 0.985 - 0.25 * missShare + 0.07 * L.uCite));
    let dis = 0;
    for (let f = 0; f < s.nFacts; f++) {
      const a = o.code[f], b = o2.code[f];
      if (a === 0 && b === 0) continue;
      if (a === 2 && b === 2) continue; // both silent: disagreement cannot see a shared omission
      if (a === 1 && b === 1 && L.uDup[f] < 0.45) continue; // same wrong value (e.g. copied prior-year amount)
      dis++;
    }
    dis += Math.abs(o.E - o2.E) * 0.5 + Math.min(o.E, o2.E) * 0.3;
    const hasErr = o.I + o.M + o.E > 0 ? 1 : 0;
    const open = L.uOpen < sigmoid(-2.4 + 1.1 * hasErr + 0.35 * s.d) ? 1 : 0;
    return { cite: Math.round(cite * 1000) / 1000, disagree: Math.round((dis / s.nFacts) * 1000) / 1000, open };
  }));
}

export const FEATURE_NAMES = ['intercept', 'uncited share', 'second-opinion disagreement', 'agent open item', 'scanned', 'handwritten', 'email / spreadsheet', 'needs reconciliation', 'new entity', 'section-type prior', 'log facts'];
export function features(s, sig) {
  return [1, 1 - sig.cite, sig.disagree, sig.open, s.quality === 1 ? 1 : 0, s.quality === 2 ? 1 : 0, s.quality === 3 ? 1 : 0, s.reconcile ? 1 : 0, s.newEntity ? 1 : 0, s.typeBase, Math.log(s.nFacts)];
}

// Full build: everything the page needs, deterministic in the seed.
export const SEED = 20261016;
export const PRODUCTION_TARGET = { recall: 0.9, precision: 0.93, accuracy: 0.85 }; // last season's deployed Tax AI (synthetic)
export function buildAll(published, seed = SEED) {
  const bench = makeReturns(seed, BENCH_TIER_COUNTS, 'R');
  const season = makeReturns(seed + 1, [540, 384, 240, 36], 'S');
  const lunaId = 'luna-6-medium', lunaAlt = 'luna-6-high';
  const cfgs = published.configs;
  const latFor = (rs, id, salt) => drawLatents(rs, (seed ^ hashStr(id + salt)) >>> 0);
  // second opinion on the benchmark: GPT-6 Luna medium (the page's own baseline, ~11 cents per return)
  const byId = Object.fromEntries(cfgs.map((c) => [c.id, c]));
  const runs = {};
  for (const c of cfgs) {
    const lat = latFor(bench, c.id, ':bench');
    const th = calibrate(bench, lat, targetMetrics(c));
    runs[c.id] = { lat, th, out: outcomes(bench, lat, th) };
  }
  const bench2 = {};
  for (const c of cfgs) {
    const sec = c.id === lunaId ? lunaAlt : lunaId;
    bench2[c.id] = signals(bench, runs[c.id].lat, runs[c.id].out, runs[sec].out, runs[sec].lat);
  }
  // season history: production system + Luna second opinion
  const pLat = latFor(season, 'production', ':season');
  const pTh = calibrate(season, pLat, PRODUCTION_TARGET);
  const pOut = outcomes(season, pLat, pTh);
  const sLat = latFor(season, lunaId, ':season');
  const sTh = calibrate(season, sLat, targetMetrics(byId[lunaId]));
  const sOut = outcomes(season, sLat, sTh);
  const pSig = signals(season, pLat, pOut, sOut, sLat);
  const X = [], y = [];
  season.forEach((r, i) => r.sections.forEach((s, j) => { X.push(features(s, pSig[i][j])); const o = pOut[i][j]; y.push(o.I + o.M + o.E > 0 ? 1 : 0); }));
  // fresh 88 production-quality drafts (not used for training), to show the same limit on a stronger system
  const prodSet = makeReturns(seed + 2, BENCH_TIER_COUNTS, 'P');
  const qLat = latFor(prodSet, 'production', ':fresh'), qOut = outcomes(prodSet, qLat, pTh);
  const q2Lat = latFor(prodSet, lunaId, ':fresh'), q2Out = outcomes(prodSet, q2Lat, sTh);
  const qSig = signals(prodSet, qLat, qOut, q2Out, q2Lat);
  const production = { returns: prodSet, out: qOut, signals: qSig, metrics: meanMetrics(prodSet, qLat, pTh) };
  return { bench, season: { nReturns: season.length, nRows: X.length, X, y }, runs, signals: bench2, production, secondOpinion: { default: lunaId, forLuna: lunaAlt } };
}
