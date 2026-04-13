// api/track-stats.js — 트래킹 집계 조회
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const url   = process.env.UPSTASH_REDIS_REST_URL   || process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'env missing' });

  async function hgetall(key) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['HGETALL', key]),
    });
    const d = await r.json();
    const raw = d.result || [];
    const obj = {};
    for (let i = 0; i < raw.length; i += 2) obj[raw[i]] = parseInt(raw[i+1]) || 0;
    return obj;
  }

  const today = new Date().toISOString().slice(0, 10);
  const [total, todayData] = await Promise.all([
    hgetall('track:total'),
    hgetall(`track:daily:${today}`),
  ]);

  return res.json({ total, today: todayData });
}
