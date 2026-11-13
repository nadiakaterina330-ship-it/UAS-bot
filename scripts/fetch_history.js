// Menarik candle 4 jam mundur dari sekarang ke tanggal awal (dijalankan di GitHub Actions).
// Maks ~2,5 request/detik, tidak paralel.
import fs from 'node:fs';
import { CONFIG as C } from '../lib/config.js';
import { fetchJson, normalizeCandles, getServerTime } from '../lib/indodax.js';

const years = Number(process.argv[2] || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSec = await getServerTime();
const startSec = nowSec - Math.round(years * 365.25 * 86400);
fs.mkdirSync('data', { recursive: true });

for (const pair of C.pairs) {
  const map = new Map();
  let to = nowSec, guard = 0;
  while (to > startSec && guard++ < 400) {
    const url = `https://indodax.com/tradingview/history_v2?symbol=${pair.toUpperCase()}&tf=${C.tf}&from=${startSec}&to=${to}`;
    const bars = normalizeCandles(await fetchJson(url));
    if (!bars.length) break;
    for (const b of bars) map.set(b.t, b);
    const earliest = bars[0].t;
    if (earliest >= to) break;
    to = earliest - 1;
    await sleep(400);
  }
  const all = [...map.values()].sort((a, b) => a.t - b.t).filter((b) => b.t >= startSec);
  fs.writeFileSync(`data/candles_${pair}.json`, JSON.stringify(all));
  const first = all[0] && new Date(all[0].t * 1000).toISOString();
  console.log(`${pair}: ${all.length} candle, mulai ${first}`);
  if (all.length && all[0].t > startSec + 30 * 86400) console.warn(`  PERINGATAN: data ${pair} belum mencapai ${years} tahun (pair mungkin baru listing atau penarikan terhenti)`);
}
