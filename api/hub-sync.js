// api/hub-sync.js — 부동산 허브 통합 배치
// ?job=news | daily-comment | weekly-insight | all(기본)
// Cron 분리: vercel.json에서 각 job별로 호출
export const config = { maxDuration: 55 };

import { HOME_DANJI, DANJI_MASTER } from '../data/danji-master.js';

const SB_URL     = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY     = process.env.SUPABASE_SERVICE_KEY;
const NAVER_ID   = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

// ═══════════════════════════════════════════════════════════════
// 공통 유틸
// ═══════════════════════════════════════════════════════════════
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

async function saveCache(category, items) {
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
      summary: typeof items === 'object' && !Array.isArray(items) ? 'single' : `${items.length}건`,
      body: JSON.stringify(items),
      is_featured: false,
      view_count: 0,
      status: 'published',
    }]),
  });
}

function strip(html) {
  return (html || '').replace(/<\/?b>/g, '').replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function fmtPrice(wan) {
  return wan >= 10000 ? `${Math.floor(wan/10000)}억${wan%10000?` ${wan%10000}만`:''}` : `${wan}만`;
}

// ═══════════════════════════════════════════════════════════════
// JOB 1: 뉴스/블로그/카페 수집
// ═══════════════════════════════════════════════════════════════
const KEYWORDS = [HOME_DANJI.name, '가재울뉴타운', '서대문구 아파트', 'DMC 부동산'];
const AD_KEYWORDS = /급매|급전세|문의주세요|초특가|매물안내|부동산문의|중개|분양상담|투자상담|떨이|세입자모집/;
const PHONE_RE = /\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const AD_CAFE_NAMES = /부동산|중개|매물|분양|공인/;

function isAdContent(item) {
  const text = `${item.title} ${item.description}`;
  if (PHONE_RE.test(text)) return true;
  if (AD_KEYWORDS.test(text)) return true;
  if (item.cafename && AD_CAFE_NAMES.test(item.cafename)) return true;
  return false;
}

async function naverSearch(type, query, display = 20) {
  const url = `https://openapi.naver.com/v1/search/${type}.json`
    + `?query=${encodeURIComponent(query)}&display=${display}&sort=date`;
  const r = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
    },
  });
  if (!r.ok) return [];
  const data = await r.json();
  return data.items || [];
}

async function runNewsSync() {
  const seen = new Set();
  const results = { news: [], blog: [], cafe: [] };

  for (const kw of KEYWORDS) {
    const [newsItems, blogItems, cafeItems] = await Promise.all([
      naverSearch('news', kw, 20),
      naverSearch('blog', kw, 20),
      naverSearch('cafearticle', kw, 20),
    ]);
    for (const item of newsItems) {
      if (seen.has(item.link)) continue; seen.add(item.link);
      results.news.push({ type:'news', title:strip(item.title), description:strip(item.description), link:item.link, pubDate:item.pubDate, source:item.originallink||item.link });
    }
    for (const item of blogItems) {
      if (seen.has(item.link)) continue; seen.add(item.link);
      results.blog.push({ type:'blog', title:strip(item.title), description:strip(item.description), link:item.link, pubDate:item.postdate, bloggerName:item.bloggername||'' });
    }
    for (const item of cafeItems) {
      if (isAdContent(item)) continue;
      if (seen.has(item.link)) continue; seen.add(item.link);
      results.cafe.push({ type:'cafe', title:strip(item.title), description:strip(item.description), link:item.link, pubDate:item.pubDate||'', cafeName:item.cafename||'' });
    }
  }
  const byDate = (a,b) => (b.pubDate||'').localeCompare(a.pubDate||'');
  results.news.sort(byDate); results.blog.sort(byDate); results.cafe.sort(byDate);

  await Promise.all([
    saveCache('news_feed_news', results.news),
    saveCache('news_feed_blog', results.blog),
    saveCache('news_feed_cafe', results.cafe),
  ]);
  return { news: results.news.length, blog: results.blog.length, cafe: results.cafe.length };
}

// ═══════════════════════════════════════════════════════════════
// JOB 2: 오늘의 한 줄
// ═══════════════════════════════════════════════════════════════
const DAILY_SYSTEM = `당신은 DMC파크뷰자이(4,300세대) 아파트 입주민 커뮤니티 앱의 부동산 데이터 요약 봇입니다.

역할: 매매·전세·월세 실거래 데이터를 종합해 입주민이 한눈에 시장 분위기를 파악할 수 있는 "오늘의 브리핑"을 작성합니다.

규칙:
- 팩트 기반 — 데이터에 있는 수치만 인용
- 매수/매도 추천 금지, 가격 예측 금지
- "~했어요", "~이에요" 부드러운 톤

출력 형식 (JSON만, 마크다운 없이):
{
  "headline": "핵심 한 줄 (30~50자)",
  "bullets": [
    "매매 관련 요약 (가격 변동, 거래량 등)",
    "전세·월세 관련 요약 (매물 유무, 보증금 수준 등)",
    "종합 시장 분위기 한 줄"
  ]
}`;

