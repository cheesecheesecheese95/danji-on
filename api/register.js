// api/register.js — 입주민 인증 저장 & 조회 (Upstash Redis)
const ADMIN_SECRET = 'parkview2024';

async function redis(...args) {
  const url   = process.env.UPSTASH_REDIS_REST_URL   || process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) throw new Error('Upstash 환경변수 누락');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  return data.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST: 인증 정보 저장 ──────────────────────────────
  if (req.method === 'POST') {
    const { danji, dong, ho, name } = req.body || {};
    if (!danji || !dong || !ho || !name) {
      return res.status(400).json({ error: '필수 항목 누락' });
    }
    const entry = JSON.stringify({
      danji, dong, ho, name,
      ts: new Date().toISOString(),
    });
    await redis('LPUSH', 'residents', entry);
    return res.json({ ok: true });
  }

  // ── GET: 목록 조회 (관리자 전용) ──────────────────────
  if (req.method === 'GET') {
    if (req.query.secret !== ADMIN_SECRET) {
      return res.status(403).json({ error: '권한 없음' });
    }
    const raw = await redis('LRANGE', 'residents', 0, -1);
    const list = (raw || []).map(r => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);
    return res.json({ list });
  }

  return res.status(405).end();
}
