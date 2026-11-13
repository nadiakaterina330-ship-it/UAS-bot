// Semua angka dashboard dihitung di sini dari LOG MENTAH (tidak ada angka yang ditulis manual).
import { CONFIG as C } from './config.js';

export const FORWARD_END_MS = Date.parse('2026-11-14T05:00:00Z');
export const SCHEDULE_PHASES = [
  { fromMs: 0, everyMin: 60 },
  { fromMs: Date.parse('2026-11-13T12:30:00Z'), everyMin: 15 },
];

export const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function computeMetrics({ logs, full = null, win = null, evalEndMs = Math.min(Date.now(), FORWARD_END_MS), source = 'log mentah' }) {
  const by = (t) => logs.filter((l) => l.type === t);
  const calls = by('call'), orders = by('order'), bars = by('bar'), errors = by('error'), kills = by('kill'), snaps = by('snapshot');
  const invalids = by('invalid'), dailies = by('equity_daily');
  const tsMs = (l) => Date.parse(l.ts);
  const startMs = calls.length ? Math.min(...calls.map(tsMs)) : null;
  const lastMs = calls.length ? Math.max(...calls.map(tsMs)) : null;
  const endMs = startMs ? Math.max(lastMs, Math.min(evalEndMs, FORWARD_END_MS)) : null;

  const sortedCalls = [...calls].sort((a, b) => tsMs(a) - tsMs(b));
  const eq = sortedCalls.map((c) => c.equity);
  let peak = -Infinity, mdd = 0;
  for (const e of eq) { peak = Math.max(peak, e); mdd = Math.min(mdd, e / peak - 1); }
  const finalEq = eq.length ? eq[eq.length - 1] : null;

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
  const grossBefore = sumP(trips) + closedCosts;

  const seen = new Map();
  for (const b of bars) { const k = `${b.pair}|${b.barTime}`; if (!seen.has(k)) seen.set(k, b); }
  let expected = 0, onTime = 0;
  if (startMs && endMs) {
    const first = Math.ceil(startMs / 1000 / C.tfSec) * C.tfSec;
    for (let close = first; close * 1000 <= endMs; close += C.tfSec) {
      for (const p of C.pairs) {
        expected++;
        const b = seen.get(`${p}|${close - C.tfSec}`);
        if (b && b.processedAt <= (close + C.tfSec) * 1000) onTime++;
      }
    }
  }

  let scheduled = 0;
  if (startMs && endMs) {
    let t = startMs;
    while (t <= endMs) {
      scheduled++;
      const ph = [...SCHEDULE_PHASES].reverse().find((p) => p.fromMs <= t);
      t += ph.everyMin * 60000;
    }
  }

  let compared = 0, matched = 0; const mismatches = [];
  if (win) for (const [, b] of seen) {
    const bt = win.signals?.[b.pair]?.[b.barTime];
    if (bt === undefined) continue;
    compared++;
    if (bt[0] === b.entry && bt[1] === b.exit) matched++;
    else mismatches.push({ pair: b.pair, barTime: b.barTime, bot: [b.entry, b.exit], backtest: bt });
  }

  const btcSnaps = snaps.filter((s) => s.pair === 'btcidr').sort((a, b) => tsMs(a) - tsMs(b));
  const bnh = btcSnaps.length > 1 ? btcSnaps[btcSnaps.length - 1].bid / btcSnaps[0].ask - 1 : null;

  const spreadsBy = (pair) => snaps.filter((s) => s.pair === pair).map((s) => s.spread);
  return {
    generatedFrom: source,
    forward: {
      start: startMs && new Date(startMs).toISOString(), end: lastMs && new Date(lastMs).toISOString(),
      hours: startMs ? (lastMs - startMs) / 3600000 : null,
      totalReturn: finalEq !== null ? finalEq / C.initialCapital - 1 : null,
      maxDrawdown: eq.length ? mdd : null,
      trades: trips.length, openTrades: Object.values(held).filter((h) => h.qty > 1e-8).length,
      winRate: trips.length ? wins.length / trips.length : null,
      profitFactor: losses.length && sumP(losses) !== 0 ? sumP(wins) / Math.abs(sumP(losses)) : null,
      avgWin: wins.length ? sumP(wins) / wins.length : null,
      avgLoss: losses.length ? sumP(losses) / losses.length : null,
      costs: { fees, spreadCost, slipCost, share: grossBefore > 0 ? closedCosts / grossBefore : null },
      buyAndHoldBTC: bnh,
    },
    backtestFull: full?.metrics || null,
    backtestWindow: win?.metrics || null,
    signalMatch: win ? { compared, matched, pct: compared ? matched / compared : null, mismatches } : null,
    operations: {
      calls: calls.length, scheduledCalls: scheduled,
      barsExpected: expected, barsOnTime: onTime, uptime: expected ? onTime / expected : null,
      errors: errors.length, invalid: invalids.length, killSwitchLogs: kills.length,
      snapshots: snaps.length,
      medianSpread: median(snaps.map((s) => s.spread)),
      medianHalfSpread: snaps.length ? median(snaps.map((s) => s.spread)) / 2 : null,
      medianSpreadBTC: median(spreadsBy('btcidr')), medianSpreadETH: median(spreadsBy('ethidr')),
      backtestHalfSpreadAssumed: full?.metrics?.assumptions?.halfSpread ?? null,
      orderVsSignalMedian: median(orders.map((o) => o.vsSignal)),
    },
    equityDaily: dailies.map((d) => ({ date: d.date, equity: d.equity })),
  };
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function renderHtml(metrics) {
  const pct = (x, d = 2) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(d)}%`);
  const num = (x, d = 2) => (x === null || x === undefined ? 'n/a' : Number(x).toLocaleString('id-ID', { maximumFractionDigits: d }));
  const rp = (x) => (x === null || x === undefined ? 'n/a' : `Rp ${num(x, 0)}`);
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const f = metrics.forward, o = metrics.operations, bf = metrics.backtestFull, bw = metrics.backtestWindow, m = metrics.signalMatch;
  const bt = (x) => (x ? [
    row('Return total', pct(x.totalReturn)), row('CAGR', x.cagr === null ? 'n/a (periode < 1 tahun)' : pct(x.cagr)), row('Max drawdown', pct(x.maxDrawdown)),
    row('Profit factor', num(x.profitFactor)), row('Win rate', pct(x.winRate)), row('Rata-rata untung per trade', rp(x.avgWin)),
    row('Rata-rata rugi per trade', rp(x.avgLoss)), row('Jumlah trade', x.trades),
  ].join('') : row('Belum ada hasil', 'jalankan backtest'));
  const daily = metrics.equityDaily.map((d) => row(esc(d.date), rp(d.equity))).join('') || row('Belum ada', '-');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Bot Dry Run Indodax</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fafafa;color:#111}h1{font-size:1.3rem}h2{font-size:1rem;margin-top:24px}
table{border-collapse:collapse;width:100%;max-width:600px;background:#fff}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:.9rem}th{width:55%;background:#f0f0f0;font-weight:600}
.note{font-size:.8rem;color:#555;max-width:600px}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}table{background:#1a1a1a}th{background:#222}th,td{border-color:#333}.note{color:#aaa}}</style></head><body>
<h1>Dashboard Bot Dry Run Indodax</h1>
<p class="note">Semua angka dihitung ulang dari log mentah (${esc(metrics.generatedFrom)}). Periode forward test tercatat: ${esc(f.start ?? 'n/a')} sampai ${esc(f.end ?? 'n/a')} (${f.hours === null ? 'n/a' : num(f.hours, 1)} jam). Forward test dimulai terlambat dari jadwal soal (4 Nov); lihat README.</p>
<h2>Backtest penuh (3 tahun)</h2><table>${bt(bf)}</table>
<h2>Backtest pada jendela forward</h2><table>${bt(bw)}</table>
<h2>Forward test</h2><table>
${row('Return total', pct(f.totalReturn))}${row('Max drawdown', pct(f.maxDrawdown))}${row('Profit factor', num(f.profitFactor))}${row('Win rate', pct(f.winRate))}
${row('Rata-rata untung per trade', rp(f.avgWin))}${row('Rata-rata rugi per trade', rp(f.avgLoss))}${row('Jumlah trade (selesai)', f.trades)}${row('Posisi masih terbuka', f.openTrades)}
${row('Biaya: fee', rp(f.costs.fees))}${row('Biaya: spread', rp(f.costs.spreadCost))}${row('Biaya: slippage', rp(f.costs.slipCost))}${row('Porsi biaya terhadap laba kotor', pct(f.costs.share))}
${row('Benchmark buy and hold BTC/IDR (ask awal, bid akhir)', pct(f.buyAndHoldBTC))}</table>
<h2>Gap backtest vs forward (jendela yang sama)</h2><table>
${row('Sinyal dibandingkan (candle demi candle)', m ? m.compared : 'n/a')}${row('Sinyal identik', m ? `${m.matched} (${pct(m.pct)})` : 'n/a')}
${row('Selisih return (forward - backtest jendela)', bw && f.totalReturn !== null ? pct(f.totalReturn - bw.totalReturn) : 'n/a')}
${row('Median half-spread semua snapshot', pct(o.medianHalfSpread, 4))}${row('Half-spread asumsi backtest', pct(o.backtestHalfSpreadAssumed, 4))}
${row('Median spread BTC/IDR', pct(o.medianSpreadBTC, 4))}${row('Median spread ETH/IDR', pct(o.medianSpreadETH, 4))}
${row('Median selisih fill vs harga sinyal', pct(o.orderVsSignalMedian, 4))}</table>
<h2>Panel operasional</h2><table>
${row('Panggilan terjadwal (acuan jadwal)', o.scheduledCalls)}${row('Panggilan terlaksana', o.calls)}
${row('Candle diharapkan (pair x candle 4 jam)', o.barsExpected)}${row('Candle diproses tepat waktu', o.barsOnTime)}${row('Uptime', pct(o.uptime))}
${row('Error API', o.errors)}${row('Data tidak valid (dicatat)', o.invalid)}${row('Pemakaian kill switch (log)', o.killSwitchLogs)}${row('Snapshot order book', o.snapshots)}</table>
<h2>Equity harian (panggilan pertama setelah 00.00 WIB)</h2><table>${daily}</table>
<p class="note">Return forward dihitung dari equity tiap panggilan (posisi dinilai pada best bid). CAGR sengaja tidak ditampilkan untuk forward test. Jadwal acuan: GitHub Actions tiap jam, lalu cron-job.org tiap 15 menit sejak 13 Nov 19.30 WIB.</p>
</body></html>`;
  }
