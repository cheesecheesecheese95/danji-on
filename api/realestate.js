// Vercel 서버리스 함수 — 국토부 아파트 실거래가 조회
// DMC파크뷰자이 1~5단지 (서대문구 11410)
export const config = { maxDuration: 20 };

const KEY = process.env.REALESTATE_KEY;
const LAWD_CD = '11410';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  if (!KEY) return res.status(200).json({ error: 'API 키가 설정되지 않았습니다.' });

  const months = getLastMonths(6);
  const allItems = [];

  for (const ym of months) {
    try {
      const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?serviceKey=${KEY}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=100&pageNo=1`;
      const r = await fetch(url);
      const xml = await r.text();
      const items = parseXmlItems(xml);
      const filtered = items.filter(i => i.aptNm && i.aptNm.includes('DMC파크뷰자이'));
      allItems.push(...filtered);
    } catch (e) {
      console.error(`[realestate] ${ym} 실패:`, e.message);
    }
  }

  allItems.sort((a, b) => {
    const da = `${a.dealYear}${String(a.dealMonth).padStart(2,'0')}${String(a.dealDay).padStart(2,'0')}`;
    const db = `${b.dealYear}${String(b.dealMonth).padStart(2,'0')}${String(b.dealDay).padStart(2,'0')}`;
    return db.localeCompare(da);
  });

  return res.status(200).json({ items: allItems.slice(0, 60), total: allItems.length });
}

function parseXmlItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}>([^<]*)<\/${tag}>`);
      const mm = r.exec(block);
      return mm ? mm[1].trim() : '';
    };
    items.push({
      aptNm: get('aptNm'),
      aptDong: get('aptDong'),
      dealYear: get('dealYear'),
      dealMonth: get('dealMonth'),
      dealDay: get('dealDay'),
      excluUseAr: get('excluUseAr'),
      floor: get('floor'),
      dealAmount: get('dealAmount'),
      buildYear: get('buildYear'),
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
