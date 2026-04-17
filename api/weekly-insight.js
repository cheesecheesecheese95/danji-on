// api/weekly-insight.js — "이번 주 관점" 조회
export const config = { maxDuration: 10 };

const SB_URL = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 미설정' });

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/wiki_documents?category=eq.realestate_weekly_insight&select=body,title&limit=1`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      if (rows.length && rows[0].body) {
        return res.status(200).json(JSON.parse(rows[0].body));
      }
    }
    return res.status(200).json({ insight: null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
