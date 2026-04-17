// api/track.js — 메뉴·버튼 클릭 이벤트 수집 + 집계 조회
// POST: 이벤트 수집 / GET: 집계 조회 (?mode=stats)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url   = process.env.UPSTASH_REDIS_REST_URL   || process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'env missing' });

  const today = new Date().toISOString().slice(0, 10);

  // ── GET: 집계 조회 ────────────────────────────────────────
  if (req.method === 'GET') {
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
    const [total, todayData] = await Promise.all([
      hgetall('track:total'),
      hgetall(`track:daily:${today}`),
    ]);
    return res.json({ total, today: todayData });
  }

  // ── POST: 이벤트 수집 ─────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).end();

  const { event } = req.body || {};
  if (!event || typeof event !== 'string' || event.length > 60) {
    return res.status(400).json({ error: 'invalid event' });
  }

  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['HINCRBY', 'track:total', event, 1]),
  });
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['HINCRBY', `track:daily:${today}`, event, 1]),
  });

  return res.json({ ok: true });
}