async function runDailyComment() {
  const [tradeItems, rentItems, neighborTrade] = await Promise.all([
    loadCache('realestate_trade'),
    loadCache('realestate_rent'),
    loadCache('realestate_neighbor_trade'),
  ]);

  const toDateStr = (i) => `${i.dealYear}${i.dealMonth.padStart(2,'0')}${(i.dealDay||'01').padStart(2,'0')}`;
  const parsePrice = (s) => parseInt((s||'0').replace(/,/g,''));
  const today = new Date();
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate()-7);
  const monthAgo = new Date(today); monthAgo.setMonth(today.getMonth()-1);
  const wd = `${weekAgo.getFullYear()}${String(weekAgo.getMonth()+1).padStart(2,'0')}${String(weekAgo.getDate()).padStart(2,'0')}`;
  const md = `${monthAgo.getFullYear()}${String(monthAgo.getMonth()+1).padStart(2,'0')}${String(monthAgo.getDate()).padStart(2,'0')}`;

  // 매매 분석
  const recentTrade = tradeItems.slice(0, 10);
  const weekTrade = tradeItems.filter(i => toDateStr(i) >= wd);
  const monthTrade = tradeItems.filter(i => toDateStr(i) >= md);

  // 면적별 최근 가격
  const byArea = {};
  for (const i of recentTrade) {
    const area = Math.round(parseFloat(i.excluUseAr));
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push({ price: parsePrice(i.dealAmount), date: `${i.dealYear}.${i.dealMonth}.${i.dealDay}`, floor: i.floor });
  }
  const areaStats = Object.entries(byArea).map(([area, items]) => {
    const prices = items.map(x => x.price);
    let change = null;
    if (items.length >= 2) {
      change = ((items[0].price - items[1].price) / items[1].price * 100).toFixed(1);
    }
    return { area: `${area}㎡`, latest: items[0], count: items.length, avg: Math.round(prices.reduce((a,b)=>a+b,0)/prices.length), change };
  });

  // 전세·월세 분석
  const jeonse = rentItems.filter(i => i.type === 'jeonse');
  const monthly = rentItems.filter(i => i.type === 'monthly');
  const weekJeonse = jeonse.filter(i => toDateStr(i) >= wd);
  const weekMonthly = monthly.filter(i => toDateStr(i) >= wd);

  // 이웃 단지 이번 주 거래
  const weekNeighbor = neighborTrade.filter(i => toDateStr(i) >= wd);

  const summary = {
    trade: {
      total6m: tradeItems.length,
      thisWeek: weekTrade.length,
      thisMonth: monthTrade.length,
      byArea: areaStats,
    },
    rent: {
      jeonse: { total6m: jeonse.length, thisWeek: weekJeonse.length, recentDeposit: jeonse.length ? fmtPrice(parsePrice(jeonse[0].deposit)) : '없음' },
      monthly: { total6m: monthly.length, thisWeek: weekMonthly.length },
    },
    neighborThisWeek: weekNeighbor.length,
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'x-api-key':CLAUDE_KEY, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body: JSON.stringify({
      model:'claude-haiku-4-5-20251001', max_tokens:300, system:DAILY_SYSTEM,
      messages:[{ role:'user', content:`DMC파크뷰자이 실거래 종합 데이터:\n${JSON.stringify(summary,null,2)}` }],
    }),
  });
  if (!r.ok) throw new Error(`Claude API: ${await r.text()}`);
  const data = await r.json();
  const text = (data.content?.[0]?.text || '').replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();

  let parsed;
  try { parsed = JSON.parse(text); }
  catch(_) { parsed = { headline: text.slice(0, 60), bullets: [] }; }

  const result = { ...parsed, summary, generatedAt: new Date().toISOString() };
  await saveCache('realestate_daily_comment', result);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// JOB 3: 이번 주 관점
