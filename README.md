# Bot Dry Run Indodax di Vercel

Bot trading simulasi (dry run, tanpa API key) yang membaca candle dan order book Indodax sungguhan. Semua angka dashboard dihitung ulang dari log mentah oleh `scripts/hitung_ulang.js`.

## Struktur
- `lib/` : config, sinyal (dipakai bot dan backtest), klien Indodax, validasi, eksekusi order book, storage
- `api/tick.js` : endpoint bot (dilindungi `CRON_SECRET`); `api/export.js` : ekspor log
- `scripts/` : `fetch_history.js`, `backtest.js`, `export_logs.js`, `hitung_ulang.js`
- `api/dashboard.js` + `lib/metrics.js` : halaman dashboard live (halaman utama situs Vercel)
- `.github/workflows/` : `tick.yml` (penjadwal cadangan), `export.yml` (unduh log mentah), `analisis.yml` (backtest + hitung ulang + simpan hasil ke folder `hasil/`)
- Penjadwal utama: cron-job.org tiap 15 menit ke `/api/tick` dengan header `Authorization: Bearer <CRON_SECRET>`

## Deploy
1. Buat database gratis di Vercel Marketplace (Upstash Redis). Isi `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`.
2. Di Vercel > Settings > Environment Variables: isi `CRON_SECRET` (string acak panjang) dan dua variabel Upstash. Jangan commit `.env`.
3. Push repo ke GitHub (publik) dan import ke Vercel.
4. Di GitHub repo > Settings > Secrets > Actions: isi `CRON_SECRET` dan `TICK_URL` (misal `https://proyekmu.vercel.app`).
5. Uji manual: `curl -H "Authorization: Bearer $CRON_SECRET" https://proyekmu.vercel.app/api/tick`. Pastikan respons `ok: true`.

## Menjalankan analisis
1. Di GitHub: Actions > `analisis` > Run workflow. Workflow menarik data historis 3 tahun, mengunduh log mentah, menjalankan backtest penuh dan backtest jendela forward, menghitung ulang semua angka, lalu menyimpan hasilnya ke folder `hasil/` (`logs_mentah.json`, `metrics.json`, `dashboard.html`) dan `results/`.
2. Secara lokal: `node scripts/hitung_ulang.js` menghasilkan `out/metrics.json` dan `out/dashboard.html` (dashboard offline).
3. Konfigurasi contoh: `.env.example`.

## Definisi
- Uptime: candle yang diproses sebelum candle berikutnya ditutup, dibagi jumlah candle (pair x candle 4 jam) selama forward test.
- Porsi biaya: (fee + spread + slippage) dibagi laba kotor sebelum biaya, dari trade yang sudah selesai.
- Spread per order: qty x (ask - bid) / 2. Slippage per order: qty x |harga fill rata-rata - best bid/ask|.
- Buy and hold BTC/IDR: beli di ask snapshot pertama, nilai di bid snapshot terakhir.

## Freeze
Commit freeze = commit terakhir yang mengubah `lib/config.js`. Hash: **63beb3e**, tanggal 13 Nov 2026 (sore hari WIB, bersamaan dengan awal forward test; jam persis tertera di halaman commit GitHub). Tidak ada force-push dan tidak ada perubahan `lib/config.js` sesudahnya.
## Catatan jujur
- **Forward test dimulai terlambat.** Jadwal soal dimulai 4 Nov 2026, tetapi bot baru berjalan sejak Jumat 13 Nov 2026 sekitar 14.46 WIB dan dievaluasi Sabtu 14 Nov 2026 12.00 WIB. Jadi forward test hanya sekitar 21 jam (bukan 10 hari), dan bukti freeze tanggal 4 Nov tidak ada.
- **Penjadwal tidak teratur di awal.** GitHub Actions (tiap jam) sering telat; sejak 13 Nov 19.30 WIB dipakai cron-job.org tiap 15 menit. Panel operasional dashboard menampilkan panggilan terjadwal vs terlaksana apa adanya. Beberapa panggilan yang dibalas 200 OK oleh cron tidak tercatat di log; penyebabnya dibahas di refleksi.
- Fee taker 0,5% adalah asumsi konservatif. /api/pairs menyebut 0,2%; halaman bantuan resmi tentang biaya tidak ditemukan sampai 12 Nov 2026.
- Batasan: jika dua panggilan bersamaan, panggilan kedua dilewati oleh kunci Redis.
- Pembulatan kuantitas 8 desimal; fill mengikuti level order book.

## Strategi dan jadwal
- Donchian + SMA (UTS v1, N=90, K=30, M=200) pada candle 4 jam; detail di `STRATEGI.md`.
- Candle 4 jam menutup 6 kali sehari; pemanggil (cron-job.org tiap 15 menit, GitHub Actions cadangan tiap jam) dan idempotensi memastikan tiap candle diproses sekali.
- Dalam periode pendek bisa saja tidak ada trade. Bot dengan 0 trade tetap dinilai dari kecocokan log sinyal dengan backtest.
