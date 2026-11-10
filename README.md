# Certified review plans for the Thrive Holdings tax benchmark (concept)

**Live demo:** https://mohith26.github.io/thrive-holdings-certified-review/

An unofficial concept feature for [evals.thriveholdings.com](https://evals.thriveholdings.com/): next to accuracy and cost per return, price every model configuration by what it costs to ship a *reviewed* return, at a **guaranteed** escaped-error rate.

> Unofficial concept demo by Mohith Gajjela. Not affiliated with Thrive Holdings. Published benchmark figures (accuracy, precision, recall, cost) are from evals.thriveholdings.com; all fact-level, section-level and review data are synthetic.

## Why

The benchmark launch post says choosing a model "requires understanding how models fail, what a practitioner needs to review or correct, and how much time and money models take." The leaderboard answers the first and last parts. Tax AI drafts go to a practitioner "ready for review", so the operating cost of a configuration is model spend **plus the practitioner time needed to catch its mistakes**. Reviewing everything is safe but slow. Reviewing only what the agent flags is fast but uncontrolled: in this demo's data the flags-only policy lets about 11% of facts through wrong.

This view answers: *if we accept at most α of facts wrong-and-unreviewed on a new return, how much review does each configuration need, and which one is cheapest overall?*

## How it works

1. **Review unit = section.** A return splits into the sections practitioners already check one at a time (each W-2, 1099, K-1, Schedule C business, Schedule E property, Schedule A...). Reviewing a section catches its wrong, missing and extra facts, including facts the model never reported.
2. **Risk model.** A logistic regression (Newton/IRLS, L2) scores each section from signals available before anyone knows the answer: share of the section's source pages the draft never cited, disagreement with a cheap second run (GPT-6 Luna, medium reasoning, the page's own cost baseline), whether the agent left an open item, document quality (scanned, handwritten, email/spreadsheet), cross-file reconciliation, new-this-year entity, section type, size. It is trained on a separate synthetic "last season" of field-level review rows (1,200 returns, 10,066 sections; AUC 0.82), never on the 88 benchmark returns.
3. **Conformal risk control** (Angelopoulos, Bates, Fisch, Lei, Schuster, 2022). For a threshold λ, review every section with risk above λ. The loss on return *i*, L_i(λ), is the share of its facts that are wrong, missing or extra in accepted sections, with the benchmark's own accuracy denominator (correct + incorrect + missing + extra). L is monotone in λ and bounded by 1, so

   `λ̂ = max { λ : (Σ_i L_i(λ) + 1) / (n + 1) ≤ α }`, with n = 88 calibration returns,

   guarantees E[L_new(λ̂)] ≤ α for an exchangeable new return, whatever the quality of the risk model. A better risk model only makes the plan cheaper.
4. **Honest evaluation.** Review time, facts reviewed and escaped share are leave-one-return-out: each return gets the plan calibrated on the other 87.
5. **Total cost per return** = published model cost + review minutes × practitioner rate ($65 / $95 / $150 per hour).

## What the demo shows (seed 20261016, $95/hour)

| Limit α | Cheapest reviewed return | Accuracy leader (Claude Opus 5.5 high) | Worst out-of-sample escaped share | Mean review saved vs full review |
|---|---|---|---|---|
| 2% | DeepSeek V4.1 Flash high, $52.02 | #29 of 50, $55.53 | 0.96% | 8.6% |
| 3% | DeepSeek V4.1 Flash low, $48.10 | #31, $52.08 | 2.09% | 14.1% |
| 5% | DeepSeek V4.1 Flash low, $43.48 | #22, $46.98 | 4.19% | 22.3% |
| 10% | GLM 5.3 Flash max, $32.93 | #4, $34.35 | 9.14% | 39.7% |

Takeaways (all from synthetic fact data, see limitations):
- Practitioner review is most of the cost of a return, so model cost differences matter less than how much review a model's output needs.
- The best configuration depends on the error limit: under a strict limit almost everything gets reviewed, review time converges across models and cheap models win; under a loose limit accuracy pays for itself (Opus 5.5 high moves from #31 to #4).
- With n = 88 calibration returns the +1 term costs about 1.1 points of the limit; that is why the 2% setting reviews most of each return. More calibration returns (production review rows) shrink it.
- On a synthetic production-quality system (86% accurate, 88 fresh returns), the same 3% limit needs 25% less review; 10% needs 74% less.

## Data

- `data/published-taxbench.json`: the 50 configurations exactly as published on evals.thriveholdings.com (accuracy, precision, recall, minutes, tokens, turns, cost per return).
- `core/gen.mjs`: seeded generator. 88 returns with the published complexity mix (38 simple, 28 medium, 19 complex, 3 ultra-complex). Per configuration, a damped Newton solve finds error thresholds that reproduce its published per-return accuracy, precision and recall (all 150 values within 0.15 points); the mean accuracy by complexity tier lands within 2.1 points of the published tier means. Correlated latent difficulty means models tend to fail on the same facts; section-level shocks produce whole-document misses; extra facts cluster by return.
- Nothing is real client data. Section names, firms and addresses are fictional.

## Tests

```
node --test tests/review.test.mjs   # 12 tests
node scripts/summary.mjs            # headline numbers above
```

Tests cover: published table integrity; generator determinism; calibration to all 50 published (accuracy, precision, recall) triples; tier means vs published; logistic regression coefficient recovery; AUC on a hand example; monotone loss curves; the CRC inequality and monotonicity in α; leave-one-out equals brute force; **the guarantee by simulation** (24 independent calibration/test redraws: mean test escaped share ≤ α and not vacuous); totals and ranks; production-quality drafts need less review under the same limit.

## Novelty

I checked the benchmark site and launch post (Oct 16, 2026), the Tax AI engineering post (May 27, 2026, which describes field-level review rows and the 75/90/100% completion metric), Current's Tax AI announcements, and AI tax-prep competitors. Juno, Filed, Accrual and DynaTax show per-field confidence or flag low-confidence items for review; none publish a calibrated review threshold with a finite-sample guarantee on escaped errors, and no public model benchmark prices configurations by guaranteed-review cost.

## Limitations

- The review numbers come from synthetic fact-level data generated to match published aggregates. They illustrate the method and are **not** measurements of these models.
- The guarantee is marginal (on average over returns), not per return. A per-return high-probability version (Learn then Test) needs more calibration data.
- Exchangeability is assumed; next season's mix can differ, so calibrate on recent review rows.
- Practitioner review is treated as perfect, and every fact counts equally regardless of dollar impact. A dollar-weighted loss drops into the same machinery.

## Files

`index.html`, `style.css`, `app.js` (page; no build step), `core/` (generator, risk model, CRC), `tests/`, `scripts/summary.mjs`. Provider icons are from [lobe-icons](https://github.com/lobehub/lobe-icons) (MIT), as used on the original page; fonts are Helvetica Neue and IBM Plex Mono.
