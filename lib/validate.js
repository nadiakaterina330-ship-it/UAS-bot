import { CONFIG as C } from './config.js';

// Buang candle yang masih berjalan (t + tf > waktu server), lalu validasi jendela.
export function validateCandles(bars, serverSec, cfg = C) {
  const closed = bars.filter((b) => b.t + cfg.tfSec <= serverSec);
  const win = closed.slice(-cfg.candleWindow);
  if (win.length < cfg.candleWindow) return { ok: false, reason: `candle kurang (${win.length}/${cfg.candleWindow})`, closed: win };
  const last = win[win.length - 1];
  if (serverSec - last.t > 2 * cfg.tfSec) return { ok: false, reason: 'candle tertutup terakhir lebih tua dari 2x timeframe', closed: win };
  for (let i = 1; i < win.length; i++) {
    if (win[i].t - win[i - 1].t !== cfg.tfSec) return { ok: false, reason: `candle hilang di jendela (sekitar t=${win[i].t})`, closed: win };
  }
  if (win.some((b) => !(b.c > 0) || !(b.v > 0))) return { ok: false, reason: 'harga atau volume nol di jendela', closed: win };
  return { ok: true, closed: win };
}

export function validateBook(book, cfg = C) {
  if (!book.bids.length || !book.asks.length) return { ok: false, reason: 'order book kosong' };
  const bid = book.bids[0][0], ask = book.asks[0][0];
  if (!(bid > 0) || !(ask > 0)) return { ok: false, reason: 'bid/ask nol' };
  const spread = (ask - bid) / ((ask + bid) / 2);
  if (spread > cfg.maxSpread) return { ok: false, reason: `spread ${(spread * 100).toFixed(2)}% > ${cfg.maxSpread * 100}%` };
  return { ok: true, bid, ask, spread };
}
