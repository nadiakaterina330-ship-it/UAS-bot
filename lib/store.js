// Storage persisten lewat Upstash Redis REST (gratis di Vercel Marketplace). Tanpa dependensi.
async function cmd(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL / _TOKEN belum diset');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`Upstash: ${j.error}`);
  return j.result;
}

export const getJson = async (k) => { const v = await cmd(['GET', k]); return v ? JSON.parse(v) : null; };
export const setJson = (k, o) => cmd(['SET', k, JSON.stringify(o)]);
export const getRaw = (k) => cmd(['GET', k]);
export const setRaw = (k, v) => cmd(['SET', k, v]);
export const acquireLock = async (k, sec = 120) => (await cmd(['SET', k, '1', 'NX', 'EX', String(sec)])) === 'OK';
export const releaseLock = (k) => cmd(['DEL', k]);
export const appendLogs = (k, arr) => (arr.length ? cmd(['RPUSH', k, ...arr.map((o) => JSON.stringify(o))]) : null);
export const readLogs = async (k) => (await cmd(['LRANGE', k, '0', '-1'])).map((s) => JSON.parse(s));
