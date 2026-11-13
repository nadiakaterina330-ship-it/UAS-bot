// Klien API publik Indodax (tanpa API key). Retry terbatas + timeout.
import { CONFIG as C } from './config.js';

const BASE = 'https://indodax.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= C.maxRetries; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(C.timeoutMs) });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      const text = await r.text();
      if (!text) throw new Error(`Respons kosong ${url}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < C.maxRetries) await sleep(500 * attempt);
    }
  }
  throw new Error(`Gagal setelah ${C.maxRetries} percobaan: ${lastErr.message}`);
}

export async function getServerTime() {
  const j = await fetchJson(`${BASE}/api/server_time`);
  let t = Number(j.server_time);
  if (t > 1e12) t = Math.floor(t / 1000); // ms -> detik
  return t;
}

// Candle ternormalisasi: { t (detik, waktu buka), o, h, l, c, v }
export function normalizeCandles(raw) {
  return raw
    .map((b) => ({
      t: Number(b.Time ?? b.time),
      o: Number(b.Open ?? b.open),
      h: Number(b.High ?? b.high),
      l: Number(b.Low ?? b.low),
      c: Number(b.Close ?? b.close),
      v: Number(b.Volume ?? b.volume),
    }))
    .sort((a, b) => a.t - b.t);
}

export async function getCandles(pair, tfMin, fromSec, toSec) {
  const url = `${BASE}/tradingview/history_v2?symbol=${pair.toUpperCase()}&tf=${tfMin}&from=${fromSec}&to=${toSec}`;
  const raw = await fetchJson(url);
  if (!Array.isArray(raw)) throw new Error('history_v2 bukan array');
  return normalizeCandles(raw);
}

// Order book: bids (turun) & asks (naik), tiap level [harga, jumlah_base]
export async function getDepth(pair) {
  const j = await fetchJson(`${BASE}/api/depth/${pair}`);
  const conv = (lv) => (lv || []).map(([p, a]) => [Number(p), Number(a)]);
  return { bids: conv(j.buy), asks: conv(j.sell) };
}
