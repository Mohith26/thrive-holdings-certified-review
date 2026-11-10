import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as G from '../core/gen.mjs';
import { fitLogistic, predict, auc, returnCurves, crcIndex, looEvaluate, GRID, sigmoid } from '../core/review.mjs';
import { prepare, evaluate, productionCheck } from '../core/analyze.mjs';

const pub = JSON.parse(fs.readFileSync(new URL('../data/published-taxbench.json', import.meta.url)));
const prep = prepare(pub, G.SEED);

test('published table: 50 configurations, unique ids, sane values', () => {
  assert.equal(pub.configs.length, 50);
  assert.equal(new Set(pub.configs.map((c) => c.id)).size, 50);
  for (const c of pub.configs) { assert.ok(c.accuracy > 50 && c.accuracy < 80); assert.ok(c.cost > 0); }
});

test('generator is deterministic in the seed', () => {
  const a = G.makeReturns(7, [5, 3, 2, 1], 'T'), b = G.makeReturns(7, [5, 3, 2, 1], 'T');
  assert.deepEqual(a.map((r) => r.sections.map((s) => [s.label, s.nFacts, s.d])), b.map((r) => r.sections.map((s) => [s.label, s.nFacts, s.d])));
  const c = G.makeReturns(8, [5, 3, 2, 1], 'T');
  assert.notDeepEqual(a.map((r) => r.sections.length), c.map((r) => r.sections.length));
  assert.equal(prep.build.bench.length, 88);
  assert.deepEqual([0, 1, 2, 3].map((t) => prep.build.bench.filter((r) => r.tier === t).length), [38, 28, 19, 3]);
});

test('synthetic fact outcomes reproduce each configuration\'s published per-return accuracy, precision and recall', () => {
  for (const c of pub.configs) {
    const run = prep.build.runs[c.id];
    const m = G.meanMetrics(prep.build.bench, run.lat, run.th);
    assert.ok(Math.abs(m.accuracy * 100 - c.accuracy) < 0.3, `${c.id} accuracy ${m.accuracy * 100} vs ${c.accuracy}`);
    assert.ok(Math.abs(m.recall * 100 - c.recall) < 0.3, `${c.id} recall`);
    assert.ok(Math.abs(m.precision * 100 - c.precision) < 0.3, `${c.id} precision`);
  }
});

test('synthetic complexity tiers track the published accuracy-by-complexity means (all configurations)', () => {
  const pubTier = [74.3, 69.1, 67.3, 50.6];
  [0, 1, 2, 3].forEach((t) => {
    let s = 0, n = 0;
    for (const c of pub.configs) prep.perConfig[c.id].secs.forEach((rs, i) => { if (prep.build.bench[i].tier !== t) return; s += rs.reduce((a, x) => a + x.C, 0) / rs.reduce((a, x) => a + x.denomPart, 0); n++; });
    assert.ok(Math.abs((s / n) * 100 - pubTier[t]) < 3, `tier ${t}: ${(s / n) * 100}`);
  });
});

test('logistic regression recovers known coefficients', () => {
  const rng = G.mulberry32(11); const wTrue = [-1, 2, -1.5]; const X = [], y = [];
  for (let i = 0; i < 20000; i++) { const x = [1, G.normalFrom(rng), G.normalFrom(rng)]; X.push(x); y.push(rng() < sigmoid(wTrue[0] + wTrue[1] * x[1] + wTrue[2] * x[2]) ? 1 : 0); }
  const w = fitLogistic(X, y, { l2: 1e-6 });
  w.forEach((wk, k) => assert.ok(Math.abs(wk - wTrue[k]) < 0.08, `coef ${k}: ${wk}`));
});

test('AUC matches a hand-computed example and the risk model ranks errors well out of sample', () => {
  assert.equal(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]), 0.75);
  assert.ok(prep.seasonAuc > 0.78);
  for (const c of pub.configs) assert.ok(prep.perConfig[c.id].auc > 0.75, c.id);
});

test('loss curves are monotone, start at zero and full review time', () => {
  for (const c of pub.configs.slice(0, 10)) for (const cv of prep.perConfig[c.id].curves) {
    for (let g = 1; g < GRID.length; g++) { assert.ok(cv.loss[g] >= cv.loss[g - 1] - 1e-12); assert.ok(cv.mins[g] <= cv.mins[g - 1] + 1e-9); }
    assert.equal(cv.loss[0], 0); assert.ok(Math.abs(cv.mins[0] - cv.full) < 1e-9);
    assert.ok(cv.loss[GRID.length - 1] <= 1);
  }
});

