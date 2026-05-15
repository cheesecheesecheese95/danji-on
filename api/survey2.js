// api/survey2.js — 단지명 설문 투표 & 결과 조회 (Upstash Redis REST)
import { createHash } from 'crypto';

const VALID = ['current', 'seodaemun', 'yeonhui', 'parkview', 'other'];
const LABELS = {
  current: 'DMC파크뷰자이 (현행유지)',
  seodaemun: '서대문파크뷰자이',
  yeonhui: '연희파크뷰자이',
  parkview: '파크뷰자이',
  other: '기타',
};

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

async function getCounts() {
  const raw = await redis('HGETALL', 'survey2:votes');
  const counts = { current:0, seodaemun:0, yeonhui:0, parkview:0, other:0 };
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) counts[raw[i]] = parseInt(raw[i+1]) || 0;
  }
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  return { counts, total };
}

async function getOtherTexts() {
  const raw = await redis('LRANGE', 'survey2:other_texts', 0, 49);
  return raw || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — 현재 집계
  if (req.method === 'GET') {
    try {
      const { counts, total } = await getCounts();
      const otherTexts = await getOtherTexts();
      return res.json({ counts, labels: LABELS, total, otherTexts });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — 투표
  if (req.method === 'POST') {
    const { option, otherText } = req.body || {};
    if (!VALID.includes(option)) {
      return res.status(400).json({ error: '올바르지 않은 선택입니다.' });
    }

    const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress || 'unknown';
    const ipHash = createHash('sha256').update(rawIp).digest('hex').slice(0, 16);
    const ipKey  = `survey2:ip:${ipHash}`;

    const prevVote = await redis('GET', ipKey);
    if (prevVote) {
      const { counts, total } = await getCounts();
      const otherTexts = await getOtherTexts();
      return res.status(409).json({ error: 'already_voted', prevVote, counts, labels: LABELS, total, otherTexts });
    }

    const tasks = [
      redis('HINCRBY', 'survey2:votes', option, 1),
      redis('SET', ipKey, option, 'EX', 60 * 60 * 24 * 365),
    ];
    if (option === 'other' && otherText && otherText.trim().length > 0) {
      tasks.push(redis('LPUSH', 'survey2:other_texts', otherText.trim().slice(0, 50)));
    }
    await Promise.all(tasks);

    const { counts, total } = await getCounts();
    const otherTexts = await getOtherTexts();
    return res.json({ success: true, counts, labels: LABELS, total, otherTexts });
  }

  return res.status(405).end();
}
