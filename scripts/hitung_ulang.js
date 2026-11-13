// Menghitung ULANG semua angka dashboard dari log mentah. Tidak ada angka yang ditulis manual.
import fs from 'node:fs';
import { computeMetrics, renderHtml, FORWARD_END_MS } from '../lib/metrics.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v]; }));
const logPath = args.log || 'data_out/logs.json';
const outDir = args.out || 'out';
const readOpt = (p) => (p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

const logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
const metrics = computeMetrics({
  logs,
  full: readOpt(args.full || 'results/backtest_full.json'),
  win: readOpt(args.window || 'results/backtest_window.json'),
  evalEndMs: Math.min(Date.now(), FORWARD_END_MS),
  source: logPath,
});
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/metrics.json`, JSON.stringify(metrics, null, 2));
fs.writeFileSync(`${outDir}/dashboard.html`, renderHtml(metrics));
console.log(JSON.stringify(metrics, null, 2));
console.log(`\n-> ${outDir}/metrics.json dan ${outDir}/dashboard.html`);
