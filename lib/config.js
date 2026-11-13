// Konfigurasi strategi & eksekusi. Setelah freeze: JANGAN ubah file ini.
export const CONFIG = {
  tf: 240,                // timeframe history_v2 (menit): 4 jam
  tfSec: 14400,
  pairs: ['btcidr', 'ethidr'],
  initialCapital: 100_000_000,

  // Fee: /api/pairs menyebut taker 0,2% (diakses 12 Nov 2026). Halaman rincian biaya
  // resmi belum ditemukan, jadi dipakai angka konservatif 0,5% (lebih mahal).
  feeTaker: 0.005,
  minOrder: 25_000,       // Rp25.000 (lebih ketat dari /api/pairs), sesuai soal

  // Risk management
  maxPositions: 2,
  maxPositionPct: 0.4,    // maks 40% equity per posisi
  dailyLossLimitPct: 0.03, // batas rugi harian 3% (hari WIB)
  maxSpread: 0.02,        // validasi: spread bid-ask > 2% => tidak buka posisi

  // Strategi UTS v1 (Donchian breakout + filter SMA, long-only). Parameter SAMA dengan UTS, satuan bar sekarang 4 jam.
  donN: 90,               // beli bila Close > High tertinggi N bar sebelumnya
  donK: 30,               // jual bila Close < Low terendah K bar sebelumnya
  smaM: 200,              // filter: Close > SMA(M)
  candleWindow: 210,      // jumlah candle tertutup yang dipakai tiap sinyal (harus >= smaM)

  // Jaringan
  maxRetries: 3,
  timeoutMs: 10_000,
  wibOffsetMs: 7 * 3600 * 1000,
};
