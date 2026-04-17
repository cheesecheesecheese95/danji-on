// 국토부 실거래가 (매매 + 전월세) 수집 → Supabase 캐시 저장
// 대상: DMC파크뷰자이(홈) + 이웃 단지 7개
// Cron: 매일 07:00 KST = 22:00 UTC
export const config = { maxDuration: 55 };

import { DANJI_MASTER, LAWD_CODES, findDanji } from '../data/danji-master.js';

const KEY     = process.env.REALESTATE_KEY;
const SB_URL  = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (!KEY)    return res.status(500).json({ error: 'REALESTATE_KEY 없음' });
  if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 없음' });

  try {
    const months6  = getLastMonths(6);
    const months12 = getLastMonths(12);

    // ── 1. 매매 — 시군구별 × 월별 수집 ──────────────────────
    const tradeRaw = [];
    for (const lawdCd of LAWD_CODES) {
      for (const ym of months12) {
        const xml = await govFetch('RTMSDataSvcAptTrade', 'getRTMSDataSvcAptTrade', lawdCd, ym);
        tradeRaw.push(...tagDanji(parseXml(xml, 'trade')));
      }
    }

    // 동 추정 (12개월 데이터로 학습 → 6개월 데이터에 적용)
    const dongMap = {};
    for (const i of tradeRaw) {
      if (!i.aptDong) continue;
      const k = `${i.aptNm}|${Math.round(parseFloat(i.excluUseAr))}`;
      if (!dongMap[k]) dongMap[k] = new Set();
      dongMap[k].add(i.aptDong);
    }
    const tradeItems = tradeRaw
      .filter(i => months6.includes(`${i.dealYear}${i.dealMonth.padStart(2,'0')}`))
      .map(i => {
        if (!i.aptDong) {
          const k = `${i.aptNm}|${Math.round(parseFloat(i.excluUseAr))}`;
          const s = dongMap[k];
          if (s?.size === 1) { i.aptDong = [...s][0]; i.dongInferred = true; }
        }
        return i;
      })
      .sort(dateSortDesc);

    // ── 2. 전월세 — 시군구별 × 월별 수집 ────────────────────
    const rentItems = [];
    for (const lawdCd of LAWD_CODES) {
      for (const ym of months6) {
        const xml = await govFetch('RTMSDataSvcAptRent', 'getRTMSDataSvcAptRent', lawdCd, ym);
        rentItems.push(...tagDanji(parseXml(xml, 'rent')));
      }
    }
    rentItems.sort(dateSortDesc);

    // ── 3. 홈/이웃 분리 후 Supabase 저장 ────────────────────
    const homeTrade    = tradeItems.filter(i => i.isHome);
    const homeRent     = rentItems.filter(i => i.isHome);
    const neighborTrade = tradeItems.filter(i => !i.isHome);
    const neighborRent  = rentItems.filter(i => !i.isHome);

    await Promise.all([
      saveCache('realestate_trade', homeTrade),
      saveCache('realestate_rent',  homeRent),
      saveCache('realestate_neighbor_trade', neighborTrade),
      saveCache('realestate_neighbor_rent',  neighborRent),
    ]);

    return res.status(200).json({
      ok: true,
      home:     { trade: homeTrade.length, rent: homeRent.length },
      neighbor: { trade: neighborTrade.length, rent: neighborRent.length },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[realestate-sync]', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── 국토부 API 호출 ──────────────────────────────────────────
async function govFetch(svc, method, lawdCd, ym) {
  const url = `https://apis.data.go.kr/1613000/${svc}/${method}` +
    `?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&numOfRows=500&pageNo=1`;
  const r = await fetch(url);
  return r.text();
}

// ── 마스터 매칭 + 태깅 ──────────────────────────────────────
function tagDanji(items) {
  return items.filter(i => {
    const d = findDanji(i.aptNm);
    if (!d) return false;
    i.danjiId = d.id;
    i.danjiName = d.name;
    i.isHome = d.isHome;
    return true;
  });
}

// ── XML 파싱 ─────────────────────────────────────────────────
function parseXml(xml, type) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => { const r = new RegExp(`<${tag}>([^<]*)<\/${tag}>`); const mm = r.exec(block); return mm ? mm[1].trim() : ''; };
    if (type === 'trade') {
      items.push({
        type: 'trade',
        aptNm: get('aptNm'), aptDong: get('aptDong'), dongInferred: false,
        dealYear: get('dealYear'), dealMonth: get('dealMonth'), dealDay: get('dealDay'),
        excluUseAr: get('excluUseAr'), floor: get('floor'),
        dealAmount: get('dealAmount'), buildYear: get('buildYear'),
      });
    } else {
      const monthlyRent = get('monthlyRent');
      items.push({
        type: monthlyRent === '0' || monthlyRent === '' ? 'jeonse' : 'monthly',
        aptNm: get('aptNm'), aptDong: get('aptDong'),
        dealYear: get('dealYear'), dealMonth: get('dealMonth'), dealDay: get('dealDay'),
        excluUseAr: get('excluUseAr'), floor: get('floor'),
        deposit: get('deposit'),       // 보증금 (전세금 or 월세보증금)
        monthlyRent: get('monthlyRent'), // 월세 (0이면 전세)
        buildYear: get('buildYear'),
      });
    }
  }
  return items;
}

// ── Supabase 저장 (wiki_documents 재활용) ──────────────────────
async function saveCache(category, items) {
  const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
  // 기존 삭제
  await fetch(`${SB_URL}/rest/v1/wiki_documents?category=eq.${category}`, {
    method: 'DELETE', headers,
  });
  // 청크 저장 (body 1개에 전체 JSON)
  await fetch(`${SB_URL}/rest/v1/wiki_documents`, {
    method: 'POST', headers,
    body: JSON.stringify([{
      category,
      title: new Date().toISOString().slice(0, 10),
      summary: `${items.length}건`,
      body: JSON.stringify(items),
      is_featured: false,
      view_count: 0,
      status: 'published',
    }]),
  });
}

function dateSortDesc(a, b) {
  const da = `${a.dealYear}${a.dealMonth.padStart(2,'0')}${a.dealDay.padStart(2,'0')}`;
  const db = `${b.dealYear}${b.dealMonth.padStart(2,'0')}${b.dealDay.padStart(2,'0')}`;
  return db.localeCompare(da);
}

function getLastMonths(n) {
  const months = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    months.push(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`);
    d.setMonth(d.getMonth()-1);
  }
  return months;
}
