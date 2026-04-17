// api/daily-comment.js — "오늘의 한 줄" 조회
export const config = { maxDuration: 10 };

const SB_URL = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 미설정' });

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/wiki_documents?category=eq.realestate_daily_comment&select=body,title&limit=1`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      if (rows.length && rows[0].body) {
        return res.status(200).json(JSON.parse(rows[0].body));
      }
    }
    return res.status(200).json({ comment: null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
