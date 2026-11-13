// Menghitung ULANG semua angka dashboard dari log mentah. Tidak ada angka yang ditulis manual.
// Pakai: node scripts/hitung_ulang.js [--log=data_out/logs.json] [--window=results/backtest_window.json]
//        [--full=results/backtest_full.json] [--btc=data/candles_btcidr.json] [--out=out]
import fs from 'node:fs';
import { CONFIG as C } from '../lib/config.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v]; }));
const logPath = args.log || 'data_out/logs.json';
const outDir = args.out || 'out';
const readOpt = (p) => (p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

const logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
const by = (t) => logs.filter((l) => l.type === t);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const calls = by('call'), orders = by('order'), bars = by('bar'), errors = by('error'), kills = by('kill'), snaps = by('snapshot');
const tsMs = (l) => Date.parse(l.ts);
const startMs = calls.length ? Math.min(...calls.map(tsMs)) : null;
const endMs = calls.length ? Math.max(...calls.map(tsMs)) : null;

// Equity & drawdown (dari equity tiap panggilan)
const eq = calls.map((c) => c.equity);
let peak = -Infinity, mdd = 0;
for (const e of eq) { peak = Math.max(peak, e); mdd = Math.min(mdd, e / peak - 1); }
const finalEq = eq.length ? eq[eq.length - 1] : null;

// Round-trip per pair (satu posisi per pair)
const held = {}, trips = [];
let fees = 0, spreadCost = 0, slipCost = 0, closedCosts = 0;
for (const o of orders) {
  const sp = (o.qty * (o.bestAsk - o.bestBid)) / 2;
  const sl = o.qty * Math.abs(o.avgPrice - (o.side === 'BUY' ? o.bestAsk : o.bestBid));
  fees += o.fee; spreadCost += sp; slipCost += sl;
  const h = (held[o.pair] ||= { qty: 0, cost: 0, proceeds: 0, costs: 0 });
  h.costs += o.fee + sp + sl;
  if (o.side === 'BUY') { h.qty += o.qty; h.cost += o.notional + o.fee; }
  else {
    h.qty -= o.qty; h.proceeds += o.notional - o.fee;
    if (h.qty < 1e-8) { trips.push({ pair: o.pair, pnl: h.proceeds - h.cost }); closedCosts += h.costs; held[o.pair] = { qty: 0, cost: 0, proceeds: 0, costs: 0 }; }
  }
}
const wins = trips.filter((t) => t.pnl > 0), losses = trips.filter((t) => t.pnl <= 0);
const sumP = (a) => a.reduce((s, t) => s + t.pnl, 0);
const netClosed = sumP(trips);
const grossBefore = netClosed + closedCosts; // laba kotor sebelum biaya, hanya trade yang sudah selesai

// Uptime: candle diproses sebelum candle berikutnya ditutup (barTime + 2*tf)
const seen = new Map();
for (const b of bars) { const k = `${b.pair}|${b.barTime}`; if (!seen.has(k)) seen.set(k, b); }
let expected = 0, onTime = 0;
if (startMs && endMs) {
  const first = Math.ceil(startMs / 1000 / C.tfSec) * C.tfSec;
  for (let close = first; close <= endMs / 1000; close += C.tfSec) {
    for (const p of C.pairs) {
      expected++;
      const b = seen.get(`${p}|${close - C.tfSec}`);
      if (b && b.processedAt <= (close + C.tfSec) * 1000) onTime++;
    }
  }
}

// Kecocokan sinyal bot vs backtest pada jendela yang sama
const win = readOpt(args.window || 'results/backtest_window.json');
let compared = 0, matched = 0; const mismatches = [];
if (win) for (const [, b] of seen) {
  const bt = win.signals?.[b.pair]?.[b.barTime];
  if (bt === undefined) continue;
  compared++;
  if (bt[0] === b.entry && bt[1] === b.exit) matched++; else mismatches.push({ pair: b.pair, barTime: b.barTime, bot: [b.entry, b.exit], backtest: bt });
}

// Buy & hold BTC/IDR pada periode forward
const btc = readOpt(args.btc || 'data/candles_btcidr.json');
let bnh = null;
if (btc && startMs && endMs) {
  const a = btc.find((c) => c.t * 1000 >= startMs), b = [...btc].reverse().find((c) => (c.t + C.tfSec) * 1000 <= endMs);
  if (a && b) bnh = b.c / a.o - 1;
}

const full = readOpt(args.full || 'results/backtest_full.json');
const metrics = {
  generatedFrom: logPath,
  forward: {
    start: startMs && new Date(startMs).toISOString(), end: endMs && new Date(endMs).toISOString(),
    totalReturn: finalEq !== null ? finalEq / C.initialCapital - 1 : null,
    maxDrawdown: eq.length ? mdd : null,
    trades: trips.length, openTrades: Object.values(held).filter((h) => h.qty > 1e-8).length,
    winRate: trips.length ? wins.length / trips.length : null,
    profitFactor: losses.length && sumP(losses) !== 0 ? sumP(wins) / Math.abs(sumP(losses)) : null,
    avgWin: wins.length ? sumP(wins) / wins.length : null, avgLoss: losses.length ? sumP(losses) / losses.length : null,
    costs: { fees, spreadCost, slipCost, share: grossBefore > 0 ? closedCosts / grossBefore : null },
    buyAndHoldBTC: bnh,
  },
  backtestFull: full?.metrics || null,
  backtestWindow: win?.metrics || null,
  signalMatch: win ? { compared, matched, pct: compared ? matched / compared : null, mismatches } : null,
  operations: {
    calls: calls.length, barsExpected: expected, barsOnTime: onTime, uptime: expected ? onTime / expected : null,
    errors: errors.length, killSwitchLogs: kills.length,
    medianSpread: median(snaps.map((s) => s.spread)), snapshots: snaps.length,
    medianHalfSpread: snaps.length ? median(snaps.map((s) => s.spread)) / 2 : null,
    backtestHalfSpreadAssumed: full?.metrics?.assumptions?.halfSpread ?? null,
    orderVsSignalMedian: median(orders.map((o) => o.vsSignal)),
  },
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/metrics.json`, JSON.stringify(metrics, null, 2));

// ---- Dashboard HTML offline (satu file, tanpa internet) ----
const pct = (x, d = 2) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const num = (x, d = 2) => (x === null || x === undefined ? 'n/a' : Number(x).toLocaleString('id-ID', { maximumFractionDigits: d }));
const rp = (x) => (x === null || x === undefined ? 'n/a' : `Rp ${num(x, 0)}`);
const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
const f = metrics.forward, o = metrics.operations, bf = metrics.backtestFull, bw = metrics.backtestWindow, m = metrics.signalMatch;
const bt = (x) => (x ? `
${row('Return total', pct(x.totalReturn))}${row('CAGR', pct(x.cagr))}${row('Max drawdown', pct(x.maxDrawdown))}
${row('Profit factor', num(x.profitFactor))}${row('Win rate', pct(x.winRate))}${row('Rata-rata untung', rp(x.avgWin))}${row('Rata-rata rugi', rp(x.avgLoss))}${row('Jumlah trade', x.trades)}` : row('Belum ada hasil', 'jalankan backtest'));
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Bot Dry Run Indodax</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fafafa;color:#111}h1{font-size:1.3rem}h2{font-size:1rem;margin-top:24px}
table{border-collapse:collapse;width:100%;max-width:560px;background:#fff}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:.9rem}th{width:55%;background:#f0f0f0;font-weight:600}
.note{font-size:.8rem;color:#555}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}table{background:#1a1a1a}th{background:#222}th,td{border-color:#333}.note{color:#aaa}}</style></head><body>
<h1>Dashboard Bot Dry Run Indodax</h1>
<p class="note">Dihasilkan otomatis oleh scripts/hitung_ulang.js dari ${logPath}. Periode forward: ${f.start ?? 'n/a'} sampai ${f.end ?? 'n/a'}.</p>
<h2>Backtest penuh</h2><table>${bt(bf)}</table>
<h2>Backtest pada jendela forward</h2><table>${bt(bw)}</table>
<h2>Forward test</h2><table>
${row('Return total', pct(f.totalReturn))}${row('Max drawdown', pct(f.maxDrawdown))}${row('Profit factor', num(f.profitFactor))}${row('Win rate', pct(f.winRate))}
${row('Rata-rata untung', rp(f.avgWin))}${row('Rata-rata rugi', rp(f.avgLoss))}${row('Jumlah trade (selesai)', f.trades)}${row('Posisi masih terbuka', f.openTrades)}
${row('Biaya: fee', rp(f.costs.fees))}${row('Biaya: spread', rp(f.costs.spreadCost))}${row('Biaya: slippage', rp(f.costs.slipCost))}${row('Porsi biaya terhadap laba kotor', pct(f.costs.share))}
${row('Benchmark buy and hold BTC/IDR', pct(f.buyAndHoldBTC))}</table>
<h2>Gap backtest vs forward (jendela yang sama)</h2><table>
${row('Sinyal dibandingkan', m ? m.compared : 'n/a')}${row('Sinyal identik', m ? `${m.matched} (${pct(m.pct)})` : 'n/a')}
${row('Selisih return (forward - backtest jendela)', bw && f.totalReturn !== null ? pct(f.totalReturn - bw.totalReturn) : 'n/a')}
${row('Median half-spread snapshot', pct(o.medianHalfSpread, 4))}${row('Half-spread asumsi backtest', pct(o.backtestHalfSpreadAssumed, 4))}
${row('Median selisih fill vs harga sinyal', pct(o.orderVsSignalMedian, 4))}</table>
<h2>Operasional</h2><table>
${row('Panggilan tercatat', o.calls)}${row('Candle diharapkan (pair x jam)', o.barsExpected)}${row('Candle diproses tepat waktu', o.barsOnTime)}${row('Uptime', pct(o.uptime))}
${row('Error API', o.errors)}${row('Pemakaian kill switch (log)', o.killSwitchLogs)}${row('Snapshot order book', o.snapshots)}</table>
<p class="note">Catatan: return forward dihitung dari equity tiap panggilan (posisi dinilai pada best bid). CAGR sengaja tidak ditampilkan untuk forward test.</p>
</body></html>`;
fs.writeFileSync(`${outDir}/dashboard.html`, html);
console.log(JSON.stringify(metrics, null, 2));
console.log(`\n-> ${outDir}/metrics.json dan ${outDir}/dashboard.html`);
