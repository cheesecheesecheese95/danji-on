// api/daily-comment-sync.js — "오늘의 한 줄" 생성
// 어제 실거래 데이터 변화 기반 20~30자 짧은 코멘트
// Cron: 매일 06:00 KST = 21:00 UTC (전일)
export const config = { maxDuration: 30 };

import { HOME_DANJI, DANJI_MASTER } from '../data/danji-master.js';

const SB_URL  = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `당신은 DMC파크뷰자이(4,300세대) 아파트 입주민 커뮤니티 앱의 부동산 데이터 요약 봇입니다.

역할: 어제 수집된 실거래가 데이터를 보고, 입주민이 한눈에 파악할 수 있는 "오늘의 한 줄"을 작성합니다.

규칙:
- 반드시 20~40자 이내로 작성 (한 문장)
- 팩트 기반: 실제 거래 데이터에서 확인 가능한 내용만
- 매수/매도 추천 금지, 가격 예측 금지
- "~했어요", "~이에요" 같은 부드러운 톤
- 거래가 없으면 "어제는 새로운 거래 등록이 없었어요"
- 예시:
  - "어제 84㎡가 15.2억에 거래됐어요. 직전 대비 +0.3%"
  - "59㎡ 전세가 7.5억에 신규 계약됐어요"
  - "이번 주 3건 거래, 평균 14.8억이에요"
  - "어제는 새로운 거래 등록이 없었어요"`;

// ── Supabase 읽기 ───────────────────────────────────────────
async function loadCache(category) {
  const r = await fetch(
    `${SB_URL}/rest/v1/wiki_documents?category=eq.${category}&select=body,title&limit=1`,
    { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
  );
  if (!r.ok) return [];
  const rows = await r.json();
  if (!rows.length || !rows[0].body) return [];
  return JSON.parse(rows[0].body);
}

// ── Supabase 저장 ───────────────────────────────────────────
async function saveCache(category, content) {
  const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
  await fetch(`${SB_URL}/rest/v1/wiki_documents?category=eq.${category}`, {
    method: 'DELETE', headers,
  });
  await fetch(`${SB_URL}/rest/v1/wiki_documents`, {
    method: 'POST', headers,
    body: JSON.stringify([{
      category,
      title: new Date().toISOString().slice(0, 10),
      summary: '오늘의 한 줄',
      body: JSON.stringify(content),
      is_featured: false,
      view_count: 0,
      status: 'published',
    }]),
  });
}

// ── 최근 거래 데이터 요약 생성 ──────────────────────────────
function buildDataSummary(tradeItems, rentItems) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yd = `${yesterday.getFullYear()}${String(yesterday.getMonth()+1).padStart(2,'0')}${String(yesterday.getDate()).padStart(2,'0')}`;

  // 최근 7일 범위
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const wd = `${weekAgo.getFullYear()}${String(weekAgo.getMonth()+1).padStart(2,'0')}${String(weekAgo.getDate()).padStart(2,'0')}`;

  const toDateStr = (i) => `${i.dealYear}${i.dealMonth.padStart(2,'0')}${(i.dealDay||'01').padStart(2,'0')}`;

  // 홈 단지 거래만 추출
  const homeTrade = tradeItems.filter(i => i.isHome !== false);
  const homeRent  = rentItems.filter(i => i.isHome !== false);

  // 어제 거래
  const yesterdayTrade = homeTrade.filter(i => toDateStr(i) === yd);
  const yesterdayRent  = homeRent.filter(i => toDateStr(i) === yd);

  // 이번 주 거래
  const weekTrade = homeTrade.filter(i => toDateStr(i) >= wd);
  const weekRent  = homeRent.filter(i => toDateStr(i) >= wd);

  // 최근 거래 가격 정보
  const recentTrade = homeTrade.slice(0, 5);
  const priceInfo = recentTrade.map(i => ({
    area: `${Math.round(parseFloat(i.excluUseAr))}㎡`,
    price: i.dealAmount?.trim(),
    date: `${i.dealYear}.${i.dealMonth}.${i.dealDay}`,
    floor: i.floor,
  }));

  // 직전 거래 대비 변화율 (같은 면적 기준)
  let priceChange = null;
  if (recentTrade.length >= 2) {
    const latest = recentTrade[0];
    const latestArea = Math.round(parseFloat(latest.excluUseAr));
    const prev = recentTrade.find((t, idx) =>
      idx > 0 && Math.round(parseFloat(t.excluUseAr)) === latestArea
    );
    if (prev) {
      const p1 = parseInt((latest.dealAmount || '0').replace(/,/g, ''));
      const p2 = parseInt((prev.dealAmount || '0').replace(/,/g, ''));
      if (p2 > 0) {
        priceChange = {
          area: `${latestArea}㎡`,
          current: p1,
          previous: p2,
          pct: ((p1 - p2) / p2 * 100).toFixed(1),
        };
      }
    }
  }

  return {
    yesterday: { trade: yesterdayTrade.length, rent: yesterdayRent.length },
    week: { trade: weekTrade.length, rent: weekRent.length },
    recentPrices: priceInfo,
    priceChange,
    totalTrade: homeTrade.length,
    totalRent: homeRent.length,
  };
}

// ── Claude API 호출 ─────────────────────────────────────────
async function generateComment(summary) {
  const userMsg = `아래는 DMC파크뷰자이의 최근 실거래 데이터 요약입니다. "오늘의 한 줄"을 작성해주세요.

${JSON.stringify(summary, null, 2)}

한 줄 코멘트만 출력하세요. 따옴표나 기타 장식 없이.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Claude API 오류: ${err}`);
  }

  const data = await r.json();
  return data.content?.[0]?.text || '오늘의 실거래 요약을 준비 중이에요';
}

// ── 핸들러 ──────────────────────────────────────────────────
export default async function handler(req, res) {
  if (!SB_KEY)    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 미설정' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정' });

  try {
    // 캐시에서 실거래 데이터 로드
    const [tradeItems, rentItems] = await Promise.all([
      loadCache('realestate_trade'),
      loadCache('realestate_rent'),
    ]);

    // 데이터 요약 생성
    const summary = buildDataSummary(tradeItems, rentItems);

    // Claude로 한 줄 코멘트 생성
    const comment = await generateComment(summary);

    // 저장
    const result = {
      comment,
      summary,
      generatedAt: new Date().toISOString(),
    };
    await saveCache('realestate_daily_comment', result);

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[daily-comment-sync]', err);
    return res.status(500).json({ error: err.message });
  }
}
