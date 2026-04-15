// 실거래가 조회 — Supabase 캐시 우선, fallback 국토부 직접
// type 파라미터: trade(매매, 기본) | rent(전월세)
export const config = { maxDuration: 25 };

const KEY     = process.env.REALESTATE_KEY;
const SB_URL  = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY;
const LAWD_CD = '11410';
const APT_NM  = 'DMC파크뷰자이';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const type = req.query?.type === 'rent' ? 'rent' : 'trade';
  const category = `realestate_${type}`;

  // ── 1. Supabase 캐시 시도 ──────────────────────────────────
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/wiki_documents?category=eq.${category}&select=body,title&limit=1`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      if (rows.length && rows[0].body) {
        const items = JSON.parse(rows[0].body);
        return res.status(200).json({
          items: items.slice(0, 60),
          total: items.length,
          updatedAt: rows[0].title, // ISO date
          source: 'cache',
        });
      }
    }
  } catch(_) {}

  // ── 2. Fallback: 국토부 직접 호출 ─────────────────────────
  if (!KEY) return res.status(200).json({ error: 'API 키가 설정되지 않았습니다.' });

  try {
    if (type === 'trade') {
      const items = await fetchTrade();
      return res.status(200).json({ items: items.slice(0, 60), total: items.length, source: 'live' });
    } else {
      const items = await fetchRent();
      return res.status(200).json({ items: items.slice(0, 60), total: items.length, source: 'live' });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── 매매 직접 수집 ────────────────────────────────────────────
async function fetchTrade() {
  const months12 = getLastMonths(12);
  const months6  = new Set(getLastMonths(6));
  const allRaw   = [];

  for (const ym of months12) {
    try {
      const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?serviceKey=${KEY}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=100&pageNo=1`;
      const xml = await (await fetch(url)).text();
      allRaw.push(...parseTradeXml(xml).filter(i => i.aptNm?.includes(APT_NM)));
    } catch(_) {}
  }

  const dongMap = {};
  for (const i of allRaw) {
    if (!i.aptDong) continue;
    const k = `${i.aptNm}|${Math.round(parseFloat(i.excluUseAr))}`;
    if (!dongMap[k]) dongMap[k] = new Set();
    dongMap[k].add(i.aptDong);
  }

  return allRaw
    .filter(i => months6.has(`${i.dealYear}${i.dealMonth.padStart(2,'0')}`))
    .map(i => {
      if (!i.aptDong) {
        const k = `${i.aptNm}|${Math.round(parseFloat(i.excluUseAr))}`;
        const s = dongMap[k];
        if (s?.size === 1) { i.aptDong = [...s][0]; i.dongInferred = true; }
      }
      return i;
    })
    .sort(dateSortDesc);
}

// ── 전월세 직접 수집 ─────────────────────────────────────────
async function fetchRent() {
  const months6 = getLastMonths(6);
  const items   = [];
  for (const ym of months6) {
    try {
      const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${KEY}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=100&pageNo=1`;
      const xml = await (await fetch(url)).text();
      items.push(...parseRentXml(xml).filter(i => i.aptNm?.includes(APT_NM)));
    } catch(_) {}
  }
  return items.sort(dateSortDesc);
}

function parseTradeXml(xml) {
  return parseItems(xml, block => {
    const g = tag => getTag(block, tag);
    return {
      type: 'trade',
      aptNm: g('aptNm'), aptDong: g('aptDong'), dongInferred: false,
      dealYear: g('dealYear'), dealMonth: g('dealMonth'), dealDay: g('dealDay'),
      excluUseAr: g('excluUseAr'), floor: g('floor'),
      dealAmount: g('dealAmount'), buildYear: g('buildYear'),
    };
  });
}

function parseRentXml(xml) {
  return parseItems(xml, block => {
    const g = tag => getTag(block, tag);
    const monthlyRent = g('monthlyRent');
    return {
      type: (monthlyRent === '0' || monthlyRent === '') ? 'jeonse' : 'monthly',
      aptNm: g('aptNm'), aptDong: g('aptDong'),
      dealYear: g('dealYear'), dealMonth: g('dealMonth'), dealDay: g('dealDay'),
      excluUseAr: g('excluUseAr'), floor: g('floor'),
      deposit: g('deposit'),
      monthlyRent: g('monthlyRent'),
      buildYear: g('buildYear'),
    };
  });
}

function parseItems(xml, mapper) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) items.push(mapper(m[1]));
  return items;
}

function getTag(block, tag) {
  const r = new RegExp(`<${tag}>([^<]*)<\/${tag}>`);
  const m = r.exec(block);
  return m ? m[1].trim() : '';
}

function dateSortDesc(a, b) {
  const da = `${a.dealYear}${a.dealMonth.padStart(2,'0')}${(a.dealDay||'01').padStart(2,'0')}`;
  const db = `${b.dealYear}${b.dealMonth.padStart(2,'0')}${(b.dealDay||'01').padStart(2,'0')}`;
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
