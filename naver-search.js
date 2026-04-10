// Vercel 서버리스 함수 — 네이버 검색 API 프록시
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const query   = searchParams.get('query') || '';
  const type    = searchParams.get('type') || 'local';
  const display = searchParams.get('display') || '5';

  if (!query) {
    return new Response(JSON.stringify({ error: 'query 필요' }), { status: 400 });
  }

  const url = `https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(query)}&display=${display}&sort=comment`;

  try {
    const resp = await fetch(url, {
      headers: {
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      }
    });
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
