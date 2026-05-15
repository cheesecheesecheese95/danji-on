// api/survey.js — 설문 통합 API (Upstash Redis REST)
// ?type=name → 단지명 설문 / 기본 → 서비스 유용도 설문
import { createHash } from 'crypto';

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

function getIpHash(req) {
  const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
  return createHash('sha256').update(rawIp).digest('hex').slice(0, 16);
}

async function hgetallCounts(key, defaults) {
  const raw = await redis('HGETALL', key);
  const counts = { ...defaults };
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) counts[raw[i]] = parseInt(raw[i+1]) || 0;
  }
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  return { counts, total };
}

// ── 서비스 유용도 설문 ──
const S1_VALID = ['very_needed', 'needed', 'unsure', 'not_needed'];
const S1_LABELS = { very_needed:'매우 필요하다', needed:'필요하다', unsure:'아직 모르겠다', not_needed:'필요하지 않다' };

async function handleS1(req, res) {
  if (req.method === 'GET') {
    const { counts, total } = await hgetallCounts('survey:votes', { very_needed:0, needed:0, unsure:0, not_needed:0 });
    return res.json({ counts, labels: S1_LABELS, total });
  }
  const { option } = req.body || {};
  if (!S1_VALID.includes(option)) return res.status(400).json({ error: '올바르지 않은 선택입니다.' });

  const ipKey = `survey:ip:${getIpHash(req)}`;
  const prevVote = await redis('GET', ipKey);
  if (prevVote) {
    const { counts, total } = await hgetallCounts('survey:votes', { very_needed:0, needed:0, unsure:0, not_needed:0 });
    return res.status(409).json({ error: 'already_voted', prevVote, counts, labels: S1_LABELS, total });
  }
  await Promise.all([
    redis('HINCRBY', 'survey:votes', option, 1),
    redis('SET', ipKey, option, 'EX', 60*60*24*365),
  ]);
  const { counts, total } = await hgetallCounts('survey:votes', { very_needed:0, needed:0, unsure:0, not_needed:0 });
  return res.json({ success: true, counts, labels: S1_LABELS, total });
}

// ── 단지명 설문 ──
const S2_VALID = ['current', 'seodaemun', 'yeonhui', 'parkview', 'other'];
const S2_LABELS = { current:'DMC파크뷰자이 (현행유지)', seodaemun:'서대문파크뷰자이', yeonhui:'연희파크뷰자이', parkview:'파크뷰자이', other:'기타' };

async function handleS2(req, res) {
  if (req.method === 'GET') {
    const { counts, total } = await hgetallCounts('survey2:votes', { current:0, seodaemun:0, yeonhui:0, parkview:0, other:0 });
    const otherTexts = (await redis('LRANGE', 'survey2:other_texts', 0, 49)) || [];
    return res.json({ counts, labels: S2_LABELS, total, otherTexts });
  }
  const { option, otherText } = req.body || {};
  if (!S2_VALID.includes(option)) return res.status(400).json({ error: '올바르지 않은 선택입니다.' });

  const ipKey = `survey2:ip:${getIpHash(req)}`;
  const prevVote = await redis('GET', ipKey);
  if (prevVote) {
    const { counts, total } = await hgetallCounts('survey2:votes', { current:0, seodaemun:0, yeonhui:0, parkview:0, other:0 });
    const otherTexts = (await redis('LRANGE', 'survey2:other_texts', 0, 49)) || [];
    return res.status(409).json({ error: 'already_voted', prevVote, counts, labels: S2_LABELS, total, otherTexts });
  }

  const tasks = [
    redis('HINCRBY', 'survey2:votes', option, 1),
    redis('SET', ipKey, option, 'EX', 60*60*24*365),
  ];
  if (option === 'other' && otherText && otherText.trim().length > 0) {
    tasks.push(redis('LPUSH', 'survey2:other_texts', otherText.trim().slice(0, 50)));
  }
  await Promise.all(tasks);
  const { counts, total } = await hgetallCounts('survey2:votes', { current:0, seodaemun:0, yeonhui:0, parkview:0, other:0 });
  const otherTexts = (await redis('LRANGE', 'survey2:other_texts', 0, 49)) || [];
  return res.json({ success: true, counts, labels: S2_LABELS, total, otherTexts });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const type = req.query?.type;
    if (type === 'name') return await handleS2(req, res);
    return await handleS1(req, res);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
