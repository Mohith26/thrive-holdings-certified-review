// Certified review plans: risk model + conformal risk control (Angelopoulos et al., 2022).
// Pure functions, shared by the browser page and the node tests.

export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// L2-regularised logistic regression by Newton-Raphson (IRLS). Intercept is not penalised.
export function fitLogistic(X, y, { l2 = 1.0, iters = 30 } = {}) {
  const p = X[0].length; let w = new Array(p).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(p).fill(0); const H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < X.length; i++) {
      const x = X[i]; let z = 0; for (let k = 0; k < p; k++) z += w[k] * x[k];
      const mu = sigmoid(z), r = mu - y[i], v = Math.max(mu * (1 - mu), 1e-9);
      for (let k = 0; k < p; k++) { g[k] += r * x[k]; const vk = v * x[k]; for (let l = 0; l <= k; l++) H[k][l] += vk * x[l]; }
    }
    for (let k = 0; k < p; k++) { for (let l = 0; l < k; l++) H[l][k] = H[k][l]; if (k > 0) { g[k] += l2 * w[k]; H[k][k] += l2; } }
    const step = solve(H, g); let maxStep = 0;
    w = w.map((wk, k) => { maxStep = Math.max(maxStep, Math.abs(step[k])); return wk - step[k]; });
    if (maxStep < 1e-8) break;
  }
  return w;
}
function solve(A, b) { // Gaussian elimination with partial pivoting
  const n = b.length; const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
export const predict = (w, x) => { let z = 0; for (let k = 0; k < w.length; k++) z += w[k] * x[k]; return sigmoid(z); };

export function auc(scores, labels) { // Mann-Whitney
  const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rank = 0, sumPos = 0, nPos = 0, i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) if (labels[idx[k]]) { sumPos += avg; nPos++; } i = j + 1; rank = j; }
  const nNeg = labels.length - nPos; return nNeg && nPos ? (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : NaN;
}

export const GRID = Array.from({ length: 401 }, (_, k) => k / 400); // candidate thresholds on risk in [0, 1]

// Per-return curves. Policy at threshold lam: review every section with risk > lam, auto-accept the rest.
// loss(lam) = facts wrong / missing / extra in auto-accepted sections, divided by the return's fact total C+I+M+E
// (the same denominator as the benchmark's accuracy). Non-decreasing in lam, bounded by 1.
export function returnCurves(sections) {
  // sections: [{risk, err, denomPart, minutes}]
  const D = sections.reduce((a, s) => a + s.denomPart, 0);
  const full = sections.reduce((a, s) => a + s.minutes, 0);
  const loss = new Float64Array(GRID.length), mins = new Float64Array(GRID.length), share = new Float64Array(GRID.length);
  const nF = sections.reduce((a, s) => a + s.nFacts, 0);
  for (let g = 0; g < GRID.length; g++) {
    let e = 0, m = 0, f = 0;
    for (const s of sections) { if (s.risk > GRID[g]) { m += s.minutes; f += s.nFacts; } else e += s.err; }
    loss[g] = D > 0 ? e / D : 0; mins[g] = m; share[g] = f / nF;
  }
  return { loss, mins, share, full, D };
}

// Conformal risk control: largest lam with (sum_i L_i(lam) + B) / (n + 1) <= alpha. B = 1 (max loss).
// Returns grid index, or -1 (review everything) if even lam = 0 fails.
export function crcIndex(curves, alpha, exclude = -1) {
  const n = curves.length - (exclude >= 0 ? 1 : 0);
  let best = -1;
  for (let g = 0; g < GRID.length; g++) {
    let s = 0; for (let i = 0; i < curves.length; i++) if (i !== exclude) s += curves[i].loss[g];
    if ((s + 1) / (n + 1) <= alpha) best = g; else break; // loss is monotone in lam, so stop at first failure
  }
  return best;
}
const at = (arr, g, fallback) => (g < 0 ? fallback : arr[g]);

// Leave-one-return-out evaluation: calibrate on the other n-1 returns, apply to the held-out one.
export function looEvaluate(curves, alpha) {
  const n = curves.length; let loss = 0, mins = 0, full = 0, share = 0; const per = [];
  const tot = new Float64Array(GRID.length); for (const c of curves) for (let g = 0; g < GRID.length; g++) tot[g] += c.loss[g];
  for (let i = 0; i < n; i++) {
    let gi = -1; for (let g = 0; g < GRID.length; g++) { if ((tot[g] - curves[i].loss[g] + 1) / n <= alpha) gi = g; else break; }
    const L = at(curves[i].loss, gi, 0), m = at(curves[i].mins, gi, curves[i].full), sh = at(curves[i].share, gi, 1);
    per.push({ g: gi, loss: L, mins: m }); loss += L; mins += m; share += sh; full += curves[i].full;
  }
  return { loss: loss / n, mins: mins / n, share: share / n, full: full / n, per };
}

// Simple non-calibrated policy for comparison: review only sections the agent flagged or with uncited source pages.
export function flagOnlyPolicy(sectionsByReturn) {
  let loss = 0, mins = 0;
  for (const secs of sectionsByReturn) {
    const D = secs.reduce((a, s) => a + s.denomPart, 0); let e = 0, m = 0;
    for (const s of secs) { if (s.open || s.cite < 0.9) m += s.minutes; else e += s.err; }
    loss += D ? e / D : 0; mins += m;
  }
  return { loss: loss / sectionsByReturn.length, mins: mins / sectionsByReturn.length };
}

export function riskCoverage(curves) { // mean loss and mean share reviewed at each grid point (in-sample curve)
  const n = curves.length; return GRID.map((lam, g) => ({ lam, loss: curves.reduce((a, c) => a + c.loss[g], 0) / n, share: curves.reduce((a, c) => a + c.share[g], 0) / n, mins: curves.reduce((a, c) => a + c.mins[g], 0) / n }));
}
