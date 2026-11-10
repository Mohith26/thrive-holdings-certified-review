// Glue: build data -> train risk model -> per-configuration certified review plans.
import { buildAll, features, FEATURE_NAMES } from './gen.mjs';
import { fitLogistic, predict, auc, returnCurves, crcIndex, looEvaluate, flagOnlyPolicy, riskCoverage, GRID } from './review.mjs';

export function prepare(published, seed) {
  const build = buildAll(published, seed);
  const w = fitLogistic(build.season.X, build.season.y, { l2: 1.0 });
  const seasonScores = build.season.X.map((x) => predict(w, x));
  const seasonAuc = auc(seasonScores, build.season.y);
  const perConfig = {};
  for (const c of published.configs) {
    const run = build.runs[c.id], sig = build.signals[c.id];
    const secs = build.bench.map((ret, i) => ret.sections.map((s, j) => {
      const o = run.out[i][j], g = sig[i][j];
      return { label: s.label, type: s.type, nFacts: s.nFacts, quality: s.quality, reconcile: s.reconcile, newEntity: s.newEntity, minutes: s.minutes,
        C: o.C, I: o.I, M: o.M, E: o.E, err: o.I + o.M + o.E, denomPart: o.C + o.I + o.M + o.E,
        cite: g.cite, disagree: g.disagree, open: g.open, risk: predict(w, features(s, g)) };
    }));
    const curves = secs.map(returnCurves);
    // synthetic accuracy recomputed per return (the benchmark's definition), to check calibration against the published value
    const acc = secs.reduce((a, rs) => { const C = rs.reduce((x, s) => x + s.C, 0), D = rs.reduce((x, s) => x + s.denomPart, 0); return a + C / D; }, 0) / secs.length;
    const benchAuc = auc(secs.flat().map((s) => s.risk), secs.flat().map((s) => (s.err > 0 ? 1 : 0)));
    perConfig[c.id] = { secs, curves, rc: riskCoverage(curves), synthAccuracy: acc * 100, auc: benchAuc, flag: flagOnlyPolicy(secs) };
  }
  const pr = build.production;
  const prodCurves = pr.returns.map((ret, i) => returnCurves(ret.sections.map((s, j) => { const o = pr.out[i][j]; return { risk: predict(w, features(s, pr.signals[i][j])), err: o.I + o.M + o.E, denomPart: o.C + o.I + o.M + o.E, minutes: s.minutes, nFacts: s.nFacts }; })));
  return { build, w, featureNames: FEATURE_NAMES, seasonAuc, perConfig, production: { curves: prodCurves, metrics: pr.metrics } };
}

// alpha: target expected share of facts wrong-and-unreviewed; rate: practitioner $/hour.
export function evaluate(prep, published, alpha, rate) {
  const rows = published.configs.map((c) => {
    const P = prep.perConfig[c.id];
    const g = crcIndex(P.curves, alpha);
    const loo = looEvaluate(P.curves, alpha);
    const reviewCost = (loo.mins / 60) * rate, fullCost = (loo.full / 60) * rate;
    return { id: c.id, model: c.model, effort: c.effort, accuracy: c.accuracy, precision: c.precision, recall: c.recall, modelCost: c.cost, wallMinutes: c.minutes,
      lambda: g < 0 ? null : GRID[g], g, looLoss: loo.loss, reviewMinutes: loo.mins, fullMinutes: loo.full, reviewShare: loo.share,
      reviewCost, total: c.cost + reviewCost, fullTotal: c.cost + fullCost, saved: 1 - loo.mins / loo.full,
      flagLoss: P.flag.loss, flagMinutes: P.flag.mins, synthAccuracy: P.synthAccuracy, auc: P.auc, per: loo.per };
  });
  const byAcc = [...rows].sort((a, b) => b.accuracy - a.accuracy); byAcc.forEach((r, i) => (r.accRank = i + 1));
  const byTot = [...rows].sort((a, b) => a.total - b.total); byTot.forEach((r, i) => (r.totRank = i + 1));
  return rows;
}
export function productionCheck(prep, alpha) {
  const loo = looEvaluate(prep.production.curves, alpha);
  return { ...loo, accuracy: prep.production.metrics.accuracy, saved: 1 - loo.mins / loo.full };
}
