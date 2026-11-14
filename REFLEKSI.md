# Refleksi UAS Algorithmic Trading

Semua angka di bawah diambil dari `hasil/metrics.json`, yang dihitung ulang oleh `scripts/hitung_ulang.js` dari `hasil/logs_mentah.json`. Tidak ada angka yang ditulis tangan.

## 1. Hasil
| | Backtest penuh (3 tahun) | Backtest jendela forward | Forward test |
|---|---|---|---|
| Return total | 71,77% | 0% | 0% |
| CAGR | 19,76% | n/a | tidak dihitung |
| Max drawdown | -18,92% | 0% | 0% |
| Jumlah trade | 51 | 0 | 0 |
| Win rate | 47,06% | n/a | n/a |
| Profit factor | 1,85 | n/a | n/a |
| Rata-rata untung / rugi per trade | Rp6.501.587 / -Rp3.120.918 | n/a | n/a |

Buy and hold BTC/IDR pada periode forward: -2,86% (ask snapshot pertama ke bid snapshot terakhir). Bot tidak membuka posisi, jadi ia menghindari penurunan itu, tetapi ini bukan bukti keunggulan strategi karena periodenya hanya sekitar 20,5 jam.

Porsi biaya terhadap laba kotor tidak bisa dihitung untuk forward (tidak ada trade selesai, biaya = Rp0). Backtest memakai fee taker 0,5% dan half-spread 0,0247% (median spread semua snapshot dibagi dua); slippage diasumsikan 0 karena tidak ada order untuk diukur.

## 2. Gap backtest vs forward
Pada jendela yang sama, backtest dan bot sama-sama tidak membuka trade, dan **8 dari 8 sinyal candle yang tercatat di log identik** (entry dan exit). Gap return = 0%. Ini lemah sebagai bukti: tanpa satu pun order, kualitas eksekusi (fill, slippage) tidak teruji sama sekali. Yang terbukti hanya bahwa logika sinyal bot dan backtest sama pada 8 candle itu.

Spread terukur: median BTC/IDR 0,0231%, ETH/IDR 0,0839% (60 snapshot). ETH sekitar 3,6 kali lebih lebar dari BTC, jadi asumsi satu half-spread gabungan untuk kedua pair terlalu murah untuk ETH.

## 3. Masalah operasional (jujur)
- **Forward test hanya sekitar 20,5 jam** (13 Nov 14.46 WIB sampai 14 Nov 11.15 WIB, panggilan terakhir di log), bukan 10 hari. Bot baru berjalan 13 Nov, jadi freeze 4 Nov tidak terpenuhi. Hash commit freeze `lib/config.js`: 63beb3e.
- **Panggilan terlaksana di log: 30 dari sekitar 70 terjadwal.** GitHub Actions tiap jam tidak teratur. Cron-job.org (tiap 15 menit sejak 13 Nov 19.30 WIB) mencatat 200 OK, tetapi banyak panggilan itu tidak meninggalkan log.
- **Uptime dari log: 66,7% (8 dari 12 candle pair)**. Namun `state_akhir.json` menunjukkan bot sudah memproses candle sampai barTime 1794614400 (14 Nov 00.00 UTC), sedangkan log "bar" terakhir hanya sampai 1794585600. Artinya dua candle (per pair) sebenarnya diproses tetapi barisnya tidak tersimpan di log. Angka 66,7% adalah angka yang bisa dibuktikan dari log; angka sebenarnya kemungkinan lebih tinggi, tetapi saya tidak mengklaimnya karena tidak bisa dihitung ulang.
- **Dugaan penyebab (belum diuji):** `api/tick.js` menulis log ke Upstash di blok `finally` setelah respons dikirim. Di Vercel serverless, fungsi bisa dihentikan setelah respons selesai, sehingga penulisan log kadang tidak selesai, padahal state (yang disimpan sebelum respons) tersimpan. Pola ini cocok dengan data: state maju, log hilang.
- Error API 0, data tidak valid 0, kill switch 0 kali.

## 4. Pelajaran
1. Log harus ditulis **sebelum** respons dikirim (atau fungsi harus menunggu penulisan selesai). Perbaikan ini tidak mengubah aturan strategi, tetapi tidak dilakukan selama atau setelah forward test agar bukti tetap sesuai bot yang dibekukan.
2. Penjadwal harus diuji lebih awal dan dipantau (jumlah panggilan vs jadwal). GitHub Actions cron tidak bisa diandalkan untuk interval pendek.
3. Fee 0,5% adalah asumsi konservatif; /api/pairs menyebut 0,2% dan halaman bantuan resmi tidak ditemukan.
4. Hasil forward test 20,5 jam dengan 0 trade tidak cukup untuk menilai strategi. Satu-satunya klaim yang didukung data: sinyal bot sama dengan backtest pada 8 candle yang tercatat.
