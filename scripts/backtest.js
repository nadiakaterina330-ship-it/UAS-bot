// Backtest memakai fungsi sinyal & sizing yang SAMA dengan bot.
// Pakai: node scripts/backtest.js --halfSpread=0.0008 --slip=0.0002 [--from=<unix> --to=<unix>] [--out=results/backtest_full.json]
// halfSpread & slip WAJIB berasal dari snapshot order book yang kamu ukur (median), bukan tebakan.
import fs from 'node:fs';
import { CONFIG as C } from '../lib/config.js';
import { signalFromWindow } from '../lib/signal.js';
import { buyBudget } from '../lib/exec.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v]; }));
const half = parseFloat(args.halfSpread), slip = parseFloat(args.slip);
if (!(half >= 0) || !(slip >= 0)) { console.error('Wajib: --halfSpread=<pecahan> --slip=<pecahan> dari snapshot terukur'); process.exit(1); }
const from = args.from ? Number(args.from) : -Infinity, to = args.to ? Number(args.to) : Infinity;
const out = args.out || (Number.isFinite(from) ? 'results/backtest_window.json' : 'results/backtest_full.json');

const data = {}, index = {};
for (const p of C.pairs) {
  data[p] = JSON.parse(fs.readFileSync(`data/candles_${p}.json`, 'utf8'));
  index[p] = new Map(data[p].map((b, i) => [b.t, i]));
}
const times = [...new Set(C.pairs.flatMap((p) => data[p].map((b) => b.t)))].sort((a, b) => a - b);

let cash = C.initialCapital;
const pos = {}, last = {}, signals = {}, trips = {}, equitySeries = [];
for (const p of C.pairs) { signals[p] = {}; }
let firstT = null, lastT = null;

for (const t of times) {
  if (t < from || t > to) {
    for (const p of C.pairs) { const i = index[p].get(t); if (i !== undefined) last[p] = data[p][i].c; }
    continue;
  }
  for (const p of C.pairs) { const i = index[p].get(t); if (i !== undefined) last[p] = data[p][i].c; }
  const equityNow = () => cash + Object.entries(pos).reduce((s, [p, x]) => s + x.qty * last[p] * (1 - half), 0);
  let equity = equityNow();
  for (const p of C.pairs) {
    const i = index[p].get(t);
    if (i === undefined || i < C.candleWindow - 1) continue;
    const win = data[p].slice(i - C.candleWindow + 1, i + 1);
    if (win.some((b, k) => k && b.t - win[k - 1].t !== C.tfSec) || win.some((b) => !(b.c > 0) || !(b.v > 0))) continue; // jendela tidak valid
    const sig = signalFromWindow(win);
    signals[p][t] = [sig.entry, sig.exit];
    const close = data[p][i].c;
    if (sig.entry && !pos[p]) {
      const budget = buyBudget(equity, cash, Object.keys(pos).length);
      if (budget < C.minOrder) continue;
      const price = close * (1 + half) * (1 + slip);
      const qty = Math.floor((budget / (1 + C.feeTaker) / price) * 1e8) / 1e8;
      const notional = qty * price;
      if (notional < C.minOrder) continue;
      const fee = notional * C.feeTaker;
      cash -= notional + fee;
      pos[p] = { qty };
      trips[p] = { cost: notional + fee };
    } else if (sig.exit && pos[p]) {
      const price = close * (1 - half) * (1 - slip);
      const notional = pos[p].qty * price, fee = notional * C.feeTaker;
      cash += notional - fee;
      (trips.done ||= []).push({ pair: p, pnl: notional - fee - trips[p].cost, t });
      delete pos[p]; delete trips[p];
    }
    equity = equityNow();
  }
  firstT ??= t; lastT = t;
  equitySeries.push([t, equityNow()]);
}

const done = trips.done || [];
const wins = done.filter((x) => x.pnl > 0), losses = done.filter((x) => x.pnl <= 0);
const sum = (a) => a.reduce((s, x) => s + x.pnl, 0);
let peak = -Infinity, mdd = 0;
for (const [, e] of equitySeries) { peak = Math.max(peak, e); mdd = Math.min(mdd, e / peak - 1); }
const finalEq = equitySeries.length ? equitySeries[equitySeries.length - 1][1] : C.initialCapital;
const years = firstT ? (lastT - firstT) / (365.25 * 86400) : 0;
const metrics = {
  windowFrom: firstT, windowTo: lastT,
  totalReturn: finalEq / C.initialCapital - 1,
  cagr: years >= 1 ? Math.pow(finalEq / C.initialCapital, 1 / years) - 1 : null,
  maxDrawdown: mdd,
  trades: done.length,
  winRate: done.length ? wins.length / done.length : null,
  profitFactor: losses.length && sum(losses) !== 0 ? sum(wins) / Math.abs(sum(losses)) : null,
  avgWin: wins.length ? sum(wins) / wins.length : null,
  avgLoss: losses.length ? sum(losses) / losses.length : null,
  assumptions: { halfSpread: half, slip, feeTaker: C.feeTaker },
};
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(out, JSON.stringify({ metrics, signals, trades: done, equity: equitySeries }));
console.log(JSON.stringify(metrics, null, 2));
console.log('->', out);
