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
  const news = [];

  for (const kw of KEYWORDS) {
    const items = await naverSearch('news', kw, 10);
    for (const item of items) {
      if (seen.has(item.link)) continue; seen.add(item.link);
      news.push({ type:'news', title:strip(item.title), description:strip(item.description), link:item.link, pubDate:item.pubDate, source:item.originallink||item.link });
    }
  }
  news.sort((a,b) => new Date(b.pubDate||0).getTime() - new Date(a.pubDate||0).getTime());
  // 중복 제목 제거 후 최대 30건
  const titleSeen = new Set();
  const deduped = news.filter(n => { const k=n.title.replace(/\s+/g,'').slice(0,30); if(titleSeen.has(k)) return false; titleSeen.add(k); return true; }).slice(0, 30);

  await saveCache('news_feed_news', deduped);

  // 뉴스 요약 생성 (Claude)
  let summary = null;
  if (CLAUDE_KEY && deduped.length) {
    try { summary = await generateNewsSummary(deduped); } catch(_) {}
  }

  return { news: deduped.length, summary };
}

// ── 뉴스 요약 생성 ──────────────────────────────────────────
const NEWS_SUMMARY_SYSTEM = `당신은 DMC파크뷰자이 입주민 앱의 뉴스 요약 봇입니다.

오늘의 부동산 뉴스 헤드라인을 보고 입주민에게 유용한 3~4줄 요약을 작성합니다.

규칙:
- 서대문구/은평구/DMC/가재울 관련 뉴스를 우선 언급
- 서울 전체 부동산 동향도 포함
- 매수/매도 추천 금지
- "~이에요", "~했어요" 부드러운 톤
- 각 줄은 한 문장, 50자 이내

출력 형식 (JSON만):
{
  "title": "오늘의 뉴스 요약 제목 (15자 내외)",
  "lines": ["요약 1줄", "요약 2줄", "요약 3줄"]
}`;

