// Ekspor log mentah (dilindungi CRON_SECRET). Dipakai scripts/export_logs.js.
import { readLogs, getJson } from '../lib/store.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.status(200).json({ logs: await readLogs('uas:log'), state: await getJson('uas:state') });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
