// api/survey.js — 설문 투표 & 결과 조회
import { kv } from '@vercel/kv';

const VALID_OPTIONS = ['very_needed', 'needed', 'unsure', 'not_needed'];
const LABELS = {
  very_needed: '매우 필요하다',
  needed: '필요하다',
  unsure: '아직 모르겠다',
  not_needed: '필요하지 않다',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — 현재 집계 반환
  if (req.method === 'GET') {
    const raw = await kv.hgetall('survey:votes') || {};
    const counts = {};
    for (const opt of VALID_OPTIONS) counts[opt] = parseInt(raw[opt] || 0);
    const total = Object.values(counts).reduce((s, v) => s + v, 0);
    return res.json({ counts, labels: LABELS, total });
  }

  // POST — 투표
  if (req.method === 'POST') {
    const { option } = req.body || {};
    if (!VALID_OPTIONS.includes(option)) {
      return res.status(400).json({ error: '올바르지 않은 선택입니다.' });
    }

    // IP 추출 (Vercel 프록시 환경)
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress
      || 'unknown';

    const ipKey = `survey:ip:${ip}`;
    const prevVote = await kv.get(ipKey);
    if (prevVote) {
      const raw = await kv.hgetall('survey:votes') || {};
      const counts = {};
      for (const opt of VALID_OPTIONS) counts[opt] = parseInt(raw[opt] || 0);
      const total = Object.values(counts).reduce((s, v) => s + v, 0);
      return res.status(409).json({ error: 'already_voted', prevVote, counts, labels: LABELS, total });
    }

    // 투표 기록 (IP는 1년 보관)
    await Promise.all([
      kv.hincrby('survey:votes', option, 1),
      kv.set(ipKey, option, { ex: 60 * 60 * 24 * 365 }),
    ]);

    const raw = await kv.hgetall('survey:votes') || {};
    const counts = {};
    for (const opt of VALID_OPTIONS) counts[opt] = parseInt(raw[opt] || 0);
    const total = Object.values(counts).reduce((s, v) => s + v, 0);
    return res.json({ success: true, counts, labels: LABELS, total });
  }

  return res.status(405).end();
}
