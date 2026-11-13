// Endpoint /api/tick: dipanggil penjadwal tiap jam (menit ke-7). Dilindungi CRON_SECRET.
// Alur: baca state -> ambil data -> validasi -> sinyal -> eksekusi simulasi di order book -> simpan state & log.
import { CONFIG as C } from '../lib/config.js';
import { getServerTime, getCandles, getDepth } from '../lib/indodax.js';
import { validateCandles, validateBook } from '../lib/validate.js';
import { signalFromWindow } from '../lib/signal.js';
import { fillBuy, fillSell, buyBudget } from '../lib/exec.js';
import { getJson, setJson, getRaw, acquireLock, releaseLock, appendLogs } from '../lib/store.js';

const LOG_KEY = 'uas:log', STATE_KEY = 'uas:state', LOCK_KEY = 'uas:lock', KILL_KEY = 'uas:kill';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET belum diset' });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  const logs = [];
  const log = (o) => logs.push({ ts: new Date().toISOString(), ...o });
  let locked = false;

  try {
    locked = await acquireLock(LOCK_KEY);
    if (!locked) { log({ type: 'skip', reason: 'panggilan lain sedang berjalan' }); return res.status(200).json({ skipped: 'locked' }); }

    const state = (await getJson(STATE_KEY)) || {
      cash: C.initialCapital, positions: {}, processed: {}, dayStart: null, startedAt: new Date().toISOString(),
    };
    const serverSec = await getServerTime();

    // Kill switch: env var atau flag di storage (tanpa deploy ulang)
    const killed = process.env.KILL_SWITCH === '1' || (await getRaw(KILL_KEY)) === '1';
    if (killed) log({ type: 'kill', note: 'kill switch aktif: tidak ada order' });

    // Fase 1: ambil data semua pair
    const data = {};
    for (const pair of C.pairs) {
      try {
        const bars = await getCandles(pair, C.tf, serverSec - (C.candleWindow + 10) * C.tfSec, serverSec);
        const book = await getDepth(pair);
        const vc = validateCandles(bars, serverSec);
        const vb = validateBook(book);
        if (book.bids.length && book.asks.length) {
          const bid = book.bids[0][0], ask = book.asks[0][0];
          log({ type: 'snapshot', pair, bid, ask, spread: (ask - bid) / ((ask + bid) / 2) }); // untuk estimasi spread
        }
        data[pair] = { book, vc, vb };
      } catch (e) {
        log({ type: 'error', pair, message: e.message });
      }
    }

    // Equity (posisi dinilai di best bid, bukan last/mid)
    const bidOf = (pair) => data[pair]?.book?.bids?.[0]?.[0] ?? state.positions[pair]?.lastBid ?? state.positions[pair]?.entry;
    const equityNow = () => state.cash + Object.entries(state.positions).reduce((s, [p, pos]) => s + pos.qty * bidOf(p), 0);
    for (const [p, pos] of Object.entries(state.positions)) if (data[p]?.book?.bids?.[0]) pos.lastBid = data[p].book.bids[0][0];

    let equity = equityNow();
    const wibDate = new Date(Date.now() + C.wibOffsetMs).toISOString().slice(0, 10);
    if (!state.dayStart || state.dayStart.date !== wibDate) {
      state.dayStart = { date: wibDate, equity };
      log({ type: 'equity_daily', date: wibDate, equity });
    }
    const dayPnl = equity / state.dayStart.equity - 1;
    const lossBlocked = dayPnl <= -C.dailyLossLimitPct;
    if (lossBlocked) log({ type: 'daily_loss_block', dayPnl, limit: C.dailyLossLimitPct });

    // Fase 2: keputusan per pair
    for (const pair of C.pairs) {
      const d = data[pair];
      if (!d) continue;
      if (!d.vc.ok) { log({ type: 'invalid', pair, reason: d.vc.reason }); continue; }
      const barTime = d.vc.closed[d.vc.closed.length - 1].t;
      if (state.processed[pair] === barTime) { log({ type: 'skip', pair, barTime, reason: 'candle sudah diproses (idempotent)' }); continue; }

      const close = d.vc.closed[d.vc.closed.length - 1].c;
      const sig = signalFromWindow(d.vc.closed);
      const pos = state.positions[pair];
      let action = 'HOLD', note;

      if (sig.entry && !pos) {
        const openCount = Object.keys(state.positions).length;
        const budget = buyBudget(equity, state.cash, openCount);
        if (killed) note = 'kill switch';
        else if (lossBlocked) note = 'daily loss limit';
        else if (openCount >= C.maxPositions) note = 'maks posisi';
        else if (!d.vb.ok) note = `order book: ${d.vb.reason}`;
        else if (budget < C.minOrder) note = 'budget di bawah minimum order';
        else {
          const f = fillBuy(d.book.asks, budget);
          if (f.qty > 0 && f.notional >= C.minOrder) {
            state.cash -= f.notional + f.fee;
            state.positions[pair] = { qty: f.qty, entry: f.avg, lastBid: d.book.bids[0][0] };
            action = 'BUY';
            log({ type: 'order', pair, side: 'BUY', barTime, qty: f.qty, bestBid: d.book.bids[0][0], bestAsk: d.book.asks[0][0], avgPrice: f.avg, notional: f.notional, fee: f.fee, signalPrice: close, vsSignal: f.avg / close - 1 });
          } else note = 'fill di bawah minimum order';
        }
      } else if (sig.exit && pos) {
        if (killed) note = 'kill switch';
        else if (!d.book.bids.length) note = 'order book kosong';
        else {
          const f = fillSell(d.book.bids, pos.qty);
          if (f.qty > 0) {
            state.cash += f.notional - f.fee;
            pos.qty -= f.qty;
            if (pos.qty < 1e-8) delete state.positions[pair];
            action = 'SELL';
            log({ type: 'order', pair, side: 'SELL', barTime, qty: f.qty, bestBid: d.book.bids[0][0], bestAsk: d.book.asks[0]?.[0] ?? null, avgPrice: f.avg, notional: f.notional, fee: f.fee, signalPrice: close, vsSignal: f.avg / close - 1 });
          }
        }
      }

      state.processed[pair] = barTime;
      log({ type: 'bar', pair, barTime, processedAt: Date.now(), close, entry: sig.entry, exit: sig.exit, hh: sig.hh, ll: sig.ll, sma: sig.sma, action, note });
      equity = equityNow();
    }

    equity = equityNow();
    log({ type: 'call', serverSec, equity, cash: state.cash, positions: state.positions, killed, startedAt: state.startedAt });
    await setJson(STATE_KEY, state);
    return res.status(200).json({ ok: true, equity });
  } catch (e) {
    log({ type: 'error', message: e.message });
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    if (locked) await releaseLock(LOCK_KEY).catch(() => {});
    await appendLogs(LOG_KEY, logs).catch(() => {});
  }
          }
