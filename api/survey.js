// api/survey.js — 설문 투표 & 결과 조회 (Upstash Redis REST)
import { createHash } from 'crypto';

const VALID = ['very_needed', 'needed', 'unsure', 'not_needed'];
const LABELS = { very_needed:'매우 필요하다', needed:'필요하다', unsure:'아직 모르겠다', not_needed:'필요하지 않다' };

async function redis(...args) {
  const url   = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  return data.result;
}

async function getCounts() {
  const raw = await redis('HGETALL', 'survey:votes');
  const counts = { very_needed:0, needed:0, unsure:0, not_needed:0 };
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) counts[raw[i]] = parseInt(raw[i+1]) || 0;
  }
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  return { counts, total };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — 현재 집계
  if (req.method === 'GET') {
    const { counts, total } = await getCounts();
    return res.json({ counts, labels: LABELS, total });
  }

  // POST — 투표
  if (req.method === 'POST') {
    const { option } = req.body || {};
    if (!VALID.includes(option)) {
      return res.status(400).json({ error: '올바르지 않은 선택입니다.' });
    }

    const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress || 'unknown';
    const ipHash = createHash('sha256').update(rawIp).digest('hex').slice(0, 16);
    const ipKey  = `survey:ip:${ipHash}`;

    const prevVote = await redis('GET', ipKey);
    if (prevVote) {
      const { counts, total } = await getCounts();
      return res.status(409).json({ error: 'already_voted', prevVote, counts, labels: LABELS, total });
    }

    await Promise.all([
      redis('HINCRBY', 'survey:votes', option, 1),
      redis('SET', ipKey, option, 'EX', 60 * 60 * 24 * 365),
    ]);

    const { counts, total } = await getCounts();
    return res.json({ success: true, counts, labels: LABELS, total });
  }

  return res.status(405).end();
}
