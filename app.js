import { prepare, evaluate, productionCheck } from './core/analyze.mjs';
import { GRID } from './core/review.mjs';
import { SEED, QUALITY } from './core/gen.mjs';
import { ICONS } from './assets/icons.mjs';

const $ = (s) => document.querySelector(s);
const COLORS = {
  'Claude Opus 5.5': '#9d7bc9', 'Claude Fable 5.1': '#ce673d', 'GPT-6.1 Sol': '#c1e3d1', 'GPT-6 Astra': '#8965b3', 'GPT-6 Sol': '#4daf7c',
  'GLM 5.3': '#a18e74', 'Kimi K3': '#fbbf24', 'Grok 4.7': '#7b7b7b', 'Claude Sonnet 5': '#ea7e5d', 'GLM 5.3 Flash': '#fddf91',
  'DeepSeek V4.1 Flash': '#93b9e0', 'GPT-6 Luna': '#4b8bcc', 'DeepSeek V4 Pro 0813': '#6280af',
};
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const provider = (m) => (m.startsWith('Claude') ? 'Claude' : m.startsWith('GPT') ? 'OpenAI' : m.startsWith('DeepSeek') ? 'DeepSeek' : m.startsWith('Grok') ? 'Grok' : m.startsWith('Kimi') ? 'Kimi' : 'GLM');
const icon = (m) => ICONS[provider(m)];
const usd = (v) => (v < 1 ? `${(v * 100).toFixed(1)}¢` : `$${v.toFixed(2)}`);
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;

// clock (ET), as in the production header
function tick() {
  const now = new Date();
  const d = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' }).format(now);
  const t = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
  $('#clk-d').textContent = d; $('#clk-t').textContent = `${t} ET`;
}
tick(); setInterval(tick, 1000);

function marker(effort, x, y, r, fill, extra = '') {
  const s = `fill="${fill}" stroke="#000" stroke-width="1" ${extra}`;
  if (effort === 'low') return `<circle cx="${x}" cy="${y}" r="${r}" ${s}/>`;
  if (effort === 'medium') return `<path d="M${x} ${y - r * 1.15}L${x + r * 1.1} ${y + r * 0.8}H${x - r * 1.1}Z" ${s}/>`;
  if (effort === 'high') return `<rect x="${x - r * 0.9}" y="${y - r * 0.9}" width="${r * 1.8}" height="${r * 1.8}" ${s}/>`;
  if (effort === 'xhigh') { let p = ''; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.5 : r * 1.25; p += `${k ? 'L' : 'M'}${(x + rr * Math.cos(a)).toFixed(2)} ${(y + rr * Math.sin(a)).toFixed(2)}`; } return `<path d="${p}Z" ${s}/>`; }
  return `<path d="M${x} ${y - r * 1.25}L${x + r * 1.1} ${y}L${x} ${y + r * 1.25}L${x - r * 1.1} ${y}Z" ${s}/>`;
}

const state = { alpha: 0.03, rate: 95, model: '', effort: '', sort: 'total', dir: 1, showAll: false, sel: null, ret: null };
let pub, prep, rows = [];

async function init() {
  pub = await (await fetch('data/published-taxbench.json')).json();
  const models = [...new Set(pub.configs.map((c) => c.model))];
  $('#f-model').insertAdjacentHTML('beforeend', models.map((m) => `<option>${m}</option>`).join(''));
  await new Promise((r) => setTimeout(r, 30));
  prep = prepare(pub, SEED);
  $('#seg-alpha').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.alpha = +b.dataset.a; [...$('#seg-alpha').children].forEach((x) => x.classList.toggle('on', x === b)); render(); });
  $('#sel-rate').addEventListener('change', (e) => { state.rate = +e.target.value; render(); });
  $('#f-model').addEventListener('change', (e) => { state.model = e.target.value; render(); });
  $('#f-effort').addEventListener('change', (e) => { state.effort = e.target.value; render(); });
  $('#lb-more').addEventListener('click', () => { state.showAll = !state.showAll; render(); });
  render();
}

function visible() { return rows.filter((r) => (!state.model || r.model === state.model) && (!state.effort || r.effort === state.effort)); }