// ═══════════════════════════════════════════════════════════════
const WEEKLY_SYSTEM = `당신은 DMC파크뷰자이(4,300세대) 입주민 커뮤니티 앱의 부동산 분석 봇입니다.
원칙:
1. 양방향 관점 — 긍정 2개 + 신중 2개
2. 단정 금지 — "~일 수 있어요", "다른 관점에서는"
3. 매수/매도 추천 절대 금지, 가격 예측 절대 금지
4. 마지막: "부동산 거래는 전문가 상담을 권장합니다"
5. 팩트 기반

출력(JSON만):
{"title":"15자","summary":"40자","perspectives":[{"direction":"positive","text":"80자"},{"direction":"positive","text":"80자"},{"direction":"cautious","text":"80자"},{"direction":"cautious","text":"80자"}],"context":"100자, 이웃 단지 포함","disclaimer":"부동산 거래는 전문가 상담을 권장합니다"}`;

async function runWeeklyInsight() {
  const [homeTrade, homeRent, neighborTrade, news, blog] = await Promise.all([
    loadCache('realestate_trade'),
    loadCache('realestate_rent'),
    loadCache('realestate_neighbor_trade'),
    loadCache('news_feed_news'),
    loadCache('news_feed_blog'),
  ]);

  const today = new Date();
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate()-7);
  const wd = `${weekAgo.getFullYear()}${String(weekAgo.getMonth()+1).padStart(2,'0')}${String(weekAgo.getDate()).padStart(2,'0')}`;
  const toDateStr = (i) => `${i.dealYear}${i.dealMonth.padStart(2,'0')}${(i.dealDay||'01').padStart(2,'0')}`;
  const parsePrice = (s) => parseInt((s||'0').replace(/,/g,''));

  const weekHomeTrade = homeTrade.filter(i => toDateStr(i) >= wd);
  const homePrices = weekHomeTrade.map(i => parsePrice(i.dealAmount));
  const homeAvg = homePrices.length ? Math.round(homePrices.reduce((a,b)=>a+b,0)/homePrices.length) : 0;

  const byArea = {};
  for (const i of weekHomeTrade) {
    const area = `${Math.round(parseFloat(i.excluUseAr))}㎡`;
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push(parsePrice(i.dealAmount));
  }
  const areaStats = Object.entries(byArea).map(([area,prices]) => ({
    area, count:prices.length, avg:Math.round(prices.reduce((a,b)=>a+b,0)/prices.length),
  }));

  const neighborByDanji = {};
  for (const i of neighborTrade.filter(t => toDateStr(t) >= wd)) {
    const name = i.danjiName || i.aptNm;
    if (!neighborByDanji[name]) neighborByDanji[name] = [];
    neighborByDanji[name].push(parsePrice(i.dealAmount));
  }
  const neighborStats = Object.entries(neighborByDanji).map(([name,prices]) => ({
    name, count:prices.length, avg:Math.round(prices.reduce((a,b)=>a+b,0)/prices.length),
  }));

  const summary = {
    period: `${weekAgo.toISOString().slice(0,10)} ~ ${today.toISOString().slice(0,10)}`,
    home: { name:HOME_DANJI.name, trade:{ count:weekHomeTrade.length, avgPrice:homeAvg, byArea:areaStats }, rent:{ count: homeRent.filter(i=>toDateStr(i)>=wd).length } },
    neighbor: neighborStats,
    news: (news||[]).slice(0,5).map(n=>n.title),
    blog: (blog||[]).slice(0,3).map(b=>b.title),
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'x-api-key':CLAUDE_KEY, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body: JSON.stringify({
      model:'claude-haiku-4-5-20251001', max_tokens:800, system:WEEKLY_SYSTEM,
      messages:[{ role:'user', content:`지난 주간 데이터:\n${JSON.stringify(summary,null,2)}` }],
    }),
  });
  if (!r.ok) throw new Error(`Claude API: ${await r.text()}`);
  const data = await r.json();
  const text = data.content?.[0]?.text || '';
  const cleaned = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  const insight = JSON.parse(cleaned);

  const result = { ...insight, dataSummary:summary, generatedAt:new Date().toISOString() };
  await saveCache('realestate_weekly_insight', result);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// 핸들러
// ═══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 미설정' });

  const job = req.query?.job || 'all';
  const results = {};

  try {
    if (job === 'news' || job === 'all') {
      if (!NAVER_ID || !NAVER_SECRET) return res.status(500).json({ error: 'NAVER 환경변수 미설정' });
      results.news = await runNewsSync();
    }

    if (job === 'daily-comment' || job === 'all') {
      if (!CLAUDE_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정' });
      results.dailyComment = await runDailyComment();
    }

    if (job === 'weekly-insight' || job === 'all') {
      if (!CLAUDE_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정' });
      results.weeklyInsight = await runWeeklyInsight();
    }

    return res.status(200).json({ ok: true, job, ...results, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[hub-sync]', err);
    return res.status(500).json({ error: err.message, job });
  }
}
