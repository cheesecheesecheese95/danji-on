export const config = { maxDuration: 20 };
const KEY = process.env.REALESTATE_KEY;
const LAWD_CD = '11410';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!KEY) return res.status(200).json({ error: 'no key' });

  const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?serviceKey=${KEY}&LAWD_CD=${LAWD_CD}&DEAL_YMD=202503&numOfRows=3&pageNo=1`;
  const r = await fetch(url);
  const xml = await r.text();

  // Extract all tags from first <item>
  const m = xml.match(/<item>([\s\S]*?)<\/item>/);
  if (!m) return res.status(200).json({ xml: xml.slice(0, 500) });
  const tags = [...m[1].matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(t => ({ tag: t[1], val: t[2].trim() }));
  return res.status(200).json({ tags });
}
