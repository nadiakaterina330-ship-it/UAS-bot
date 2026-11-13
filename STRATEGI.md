# Strategi (dibekukan sejak commit freeze)

> Setelah freeze, `lib/config.js` tidak diubah. Catatan: freeze dilakukan terlambat dari jadwal soal (lihat README, Catatan jujur).

**Jenis:** Donchian breakout + filter SMA, long-only (tanpa short, margin, leverage). Ini strategi UTS v1 (N=90, K=30, M=200) dengan parameter yang sama. Yang berubah hanya pasar dan satuan bar.

**Timeframe:** 4 jam (`tf=240`). Satu bar = 4 jam, sehingga N=90 bar = 15 hari, K=30 bar = 5 hari, SMA 200 bar = sekitar 33 hari.

**Universe:** BTC/IDR, ETH/IDR. Dipilih karena keduanya pasangan IDR yang dikenal paling likuid. Likuiditas TIDAK diukur kuantitatif pada awal periode backtest, sehingga ada risiko bias seleksi (dua aset yang bertahan dan besar sampai sekarang). Ini keterbatasan yang diakui.

**Aturan masuk:** pada candle 4 jam yang baru tertutup, jika Close > High tertinggi N bar sebelumnya DAN Close > SMA(M), dan belum ada posisi di pasangan itu, beli di ask (menghabiskan level order book).

**Aturan keluar:** jika Close < Low terendah K bar sebelumnya dan ada posisi, jual seluruh posisi di bid. Tanpa trailing stop (sama dengan v1 UTS).

**Sinyal:** dihitung hanya dari 210 candle tertutup terakhir (candle berjalan dibuang). Fungsi `signalFromWindow` di `lib/signal.js` dipakai bersama oleh bot dan backtest.

**Sizing dan risk:** maks 2 posisi; maks 40% equity per posisi; daily loss limit 3% (hari WIB, ganti 00.00 WIB); kill switch manual; idempotensi per candle; retry maks 3 kali.

**Eksekusi:** beli di ask, jual di bid dari order book live; fee taker dan minimum order Rp25.000 sesuai `lib/config.js`.

## Sumber fee dan minimum order
| Item | Nilai | URL | Tanggal akses |
|---|---|---|---|
| `trade_fee_percent_taker` di /api/pairs (btc_idr dan eth_idr) | 0,2% (maker 0,1%) | https://indodax.com/api/pairs | 12 Nov 2026 |
| `trade_min_base_currency` di /api/pairs (btc_idr dan eth_idr) | Rp10.000 (dipakai Rp25.000 sesuai soal) | https://indodax.com/api/pairs | 12 Nov 2026 |
| Rincian biaya transaksi (help.indodax.com) | tidak ditemukan | help.indodax.com | 12 Nov 2026 |
| Dipakai | 0,5% taker (asumsi konservatif, lebih mahal dari 0,2% di /api/pairs) | | |

## Catatan perubahan dari versi UTS
- Pasar: saham BEI harian menjadi kripto IDR 4 jam (pasar 24/7, tanpa lot 100, tanpa ARA/ARB).
- Parameter N=90, K=30, M=200 tidak diubah. Satuannya berpindah dari hari ke bar 4 jam, sehingga rentang waktunya lebih pendek.
- Tanpa trailing stop ATR (setara A=0 pada v1 UTS).
- Universe 40 saham menjadi 2 pasangan IDR; maks posisi 10 menjadi 2, ukuran posisi 10% menjadi 40% equity.
- Biaya: fee saham menjadi fee taker Indodax; spread diukur dari snapshot order book.
- Parameter tidak dioptimasi ulang di data kripto, untuk menghindari overfitting dan menjaga kesamaan dengan UTS.
