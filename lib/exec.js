// Eksekusi simulasi di order book: habiskan level, pakai harga rata-rata. Dilarang fill di mid/close.
import { CONFIG as C } from './config.js';

const floor8 = (x) => Math.floor(x * 1e8) / 1e8;

function walk(levels, qtyTarget) {
  let left = qtyTarget, qty = 0, notional = 0;
  for (const [p, a] of levels) {
    if (left <= 0) break;
    const take = Math.min(a, left);
    qty += take; notional += take * p; left -= take;
  }
  return { qty, notional, avg: qty > 0 ? notional / qty : 0 };
}

// budget = total uang maksimal (termasuk fee)
export function fillBuy(asks, budget, fee = C.feeTaker) {
  let remaining = budget / (1 + fee), est = 0;
  for (const [p, a] of asks) {
    if (remaining <= 0) break;
    const take = Math.min(a, remaining / p);
    est += take; remaining -= take * p;
  }
  const w = walk(asks, floor8(est));
  return { ...w, fee: w.notional * fee };
}

export function fillSell(bids, qty, fee = C.feeTaker) {
  const w = walk(bids, floor8(qty));
  return { ...w, fee: w.notional * fee };
}

// Ukuran posisi baru (dipakai bot dan backtest agar identik)
export function buyBudget(equity, cash, openCount, cfg = C) {
  if (openCount >= cfg.maxPositions) return 0;
  return Math.min(equity * cfg.maxPositionPct, cash);
}
