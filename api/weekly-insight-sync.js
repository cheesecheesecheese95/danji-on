// api/weekly-insight-sync.js — "이번 주 관점" 생성
// 지난 7일 실거래 + 뉴스/블로그/카페 종합 → Claude로 양방향 관점 생성
// Cron: 월요일 06:30 KST = 일요일 21:30 UTC
export const config = { maxDuration: 55 };

import { HOME_DANJI, DANJI_MASTER } from '../data/danji-master.js';

const SB_URL     = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY     = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `당신은 DMC파크뷰자이(4,300세대) 입주민 커뮤니티 앱의 부동산 분석 봇입니다.

역할: 지난 한 주간의 실거래 데이터와 뉴스/블로그/카페 소식을 종합해 "이번 주 동네 관점"을 작성합니다.

반드시 지켜야 할 원칙:
1. 양방향 관점 — 긍정적 해석 2개 + 부정적/신중한 해석 2개를 균형 있게 제시
2. 단정 금지 — "~일 수 있어요", "~로 해석할 수도 있어요", "다른 관점에서는"
3. 매수/매도 추천 절대 금지
4. 가격 예측 절대 금지 ("오를 것", "내릴 것" 등 표현 금지)
5. 마지막에 반드시: "부동산 거래는 전문가 상담을 권장합니다"
6. 팩트 기반 — 데이터에 있는 수치만 인용

출력 형식 (JSON):
{
  "title": "이번 주 동네 관점 제목 (15자 내외)",
  "summary": "핵심 요약 한 문장 (40자 내외)",
  "perspectives": [
    { "direction": "positive", "text": "긍정적 해석 (80자 내외)" },
    { "direction": "positive", "text": "긍정적 해석 (80자 내외)" },
    { "direction": "cautious", "text": "신중한 해석 (80자 내외)" },
    { "direction": "cautious", "text": "신중한 해석 (80자 내외)" }
  ],
  "context": "동네 맥락 보충 설명 (100자 내외, 이웃 단지 동향 포함)",
  "disclaimer": "부동산 거래는 전문가 상담을 권장합니다"
}

JSON만 출력하세요. 마크다운이나 설명 없이.`;

// ── Supabase 읽기/쓰기 ──────────────────────────────────────
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
      summary: '이번 주 관점',
      body: JSON.stringify(content),
      is_featured: false,
      view_count: 0,
      status: 'published',
    }]),
  });
}

// ── 주간 데이터 요약 ────────────────────────────────────────
function buildWeeklySummary(homeTrade, homeRent, neighborTrade, neighborRent, news, blog, cafe) {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const wd = `${weekAgo.getFullYear()}${String(weekAgo.getMonth()+1).padStart(2,'0')}${String(weekAgo.getDate()).padStart(2,'0')}`;

  const toDateStr = (i) => `${i.dealYear}${i.dealMonth.padStart(2,'0')}${(i.dealDay||'01').padStart(2,'0')}`;
  const parsePrice = (s) => parseInt((s || '0').replace(/,/g, ''));

  // 홈 단지 이번 주 거래
  const weekHomeTrade = homeTrade.filter(i => toDateStr(i) >= wd);
  const weekHomeRent  = homeRent.filter(i => toDateStr(i) >= wd);

  // 홈 단지 매매 통계
  const homePrices = weekHomeTrade.map(i => parsePrice(i.dealAmount));
  const homeAvg = homePrices.length ? Math.round(homePrices.reduce((a, b) => a + b, 0) / homePrices.length) : 0;

  // 면적별 분류
  const byArea = {};
  for (const i of weekHomeTrade) {
    const area = `${Math.round(parseFloat(i.excluUseAr))}㎡`;
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push(parsePrice(i.dealAmount));
  }
  const areaStats = Object.entries(byArea).map(([area, prices]) => ({
    area,
    count: prices.length,
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    min: Math.min(...prices),
    max: Math.max(...prices),
  }));

  // 이웃 단지 이번 주 거래 요약
  const neighborByDanji = {};
  for (const i of neighborTrade.filter(t => toDateStr(t) >= wd)) {
    const name = i.danjiName || i.aptNm;
    if (!neighborByDanji[name]) neighborByDanji[name] = [];
    neighborByDanji[name].push(parsePrice(i.dealAmount));
  }
  const neighborStats = Object.entries(neighborByDanji).map(([name, prices]) => ({
    name,
    count: prices.length,
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
  }));

  // 뉴스 헤드라인 (최근 5건)
  const newsHeadlines = (news || []).slice(0, 5).map(n => n.title);
  const blogHeadlines = (blog || []).slice(0, 3).map(b => b.title);

  return {
    period: `${weekAgo.toISOString().slice(0, 10)} ~ ${today.toISOString().slice(0, 10)}`,
    home: {
      name: HOME_DANJI.name,
      trade: { count: weekHomeTrade.length, avgPrice: homeAvg, byArea: areaStats },
      rent: { count: weekHomeRent.length },
    },
    neighbor: neighborStats,
    news: newsHeadlines,
    blog: blogHeadlines,
  };
}

// ── Claude API 호출 ─────────────────────────────────────────
async function generateInsight(summary) {
  const userMsg = `아래는 지난 한 주간의 DMC파크뷰자이 및 이웃 단지 실거래 데이터와 뉴스 요약입니다.
"이번 주 관점"을 JSON 형식으로 작성해주세요.

${JSON.stringify(summary, null, 2)}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Claude API 오류: ${err}`);
  }

  const data = await r.json();
  const text = data.content?.[0]?.text || '';

  // JSON 파싱 (코드블록 감싸기 대응)
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

// ── 핸들러 ──────────────────────────────────────────────────
export default async function handler(req, res) {
  if (!SB_KEY)     return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 미설정' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정' });

  try {
    // 모든 데이터 병렬 로드
    const [homeTrade, homeRent, neighborTrade, neighborRent, news, blog, cafe] =
      await Promise.all([
        loadCache('realestate_trade'),
        loadCache('realestate_rent'),
        loadCache('realestate_neighbor_trade'),
        loadCache('realestate_neighbor_rent'),
        loadCache('news_feed_news'),
        loadCache('news_feed_blog'),
        loadCache('news_feed_cafe'),
      ]);

    // 주간 요약 데이터 생성
    const summary = buildWeeklySummary(
      homeTrade, homeRent, neighborTrade, neighborRent, news, blog, cafe
    );

    // Claude로 관점 생성
    const insight = await generateInsight(summary);

    // 저장
    const result = {
      ...insight,
      dataSummary: summary,
      generatedAt: new Date().toISOString(),
    };
    await saveCache('realestate_weekly_insight', result);

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[weekly-insight-sync]', err);
    return res.status(500).json({ error: err.message });
  }
}
