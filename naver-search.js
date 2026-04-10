// Vercel 서버리스 함수 (Node.js) — 네이버 검색 API 프록시

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query, type = 'local', display = '5' } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'query 파라미터 필요' });
  }

  const clientId     = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  // 환경변수 체크
  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: 'Vercel 환경변수 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정'
    });
  }

  const allowedTypes = ['local', 'blog', 'news'];
  const safeType = allowedTypes.includes(type) ? type : 'local';

  const naverUrl = `https://openapi.naver.com/v1/search/${safeType}.json`
    + `?query=${encodeURIComponent(query)}`
    + `&display=${Number(display) || 5}`;

  try {
    const response = await fetch(naverUrl, {
      headers: {
        'X-Naver-Client-Id':     clientId,
        'X-Naver-Client-Secret': clientSecret,
        'Accept': 'application/json',
      },
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({ error: text });
    }

    const data = JSON.parse(text);
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