test('CRC picks the largest threshold satisfying (sum L + 1)/(n + 1) <= alpha, monotone in alpha', () => {
  const curves = prep.perConfig['sol-6.1-medium'].curves; const n = curves.length;
  let prev = -2;
  for (const a of [0.015, 0.02, 0.03, 0.05, 0.1, 0.2]) {
    const g = crcIndex(curves, a);
    const S = (gg) => curves.reduce((s, c) => s + c.loss[gg], 0);
    if (g >= 0) assert.ok((S(g) + 1) / (n + 1) <= a);
    if (g + 1 < GRID.length) assert.ok((S(g + 1) + 1) / (n + 1) > a);
    assert.ok(g >= prev); prev = g;
  }
  assert.equal(crcIndex(curves, 0.005), -1); // 1/(n+1) > alpha: must review everything
});

test('leave-one-out matches brute force', () => {
  const curves = prep.perConfig['claude-opus-5.5-high'].curves; const alpha = 0.03;
  const loo = looEvaluate(curves, alpha);
  for (const i of [0, 17, 50, 87]) {
    const g = crcIndex(curves, alpha, i);
    assert.equal(loo.per[i].g, g);
    assert.equal(loo.per[i].loss, g < 0 ? 0 : curves[i].loss[g]);
  }
});

test('guarantee holds on fresh returns: mean escaped-error share <= alpha over repeated draws', () => {
  // Re-draw the benchmark and an independent test set many times with the same configuration parameters,
  // calibrate on 88 returns, apply to 150 fresh returns.
  const id = 'sol-6.1-medium', run = prep.build.runs[id], lun = prep.build.runs['luna-6-medium'];
  const alpha = 0.03; let sum = 0, reps = 24;
  for (let r = 0; r < reps; r++) {
    const cal = G.makeReturns(1000 + r, [38, 28, 19, 3], 'C'), tst = G.makeReturns(5000 + r, [65, 48, 32, 5], 'X');
    const curvesOf = (rs, salt) => {
      const lat = G.drawLatents(rs, 77 + r * 13 + salt), lat2 = G.drawLatents(rs, 99 + r * 17 + salt);
      const out = G.outcomes(rs, lat, run.th), out2 = G.outcomes(rs, lat2, lun.th);
      const sig = G.signals(rs, lat, out, out2, lat2);
      return rs.map((ret, i) => returnCurves(ret.sections.map((s, j) => { const o = out[i][j]; return { risk: predict(prep.w, G.features(s, sig[i][j])), err: o.I + o.M + o.E, denomPart: o.C + o.I + o.M + o.E, minutes: s.minutes, nFacts: s.nFacts }; })));
    };
    const g = crcIndex(curvesOf(cal, 1), alpha); const test = curvesOf(tst, 2);
    sum += test.reduce((a, c) => a + (g < 0 ? 0 : c.loss[g]), 0) / test.length;
  }
  const mean = sum / reps;
  assert.ok(mean <= alpha, `mean test loss ${mean}`);
  assert.ok(mean > alpha * 0.3, `not vacuous: ${mean}`);
});

test('evaluate: totals add up, LOO escaped share stays under alpha for every configuration', () => {
  for (const alpha of [0.02, 0.03, 0.05]) {
    const rows = evaluate(prep, pub, alpha, 95);
    for (const r of rows) {
      assert.ok(r.looLoss <= alpha, `${r.id} ${r.looLoss}`);
      assert.ok(Math.abs(r.total - (r.modelCost + (r.reviewMinutes / 60) * 95)) < 1e-9);
      assert.ok(r.reviewMinutes <= r.fullMinutes + 1e-9);
    }
    assert.deepEqual(rows.map((r) => r.totRank).sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1));
  }
});

test('production-quality drafts need far less review under the same limit, and still respect it', () => {
  const p = productionCheck(prep, 0.03), b = evaluate(prep, pub, 0.03, 95).find((r) => r.id === 'sol-6.1-medium');
  assert.ok(p.loss <= 0.03); assert.ok(p.share < b.reviewShare);
  assert.ok(p.accuracy > 0.8);
});