async function generateNewsSummary(newsItems) {
  const headlines = newsItems.slice(0, 15).map(n => n.title).join('\n');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'x-api-key':CLAUDE_KEY, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body: JSON.stringify({
      model:'claude-haiku-4-5-20251001', max_tokens:300, system:NEWS_SUMMARY_SYSTEM,
      messages:[{ role:'user', content:`오늘의 부동산 뉴스 헤드라인:\n${headlines}` }],
    }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const text = (data.content?.[0]?.text || '').replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  let parsed;
  try { parsed = JSON.parse(text); } catch(_) { return null; }
  const result = { ...parsed, generatedAt: new Date().toISOString() };
  await saveCache('news_summary', result);
  return result;
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
- 가격 하락 시 "하락세" 대신 "일시 하락" 표현 사용
- 전세·월세 bullet은 "현재 전세·월세 매물이 없어요" 한 문장만. "N개월", "0건", "거래 없어", "수급", "타이트" 등 부연 금지
- 가격은 데이터에 이미 억 단위로 변환되어 있으니 그대로 사용하세요

출력 형식 (JSON만, 마크다운 없이):
{
  "headline": "핵심 한 줄 (30~50자, 전월세 상황 포함)",
  "bullets": [
    "매매 관련 요약 (최근 거래가, 변동 등)",
    "전세·월세 관련 요약 (거래 유무, 보증금 수준, 없으면 없다고 명시)",
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

  // 만원→억 변환 헬퍼
  const toEok = (wan) => {
    if (wan >= 10000) {
      const eok = Math.floor(wan / 10000);
      const remain = wan % 10000;
      return remain ? `${eok}억 ${remain}만원` : `${eok}억`;
    }
    return `${wan}만원`;
  };

  // 면적별 최근 가격 (억 단위로 변환해서 전달)
  const byArea = {};
  for (const i of recentTrade) {
    const area = Math.round(parseFloat(i.excluUseAr));
    if (!byArea[area]) byArea[area] = [];
    const priceWan = parsePrice(i.dealAmount);
    byArea[area].push({ price: toEok(priceWan), priceRaw: priceWan, date: `${i.dealYear}.${i.dealMonth}.${i.dealDay}`, floor: i.floor });
  }
  const areaStats = Object.entries(byArea).map(([area, items]) => {
    const raws = items.map(x => x.priceRaw);
    let change = null;
    if (items.length >= 2) {
      change = ((items[0].priceRaw - items[1].priceRaw) / items[1].priceRaw * 100).toFixed(1);
    }
    const avgRaw = Math.round(raws.reduce((a,b)=>a+b,0)/raws.length);
    return { area: `${area}㎡`, latest: { price: items[0].price, date: items[0].date, floor: items[0].floor }, count: items.length, avg: toEok(avgRaw), change };
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
  try {
    parsed = JSON.parse(text);
    // 이중 래핑 방지: headline이 JSON 문자열이면 다시 파싱
    if (typeof parsed.headline === 'string' && parsed.headline.startsWith('{')) {
      try { parsed = JSON.parse(parsed.headline); } catch(_) {}
    }
  } catch(_) {
    parsed = { headline: text.slice(0, 60), bullets: [] };
  }

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
// JOB 4: 호갱노노 데이터 수집
// ═══════════════════════════════════════════════════════════════
const HGNN_BASE = 'https://hogangnono.com/api/v2/apts';
const HGNN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

async function hgnnFetch(path) {
  const r = await fetch(`${HGNN_BASE}${path}`, {
    headers: { 'User-Agent': HGNN_UA, 'Accept': 'application/json' },
  });
  if (!r.ok) return null;
  const json = await r.json();
  return json.data ?? json;  // 호갱노노 API는 { data: ... } 래핑
}

async function runHogangnono() {
  const results = [];

  for (const danji of DANJI_MASTER) {
    if (!danji.hgnnId) continue;
    const id = danji.hgnnId;

    // 순차 호출 (rate limit 방지, 단지당 3 API)
    const [items, visitor, roomTypes] = await Promise.all([
      hgnnFetch(`/${id}/items`),
      hgnnFetch(`/${id}/visitor`),
      hgnnFetch(`/${id}/room-types`),
    ]);

    // 매물 수 + 상세 (items API: tradeType 0=매매, 1=전세, 2=월세)
    const aptItems = items?.aptItems || [];
    const tradeItems = aptItems.filter(i => i.tradeType === 0);
    const depositItems = aptItems.filter(i => i.tradeType === 1);
    const rentItems = aptItems.filter(i => i.tradeType === 2);
    const listings = {
      trade: tradeItems.length,
      deposit: depositItems.length,
      rent: rentItems.length,
      total: aptItems.length,
      items: aptItems.slice(0, 10).map(i => ({
        tradeType: i.tradeType, // 0=매매, 1=전세, 2=월세
        deposit: i.deposit,     // 매매가 or 보증금 (만원)
        rent: i.rent,           // 월세 (만원, 0이면 매매/전세)
        floor: i.floor,
        sizeM2: i.sizeM2,       // 전용면적
        sizeContractM2: i.sizeContractM2, // 계약면적
        roomType: i.danjiRoomType,
        dong: i.areaBuildingName,
        description: i.description,
        updatedAt: i.effectivenessUpdatedAt,
      })),
    };

    // 매물 비율
    const listingRate = listings
      ? ((listings.total / danji.sedaeCount) * 100).toFixed(2)
      : null;

    // 관심도 (최근 7일 평균 조회수)
    let avgVisitors = null;
    const visitorList = visitor?.list || (Array.isArray(visitor) ? visitor : []);
    if (visitorList.length) {
      const recent7 = visitorList.slice(-7);
      avgVisitors = Math.round(recent7.reduce((a, v) => a + (v.total || v.count || 0), 0) / recent7.length);
    }

    // 평형 타입
    const rtList = roomTypes?.zigbangRoomTypes || (Array.isArray(roomTypes) ? roomTypes : []);
    const areas = rtList.map(rt => rt.zigbangRoomType || rt.roomTypeCode || '').filter(Boolean);

    results.push({
      danjiId: danji.id,
      danjiName: danji.name,
      hgnnId: id,
      sedaeCount: danji.sedaeCount,
      isHome: danji.isHome,
      listings,
      listingRate,
      avgVisitors,
      areas,
      hgnnUrl: `https://hogangnono.com/apt/${id}`,
    });

    // rate limit: 단지 간 300ms 대기
    await new Promise(r => setTimeout(r, 300));
  }

  await saveCache('hogangnono_data', { items: results, updatedAt: new Date().toISOString() });
  return { count: results.length, items: results };
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

    if (job === 'hogangnono' || job === 'all') {
      results.hogangnono = await runHogangnono();
    }

    return res.status(200).json({ ok: true, job, ...results, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[hub-sync]', err);
    return res.status(500).json({ error: err.message, job });
  }
}
