// Prints the headline numbers used in the README (node scripts/summary.mjs).
import fs from 'node:fs';
import { prepare, evaluate, productionCheck } from '../core/analyze.mjs';
import { SEED } from '../core/gen.mjs';
const pub = JSON.parse(fs.readFileSync(new URL('../data/published-taxbench.json', import.meta.url)));
const prep = prepare(pub, SEED);
console.log(`risk model: trained on ${prep.build.season.nRows} section rows from ${prep.build.season.nReturns} synthetic last-season returns, AUC ${prep.seasonAuc.toFixed(3)}`);
for (const alpha of [0.02, 0.03, 0.05, 0.1]) {
  const rows = evaluate(prep, pub, alpha, 95).sort((a, b) => a.total - b.total);
  const best = rows[0], lead = rows.find((r) => r.accRank === 1);
  const worst = Math.max(...rows.map((r) => r.looLoss));
  const saved = rows.reduce((a, r) => a + r.saved, 0) / rows.length;
  const flag = rows.reduce((a, r) => a + r.flagLoss, 0) / rows.length;
  const p = productionCheck(prep, alpha);
  console.log(`alpha ${alpha * 100}%: cheapest ${best.model} ${best.effort} $${best.total.toFixed(2)} (${best.reviewMinutes.toFixed(1)} of ${best.fullMinutes.toFixed(1)} min); accuracy leader ${lead.model} ${lead.effort} ranks #${lead.totRank} at $${lead.total.toFixed(2)}; worst LOO escaped ${(worst * 100).toFixed(2)}%; mean review saved ${(saved * 100).toFixed(1)}%; flags-only mean escaped ${(flag * 100).toFixed(1)}%; production-quality drafts: ${(p.saved * 100).toFixed(0)}% less review, ${(p.loss * 100).toFixed(2)}% escaped`);
}
