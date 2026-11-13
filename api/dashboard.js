import fs from 'node:fs';
import path from 'node:path';
import { readLogs } from '../lib/store.js';
import { computeMetrics, renderHtml } from '../lib/metrics.js';

const readOpt = (p) => {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), p), 'utf8')); } catch { return null; }
};

export default async function handler(req, res) {
  try {
    const logs = await readLogs('uas:log');
    const metrics = computeMetrics({
      logs,
      full: readOpt('results/backtest_full.json'),
      win: readOpt('results/backtest_window.json'),
      source: 'storage Upstash (uas:log)',
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).send(renderHtml(metrics));
  } catch (e) {
    return res.status(500).send(`Dashboard gagal: ${e.message}`);
  }
}