function render() {
  rows = evaluate(prep, pub, state.alpha, state.rate);
  const vis = visible();
  if (!vis.length) return;
  const best = [...vis].sort((a, b) => a.total - b.total)[0];
  if (!state.sel || !vis.find((r) => r.id === state.sel)) { state.sel = best.id; state.ret = null; }
  renderKpis(vis, best); renderMain(vis, best); renderLegend(vis); renderBoard(vis); renderCrc(); renderPlan();
}

function renderKpis(vis, best) {
  const accLead = [...vis].sort((a, b) => b.accuracy - a.accuracy)[0];
  const maxLoo = Math.max(...vis.map((r) => r.looLoss));
  const n = vis.length;
  $('#kpis').innerHTML = `
    <div class="cell"><div class="k">Lowest cost per reviewed return</div><div class="v">${usd(best.total)}</div><div class="s"><span class="ico">${icon(best.model)}</span>${best.model} · ${best.effort}</div></div>
    <div class="cell"><div class="k">Practitioner time, cheapest plan</div><div class="v">${best.reviewMinutes.toFixed(1)} min</div><div class="s">${pct(best.saved, 0)} less than reviewing all ${best.fullMinutes.toFixed(1)} min of the return</div></div>
    <div class="cell"><div class="k">Escaped facts, out of sample</div><div class="v">${pct(best.looLoss, 2)}</div><div class="s ok">Under the ${pct(state.alpha, 0)} limit for all ${n} configurations (worst ${pct(maxLoo, 2)})</div></div>
    <div class="cell hl"><div class="k">Accuracy leader, ranked by total cost</div><div class="v">#${rankIn(vis, accLead)} of ${n}</div><div class="s tone">${accLead.model} · ${accLead.effort}: ${usd(accLead.total)} per return</div></div>`;
}
const rankIn = (vis, r) => [...vis].sort((a, b) => a.total - b.total).findIndex((x) => x.id === r.id) + 1;

