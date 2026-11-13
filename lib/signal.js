// Fungsi sinyal MURNI. Dipakai bot (api/tick.js) DAN backtest (scripts/backtest.js).
// Strategi UTS v1: Donchian breakout + filter SMA, long-only.
// Input: array bar tertutup {h, l, c} dari tepat `candleWindow` candle (terlama -> terbaru).
import { CONFIG as C } from './config.js';

export function signalFromWindow(bars, cfg = C) {
  if (bars.length < cfg.candleWindow) return { entry: null, exit: null };
  const w = bars.slice(-cfg.candleWindow);
  const i = w.length - 1;
  const close = w[i].c;
  const hh = Math.max(...w.slice(i - cfg.donN, i).map((b) => b.h));   // N bar sebelum bar ini
  const ll = Math.min(...w.slice(i - cfg.donK, i).map((b) => b.l));   // K bar sebelum bar ini
  const sma = w.slice(i - cfg.smaM + 1, i + 1).reduce((s, b) => s + b.c, 0) / cfg.smaM;
  return { entry: close > hh && close > sma, exit: close < ll, hh, ll, sma, close };
}
