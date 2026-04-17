// api/news-feed.js — 뉴스/블로그/카페 소식 피드 조회
// Supabase 캐시에서 읽어 반환
export const config = { maxDuration: 10 };

const SB_URL = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 미설정' });

  // type: all(기본) | news | blog | cafe
  const type = req.query?.type || 'all';
  const categories = type === 'all'
    ? ['news_feed_news', 'news_feed_blog', 'news_feed_cafe']
    : [`news_feed_${type}`];

  try {
    const all = [];
    for (const cat of categories) {
      const r = await fetch(
        `${SB_URL}/rest/v1/wiki_documents?category=eq.${cat}&select=body,title&limit=1`,
        { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows.length && rows[0].body) {
          all.push(...JSON.parse(rows[0].body));
        }
      }
    }

    // 날짜순 정렬
    all.sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));

    return res.status(200).json({
      items: all.slice(0, 50),
      total: all.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
