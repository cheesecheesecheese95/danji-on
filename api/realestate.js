// Vercel 서버리스 함수 — 국토부 아파트 실거래가 조회
// DMC파크뷰자이 (서대문구 11410) — 동 추정 포함
export const config = { maxDuration: 25 };

const KEY = process.env.REALESTATE_KEY;
const LAWD_CD = '11410';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
  if (!KEY) return res.status(200).json({ error: 'API 키가 설정되지 않았습니다.' });

  // 12개월치 조회 → 동 매핑 구축 + 최근 6개월 표시
  const months12 = getLastMonths(12);
  const months6 = new Set(getLastMonths(6));
  const allRaw = [];

  for (const ym of months12) {
    try {
      const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?serviceKey=${KEY}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=100&pageNo=1`;
      const r = await fetch(url);
      const xml = await r.text();
      const items = parseXmlItems(xml).filter(i => i.aptNm && i.aptNm.includes('DMC파크뷰자이'));
      allRaw.push(...items);
    } catch(e) {}
  }

  // 동 매핑 구축: key = "aptNm|roundedArea" → Set of aptDong
  const dongMap = {};
  for (const i of allRaw) {
    if (!i.aptDong) continue;
    const key = `${i.aptNm}|${Math.round(parseFloat(i.excluUseAr))}`;
    if (!dongMap[key]) dongMap[key] = new Set();
    dongMap[key].add(i.aptDong);
  }

  // 최근 6개월 항목 필터 + 동 추정 적용
  const display = allRaw.filter(i => months6.has(`${i.dealYear}${i.dealMonth.padStart(2,'0')}`));
  for (const i of display) {
    if (!i.aptDong) {
      const key = `${i.aptNm}|${Math.round(parseFloat(i.excluUseAr))}`;
      const set = dongMap[key];
      if (set && set.size === 1) {
        i.aptDong = [...set][0];
        i.dongInferred = true;
      }
    }
  }

  display.sort((a, b) => {
    const da = `${a.dealYear}${a.dealMonth.padStart(2,'0')}${a.dealDay.padStart(2,'0')}`;
    const db = `${b.dealYear}${b.dealMonth.padStart(2,'0')}${b.dealDay.padStart(2,'0')}`;
    return db.localeCompare(da);
  });

  return res.status(200).json({ items: display.slice(0, 60), total: display.length });
}

function parseXmlItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => { const r = new RegExp(`<${tag}>([^<]*)<\/${tag}>`); const mm = r.exec(block); return mm ? mm[1].trim() : ''; };
    items.push({
      aptNm: get('aptNm'), aptDong: get('aptDong'), dongInferred: false,
      dealYear: get('dealYear'), dealMonth: get('dealMonth'), dealDay: get('dealDay'),
      excluUseAr: get('excluUseAr'), floor: get('floor'),
      dealAmount: get('dealAmount'), buildYear: get('buildYear'),
    });
  }
  return items;
}

function getLastMonths(n) {
  const months = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${year}${month}`);
    d.setMonth(d.getMonth() - 1);
  }
  return months;
}
