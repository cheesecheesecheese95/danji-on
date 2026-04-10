// Vercel 서버리스 함수 — 국토부 아파트 실거래가 조회
// 서대문구 DMC파크뷰자이 최근 6개월 매매 데이터

export const config = { maxDuration: 20 };

const KEY = process.env.REALESTATE_KEY;
const LAWD_CD = '11440'; // 마포구 (상암 DMC)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  if (!KEY) {
    return res.status(200).json({ error: 'API 키가 설정되지 않았습니다. Vercel 환경변수 REALESTATE_KEY를 설정해주세요.' });
  }

  const raw = req.query.raw === '1'; // ?raw=1 이면 필터 없이 전체 반환 (디버그용)
  const months = getLastMonths(6);
  const allItems = [];

  for (const ym of months) {
    try {
      const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${KEY}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=100&pageNo=1&type=json`;
      const r = await fetch(url);
      const d = await r.json();
      const items = d?.response?.body?.items?.item || [];
      const arr = Array.isArray(items) ? items : (items ? [items] : []);
      if (raw) {
        allItems.push(...arr);
      } else {
        const filtered = arr.filter(i =>
          i.aptNm && (i.aptNm.includes('파크뷰자이') || i.aptNm.includes('DMC파크뷰'))
        );
        allItems.push(...filtered);
      }
    } catch (e) {
      console.error(`[realestate] ${ym} 조회 실패:`, e.message);
    }
  }

  // 날짜 정렬 (최신순)
  allItems.sort((a, b) => {
    const da = `${a.dealYear}${String(a.dealMonth).padStart(2,'0')}${String(a.dealDay).padStart(2,'0')}`;
    const db = `${b.dealYear}${String(b.dealMonth).padStart(2,'0')}${String(b.dealDay).padStart(2,'0')}`;
    return db.localeCompare(da);
  });

  return res.status(200).json({ items: allItems.slice(0, 100), total: allItems.length });
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