function renderMain(vis, best) {
  const W = 1152, H = 470, L = 64, R = 24, T = 18, B = 52;
  const xs = (c) => Math.log10(c);
  const x0 = Math.log10(0.05), x1 = Math.log10(25);
  const minsAll = vis.map((r) => r.reviewMinutes);
  const full = rows[0].fullMinutes;
  let y0 = Math.floor(Math.min(...minsAll) - 1), y1 = Math.ceil(full + 1);
  const X = (c) => L + ((xs(c) - x0) / (x1 - x0)) * (W - L - R), Y = (m) => T + ((y1 - m) / (y1 - y0)) * (H - T - B);
  let g = '';
  const xt = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25];
  xt.forEach((v) => { g += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="var(--grid)"/><text class="tick" x="${X(v)}" y="${H - B + 18}" text-anchor="middle">${v < 1 ? (v * 100).toFixed(0) + '¢' : '$' + v}</text>`; });
  const step = (y1 - y0) > 16 ? 4 : 2;
  for (let m = Math.ceil(y0 / step) * step; m <= y1; m += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(m)}" y2="${Y(m)}" stroke="var(--grid)"/><text class="tick" x="${L - 10}" y="${Y(m) + 4}" text-anchor="end">${m}</text>`;
  g += `<text class="axis-title" x="${(L + W - R) / 2}" y="${H - 10}" text-anchor="middle">Model cost per return (USD, log scale)</text>`;
  g += `<text class="axis-title" transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Practitioner minutes per return</text>`;
  // iso total-cost curves
  const span = [...vis].map((r) => r.total); const tmin = Math.min(...span), tmax = Math.max(...span);
  const isoStep = state.rate >= 120 ? 10 : 5;
  for (let T0 = Math.ceil(tmin / isoStep) * isoStep; T0 <= tmax + isoStep; T0 += isoStep) {
    let d = ''; let started = false; let lastPt = null;
    for (let k = 0; k <= 120; k++) { const lc = x0 + ((x1 - x0) * k) / 120, c = 10 ** lc, m = ((T0 - c) * 60) / state.rate; if (m < y0 || m > y1) { if (started) break; continue; } d += `${started ? 'L' : 'M'}${X(c).toFixed(1)} ${Y(m).toFixed(1)}`; started = true; lastPt = [X(c), Y(m), m]; }
    if (d) {
      g += `<path d="${d}" fill="none" stroke="#3a3a3a" stroke-dasharray="2 4"/>`;
      const mTop = y1 - 0.35, cTop = T0 - (mTop * state.rate) / 60;
      if (cTop > 0.05 && cTop < 25) g += `<text class="tick" x="${X(cTop) + 5}" y="${Y(mTop) + 4}" fill="#6e6e6e">$${T0} total</text>`;
      else { const m0 = ((T0 - 0.05) * 60) / state.rate; if (m0 > y0 && m0 < y1) g += `<text class="tick" x="${L + 6}" y="${Y(m0) - 5}" fill="#6e6e6e">$${T0} total</text>`; }
    }
  }
  // full review reference
  g += `<line x1="${L}" x2="${W - R}" y1="${Y(full)}" y2="${Y(full)}" stroke="#7b7b7b" stroke-dasharray="5 4"/><text class="tick" x="${W - R - 4}" y="${Y(full) - 7}" text-anchor="end">Full review · ${full.toFixed(1)} min</text>`;
  // Pareto frontier (cost, minutes)
  const pf = [...vis].sort((a, b) => a.modelCost - b.modelCost); let bestM = Infinity; const fr = [];
  for (const r of pf) if (r.reviewMinutes < bestM - 1e-9) { fr.push(r); bestM = r.reviewMinutes; }
  g += `<path d="${fr.map((r, i) => `${i ? 'L' : 'M'}${X(r.modelCost).toFixed(1)} ${Y(r.reviewMinutes).toFixed(1)}`).join('')}" fill="none" stroke="#b4b4b4" stroke-dasharray="4 4" stroke-width="1"/>`;
  // points
  let pts = '';
  for (const r of vis) pts += `<g class="pt" data-id="${r.id}" style="cursor:pointer">${marker(r.effort, X(r.modelCost), Y(r.reviewMinutes), r.id === state.sel ? 6 : 4.6, COLORS[r.model], r.id === state.sel ? 'stroke="#fff" stroke-width="1.5"' : '')}</g>`;
  // labels: one per model family at its cheapest total, greedy collision avoidance
  const fam = {}; for (const r of vis) if (!fam[r.model] || r.total < fam[r.model].total) fam[r.model] = r;
  const boxes = vis.map((r) => ({ x: X(r.modelCost) - 6, y: Y(r.reviewMinutes) - 6, w: 12, h: 12 })); let labs = '';
  const famList = Object.values(fam).sort((a, b) => a.modelCost - b.modelCost);
  for (const r of famList) {
    const px = X(r.modelCost), py = Y(r.reviewMinutes), w = r.model.length * 6.4 + 4;
    const cands = [[0, -28], [0, 32], [0, -48], [0, 52], [-40, -30], [40, -30], [-40, 34], [40, 34], [0, -68], [0, 72], [0, -88], [0, 92]];
    for (const [dx, dy] of cands) {
      const ly = py + dy; const bx = { x: px - w / 2 + dx, y: ly - 11, w, h: 15 };
      if (bx.x < L + 2 || bx.x + bx.w > W - R) continue;
      if (ly < T + 8 || ly > H - B - 4) continue;
      if (boxes.some((b) => bx.x < b.x + b.w && bx.x + bx.w > b.x && bx.y < b.y + b.h && bx.y + bx.h > b.y)) continue;
      boxes.push(bx);
      const yA = dy < 0 ? ly + 5 : ly - 14, yB = dy < 0 ? py - 7 : py + 7;
      labs += `<line x1="${px + dx}" x2="${px}" y1="${yA}" y2="${yB}" stroke="${COLORS[r.model]}" stroke-opacity=".7"/><text class="pt-label" x="${px + dx}" y="${ly}" text-anchor="middle">${r.model}</text>`;
      break;
    }
  }
  $('#chart-main').innerHTML = `<svg viewBox="0 0 ${W} ${H}" id="svg-main">${g}${labs}${pts}</svg>`;
  const tip = $('#tip');
  $('#svg-main').querySelectorAll('.pt').forEach((el) => {
    const r = rows.find((x) => x.id === el.dataset.id);
    el.addEventListener('mousemove', (e) => {
      tip.innerHTML = `<div class="t">${r.model} · ${r.effort}</div><div class="r">Total per return <b>${usd(r.total)}</b></div><div class="r">Practitioner review <b>${r.reviewMinutes.toFixed(1)} min</b></div><div class="r">Model cost <b>${usd(r.modelCost)}</b></div><div class="r">Escaped (out of sample) <b>${pct(r.looLoss, 2)}</b></div><div class="r">Accuracy (published) <b>${r.accuracy.toFixed(1)}%</b></div>`;
      tip.style.left = `${e.pageX + 14}px`; tip.style.top = `${e.pageY + 14}px`; tip.style.opacity = 1;
    });
    el.addEventListener('mouseleave', () => (tip.style.opacity = 0));
    el.addEventListener('click', () => { state.sel = r.id; state.ret = null; render(); });
  });
}

function renderLegend(vis) {
  const shapes = EFFORTS.map((e) => `<span class="lg"><svg width="12" height="12" viewBox="0 0 12 12">${marker(e, 6, 6, 3.6, '#b4b4b4')}</svg>${e}</span>`).join('');
  const models = [...new Set(vis.map((r) => r.model))].map((m) => `<span class="lg"><span class="sw" style="background:${COLORS[m]}"></span>${m}</span>`).join('');
  $('#legend').innerHTML = `<span class="lg" style="margin-right:6px">Reasoning effort</span>${shapes}<span class="sep"></span>${models}`;
}

const COLS = [
  { k: 'accuracy', t: 'Accuracy', s: 'published', f: (r) => `${r.accuracy.toFixed(1)}%`, d: -1 },
  { k: 'looLoss', t: 'Escaped', s: 'facts', f: (r) => pct(r.looLoss, 2), d: 1 },
  { k: 'reviewShare', t: 'Reviewed', s: 'facts', f: (r) => pct(r.reviewShare, 0), d: 1 },
  { k: 'reviewMinutes', t: 'Review', s: 'min / return', f: (r) => r.reviewMinutes.toFixed(1), d: 1 },
  { k: 'modelCost', t: 'Model', s: 'USD / return', f: (r) => usd(r.modelCost), d: 1 },
  { k: 'total', t: 'Total', s: 'USD / return', f: (r) => usd(r.total), d: 1, hi: true },
  { k: 'accRank', t: 'vs. accuracy', s: 'rank change', f: (r, i) => { const dlt = r.accRank - (i + 1); return dlt > 0 ? `<span class="up">↑ ${dlt}</span>` : dlt < 0 ? `<span class="dn">↓ ${-dlt}</span>` : '<span>·</span>'; }, d: 1, nosort: true },
];
function renderBoard(vis) {
  const sorted = [...vis].sort((a, b) => (a[state.sort] - b[state.sort]) * state.dir);
  const byTot = [...vis].sort((a, b) => a.total - b.total);
  const accR = [...vis].sort((a, b) => b.accuracy - a.accuracy); accR.forEach((r, i) => (r._acc = i + 1));
  byTot.forEach((r, i) => (r._tot = i + 1));
  const list = state.showAll ? sorted : sorted.slice(0, 10);
  const head = `<thead><tr><th>#</th><th>Model</th>${COLS.map((c) => `<th data-k="${c.k}" class="${state.sort === c.k ? 'sorted' : ''}">${c.t}${c.nosort ? '' : `<span class="arw">${state.sort === c.k ? (state.dir > 0 ? '↑' : '↓') : '↕'}</span>`}<span class="sub">${c.s}</span></th>`).join('')}</tr></thead>`;
  const body = list.map((r) => `<tr data-id="${r.id}" class="${r.id === state.sel ? 'sel' : ''}"><td>${r._tot}</td><td class="m"><div class="mn"><span class="pi">${icon(r.model)}</span><div><div class="nm">${r.model}</div><div class="ef">${r.effort}</div></div></div></td>${COLS.map((c) => `<td class="${c.hi ? 'hi' : ''}">${c.k === 'accRank' ? rankDelta(r) : c.f(r)}</td>`).join('')}</tr>`).join('');
  $('#lb').innerHTML = head + `<tbody>${body}</tbody>`;
  $('#lb-more').innerHTML = `<span>${state.showAll ? 'Show top 10' : `Show all ${vis.length} configurations`}</span><span>${state.showAll ? '−' : '+'}</span>`;
  $('#lb-more').style.display = vis.length > 10 ? '' : 'none';
  $('#lb').querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => { const c = COLS.find((x) => x.k === th.dataset.k); if (c.nosort) return; if (state.sort === c.k) state.dir *= -1; else { state.sort = c.k; state.dir = c.d; } render(); }));
  $('#lb').querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => { state.sel = tr.dataset.id; state.ret = null; render(); document.querySelector('#crc-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
}
function rankDelta(r) { const d = r._acc - r._tot; return d > 0 ? `<span class="up">↑ ${d}</span>` : d < 0 ? `<span class="dn">↓ ${-d}</span>` : '<span>0</span>'; }

function renderCrc() {
  const r = rows.find((x) => x.id === state.sel); const P = prep.perConfig[r.id]; const n = P.curves.length;
  $('#crc-who').innerHTML = `<span class="pi" style="display:inline-flex;width:12px;height:12px;margin-right:8px;vertical-align:-1px">${icon(r.model)}</span>${r.model} · ${r.effort} reasoning`;
  $('#crc-title').textContent = `How the ${pct(state.alpha, 0)} limit is enforced`;
  $('#crc-desc').innerHTML = `Each point on the curve is a risk threshold. Moving right reviews more of the return and lets fewer errors through. The plan uses the cheapest threshold whose calibration bound, the dashed curve, stays under the limit. The flags-only policy reviews just the sections the agent flagged or left partly uncited. The risk model separates sections with and without errors at AUC ${r.auc.toFixed(2)} here.`;
  const W = 760, H = 430, L = 56, R = 18, T = 22, B = 48;
  const rc = P.rc; const bound = rc.map((p) => ({ ...p, b: (n * p.loss + 1) / (n + 1) }));
  const yMax = Math.max(0.12, Math.ceil((Math.max(r.flagLoss, state.alpha) * 1.3) * 50) / 50);
  const X = (s) => L + s * (W - L - R), Y = (v) => T + (1 - Math.min(v, yMax) / yMax) * (H - T - B);
  let g = '';
  for (let s = 0; s <= 1.0001; s += 0.2) g += `<line x1="${X(s)}" x2="${X(s)}" y1="${T}" y2="${H - B}" stroke="var(--grid)"/><text class="tick" x="${X(s)}" y="${H - B + 18}" text-anchor="middle">${Math.round(s * 100)}%</text>`;
  const ystep = yMax > 0.1 ? 0.04 : 0.02;
  for (let v = 0; v <= yMax + 1e-9; v += ystep) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text class="tick" x="${L - 10}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`;
  g += `<text class="axis-title" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">Facts sent to practitioner review</text><text class="axis-title" transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Facts wrong and unreviewed</text>`;
  const line = (arr, key) => { let d = '', on = false; for (const p of arr) { if (p[key] > yMax) { on = false; continue; } d += `${on ? 'L' : 'M'}${X(p.share).toFixed(1)} ${Y(p[key]).toFixed(1)}`; on = true; } return d; };
  const top0 = rc[rc.length - 1];
  g += `<text class="tick" x="${L + 8}" y="${T + 14}">↑ With no review, ${pct(top0.loss, 0)} of facts would be wrong</text>`;
  g += `<path d="${line(bound, 'b')}" fill="none" stroke="#b4b4b4" stroke-dasharray="4 4"/>`;
  g += `<path d="${line(rc, 'loss')}" fill="none" stroke="${COLORS[r.model]}" stroke-width="2"/>`;
  g += `<line x1="${L}" x2="${W - R}" y1="${Y(state.alpha)}" y2="${Y(state.alpha)}" stroke="#fcc945" stroke-dasharray="6 4"/><text class="tick" x="${W - R - 4}" y="${Y(state.alpha) - 7}" text-anchor="end" fill="#fcc945">Limit ${pct(state.alpha, 0)}</text>`;
  if (r.g >= 0) {
    const p = rc[r.g];
    g += `<circle cx="${X(p.share)}" cy="${Y(bound[r.g].b)}" r="4" fill="#000" stroke="#eee"/><circle cx="${X(p.share)}" cy="${Y(p.loss)}" r="5.5" fill="#eee" stroke="#000"/>`;
    g += `<text class="pt-label" x="${X(p.share) - 12}" y="${Y(p.loss) + 22}" text-anchor="end">Plan: review ${pct(p.share, 0)} of facts</text>`;
  }
  // flags-only point (share of facts reviewed under that policy)
  const flagShare = flagShareOf(P.secs);
  g += marker('max', X(flagShare), Y(r.flagLoss), 6, '#e1a0a5');
  g += `<text class="pt-label" x="${X(flagShare) + 10}" y="${Y(r.flagLoss) + 4}" fill="#e1a0a5">Flags only: ${pct(r.flagLoss, 1)} escaped</text>`;
  $('#chart-rc').innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
  const S = r.g >= 0 ? P.curves.reduce((a, c) => a + c.loss[r.g], 0) : 0;
  const prod = productionCheck(prep, state.alpha);
  $('#crc-facts').innerHTML = `
    <div class="f"><div class="k">Risk threshold, calibrated on n = ${n} returns</div><div class="v">${r.lambda === null ? 'review all' : r.lambda.toFixed(3)}</div><div class="s">Sections scoring above it go to a practitioner</div></div>
    <div class="f"><div class="k">Calibration bound</div><div class="v">${pct((S + 1) / (n + 1), 2)} ≤ ${pct(state.alpha, 0)}</div><div class="s">(Σ escaped + 1) / (n + 1); the +1 costs ${pct(1 / (n + 1), 1)} at n = ${n}</div></div>
    <div class="f"><div class="k">Held-out check, one return at a time</div><div class="v good">${pct(r.looLoss, 2)} escaped</div><div class="s">${r.reviewMinutes.toFixed(1)} min reviewed per return vs ${r.fullMinutes.toFixed(1)} for a full review</div></div>
    <div class="f"><div class="k">Flags-only review</div><div class="v bad">${pct(r.flagLoss, 1)} escaped</div><div class="s">${r.flagMinutes.toFixed(1)} min per return, no guarantee</div></div>
    <div class="f"><div class="k">Same limit on production-quality drafts</div><div class="v">${pct(prod.saved, 0)} less review</div><div class="s">Synthetic ${pct(prod.accuracy, 0)}-accurate system, 88 fresh returns: ${prod.mins.toFixed(1)} of ${prod.full.toFixed(1)} min, ${pct(prod.loss, 2)} escaped</div></div>`;
}
function flagShareOf(secsByRet) { let s = 0; for (const secs of secsByRet) { const nF = secs.reduce((a, x) => a + x.nFacts, 0); s += secs.reduce((a, x) => a + (x.open || x.cite < 0.9 ? x.nFacts : 0), 0) / nF; } return s / secsByRet.length; }

function renderPlan() {
  const r = rows.find((x) => x.id === state.sel); const P = prep.perConfig[r.id]; const bench = prep.build.bench;
  if (state.ret === null) {
    // a representative complex return: several sections accepted, a moderate number of errors, at least one escape if any exist
    const score = (b, k) => { const lamK = r.per[k].g < 0 ? -1 : GRID[r.per[k].g]; const ss = P.secs[k]; const acc = ss.filter((x) => x.risk <= lamK).length; const err = ss.reduce((a, x) => a + x.err, 0); const esc = ss.filter((x) => x.risk <= lamK).reduce((a, x) => a + x.err, 0); return (b.tier === 2 && ss.length >= 9 && acc >= 3 ? 0 : 100) + Math.abs(err - 18) / 4 + (esc > 0 && esc <= 3 ? 0 : 3); };
    state.ret = bench.map((b, k) => [score(b, k), k]).sort((a, b) => a[0] - b[0])[0][1];
  }
  const i = state.ret, ret = bench[i], secs = P.secs[i], per = r.per[i];
  const lam = per.g < 0 ? -1 : GRID[per.g];
  const rowsS = secs.map((s) => ({ ...s, rev: s.risk > lam })).sort((a, b) => b.risk - a.risk);
  const revM = rowsS.filter((s) => s.rev).reduce((a, s) => a + s.minutes, 0), fullM = rowsS.reduce((a, s) => a + s.minutes, 0);
  const caught = rowsS.filter((s) => s.rev).reduce((a, s) => a + s.err, 0), esc = rowsS.filter((s) => !s.rev).reduce((a, s) => a + s.err, 0);
  const D = rowsS.reduce((a, s) => a + s.denomPart, 0);
  const nRev = rowsS.filter((s) => s.rev).length;
  let lastRev = -1; rowsS.forEach((s, k) => { if (s.rev) lastRev = k; });
  const body = rowsS.map((s, k) => `<tr class="${s.rev ? 'rev' : ''} ${k === lastRev && k < rowsS.length - 1 ? 'cut' : ''}"><td class="nm">${s.label}<span class="q">${QUALITY[s.quality]}${s.reconcile ? ' · reconcile across files' : ''}${s.newEntity ? ' · new this year' : ''}</span></td><td>${s.nFacts}</td><td><span class="bar"><i style="width:${(s.risk * 100).toFixed(0)}%"></i></span>${s.risk > 0.995 ? '>0.99' : s.risk.toFixed(2)}</td><td><span class="plan ${s.rev ? '' : 'acc'}">${s.rev ? 'Review' : 'Accept'}</span></td><td>${s.minutes.toFixed(1)}</td><td class="err ${s.err ? (s.rev ? 'c' : 'x') : ''}">${s.err ? (s.rev ? `${s.err} caught` : `${s.err} escaped`) : '—'}</td></tr>`).join('');
  $('#plan-card').innerHTML = `
    <div class="top"><div class="who"><span class="pi">${icon(r.model)}</span>${r.model} · ${r.effort} reasoning</div>
    <h3>Review plan for return ${ret.id} · ${ret.tierName} · ${secs.length} sections</h3>
    <p>Calibrated on the other ${bench.length - 1} returns (threshold ${lam < 0 ? 'none: review all' : lam.toFixed(3)}). The practitioner reviews ${nRev} section${nRev === 1 ? '' : 's'} and accepts ${secs.length - nRev} as drafted.</p></div>
    <div class="lab">Return ${ret.id} · practitioner review</div>
    <div class="cells three">
      <div class="cell"><div class="k">Practitioner time</div><div class="v">${revM.toFixed(1)} min</div><div class="s">of ${fullM.toFixed(1)} min for a full review</div></div>
      <div class="cell"><div class="k">Errors caught in review</div><div class="v">${caught} of ${caught + esc}</div><div class="s">wrong, missing or extra facts</div></div>
      <div class="cell hl"><div class="k">Escaped</div><div class="v">${esc} fact${esc === 1 ? '' : 's'}</div><div class="s tone">${pct(esc / D, 1)} of this return's ${D} facts</div></div>
    </div>
    <table class="sec"><thead><tr><th>Section</th><th>Facts</th><th>Risk</th><th>Plan</th><th>Min</th><th>Errors</th></tr></thead><tbody>${body}</tbody></table>
    <div class="ex-foot"><button id="prv"><span>←</span>Previous return</button><span style="color:var(--g11)">Return ${i + 1} of ${bench.length}</span><button id="nxt">Next return<span>→</span></button></div>`;
  $('#prv').onclick = () => { state.ret = (state.ret + bench.length - 1) % bench.length; renderPlan(); };
  $('#nxt').onclick = () => { state.ret = (state.ret + 1) % bench.length; renderPlan(); };
}

init().catch((e) => { console.error(e); $('#kpis').innerHTML = `<div class="cell"><div class="v">Failed to load: ${e.message}</div></div>`; });
