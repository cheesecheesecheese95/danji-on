export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, type = 'local', display = '5' } = req.query;
  if (!query) return res.status(400).json({ error: 'query 필요' });

  const clientId     = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Vercel 환경변수 미설정' });
  }

  const allowedTypes = ['local', 'blog', 'news'];
  const safeType = allowedTypes.includes(type) ? type : 'local';
  const url = `https://openapi.naver.com/v1/search/${safeType}.json?query=${encodeURIComponent(query)}&display=${Number(display)||5}`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id':     clientId,
        'X-Naver-Client-Secret': clientSecret,
      }
    });
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
