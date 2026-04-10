// Vercel 서버리스 함수 — 국토부 아파트 실거래가 조회 (디버그 버전)
export const config = { maxDuration: 20 };

const KEY = process.env.REALESTATE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!KEY) {
    return res.status(200).json({ error: 'API 키 없음' });
  }

  // 디버그: LAWD_CD와 월을 파라미터로 받아 raw 응답 반환
  const lawd = req.query.lawd || '11440';
  const ym = req.query.ym || '202503';
  const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${KEY}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=10&pageNo=1&type=json`;

  try {
    const r = await fetch(url);
    const text = await r.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch(e) { parsed = text; }
    return res.status(200).json({ lawd, ym, url: url.replace(KEY, 'KEY_HIDDEN'), response: parsed });
  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
