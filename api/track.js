// api/track.js — 메뉴·버튼 클릭 이벤트 수집 (Upstash Redis)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { event } = req.body || {};
  if (!event || typeof event !== 'string' || event.length > 60) {
    return res.status(400).json({ error: 'invalid event' });
  }

  const url   = process.env.UPSTASH_REDIS_REST_URL   || process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'env missing' });

  // 전체 카운터 + 오늘 날짜별 카운터
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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
