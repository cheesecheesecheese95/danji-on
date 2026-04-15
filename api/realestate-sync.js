// 국토부 실거래가 (매매 + 전월세) 수집 → Supabase 캐시 저장
// Cron: 매일 07:00 KST = 22:00 UTC
export const config = { maxDuration: 30 };

const KEY     = process.env.REALESTATE_KEY;
const SB_URL  = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY;
const LAWD_CD = '11410';
const APT_NM  = 'DMC파크뷰자이';

export default async function handler(req, res) {
  if (!KEY)    return res.status(500).json({ error: 'REALESTATE_KEY 없음' });
  if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 없음' });

  try {
    const months6  = getLastMonths(6);
    const months12 = getLastMonths(12);

    // ── 1. 매매 ──────────────────────────────────────────────
    const tradeRaw = [];
    for (const ym of months12) {
      const xml = await govFetch('RTMSDataSvcAptTrade', 'getRTMSDataSvcAptTrade', ym);
      tradeRaw.push(...parseXml(xml, 'trade').filter(i => i.aptNm?.includes(APT_NM)));
    }
    // 동 추정
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

    // ── 2. 전월세 ────────────────────────────────────────────
    const rentItems = [];
    for (const ym of months6) {
      const xml = await govFetch('RTMSDataSvcAptRent', 'getRTMSDataSvcAptRent', ym);
      rentItems.push(...parseXml(xml, 'rent').filter(i => i.aptNm?.includes(APT_NM)));
    }
    rentItems.sort(dateSortDesc);

    // ── 3. Supabase 저장 ────────────────────────────────────
    await saveCache('realestate_trade', tradeItems);
    await saveCache('realestate_rent',  rentItems);

    return res.status(200).json({
      ok: true,
      trade: tradeItems.length,
      rent:  rentItems.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[realestate-sync]', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── 국토부 API 호출 ──────────────────────────────────────────
async function govFetch(svc, method, ym) {
  const url = `https://apis.data.go.kr/1613000/${svc}/${method}` +
    `?serviceKey=${KEY}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=100&pageNo=1`;
  const r = await fetch(url);
  return r.text();
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
