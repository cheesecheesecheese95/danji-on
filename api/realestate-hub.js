// api/realestate-hub.js — 부동산 허브 통합 조회 API + 네이버 검색 프록시
// ?section=daily-comment | weekly-insight | news-feed | naver-search
export const config = { maxDuration: 10 };

const SB_URL = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const SECTION_MAP = {
  'daily-comment':  ['realestate_daily_comment'],
  'weekly-insight': ['realestate_weekly_insight'],
  'news-feed':      ['news_feed_news', 'news_feed_blog', 'news_feed_cafe'],
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const section = req.query?.section;

  // ── Shoeson 트래킹 ──────────────────────────────────────
  if (section === 'shoeson-track') {
    if (!SB_KEY) return res.status(500).json({ error: 'SB key missing' });
    const sbH = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };
    if (req.method === 'POST') {
      const { event } = req.body || {};
      if (!event) return res.status(400).json({ error: 'event required' });
      const today = new Date().toISOString().slice(0, 10);
      // 카테고리: shoeson_track_YYYY-MM-DD, body에 이벤트 집계
      const catKey = `shoeson_track_${today}`;
      // 기존 데이터 읽기
      const r = await fetch(`${SB_URL}/rest/v1/wiki_documents?category=eq.${catKey}&select=id,body&limit=1`, { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } });
      let counts = {};
      let existingId = null;
      if (r.ok) {
        const rows = await r.json();
        if (rows.length) { existingId = rows[0].id; try { counts = JSON.parse(rows[0].body); } catch(_) {} }
      }
      counts[event] = (counts[event] || 0) + 1;
      if (existingId) {
        await fetch(`${SB_URL}/rest/v1/wiki_documents?id=eq.${existingId}`, { method: 'PATCH', headers: sbH, body: JSON.stringify({ body: JSON.stringify(counts) }) });
      } else {
        await fetch(`${SB_URL}/rest/v1/wiki_documents`, { method: 'POST', headers: sbH, body: JSON.stringify([{ category: catKey, title: today, summary: 'track', body: JSON.stringify(counts), is_featured: false, view_count: 0, status: 'published' }]) });
      }
      return res.status(200).json({ ok: true });
    }
    // GET: 최근 30일 데이터
    const days = [];
    for (let i = 0; i < 30; i++) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
    const cats = days.map(d => `shoeson_track_${d}`);
    const results = {};
    for (const cat of cats) {
      const r = await fetch(`${SB_URL}/rest/v1/wiki_documents?category=eq.${cat}&select=body,title&limit=1`, { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } });
      if (r.ok) { const rows = await r.json(); if (rows.length) { try { results[rows[0].title] = JSON.parse(rows[0].body); } catch(_) {} } }
    }
    return res.status(200).json(results);
  }

  // ── Shoeson 투표 프록시 ──────────────────────────────────
  if (section === 'shoeson-vote') {
    if (!SB_KEY) return res.status(500).json({ error: 'SB key missing' });
    const sbH = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };
    if (req.method === 'POST') {
      const { role, vote, review, hesitations, etcText } = req.body || {};
      if (!role) return res.status(400).json({ error: 'role required' });
      await fetch(`${SB_URL}/rest/v1/wiki_documents`, {
        method: 'POST', headers: sbH,
        body: JSON.stringify([{ category: 'shoeson_vote', title: new Date().toISOString().slice(0, 10), summary: role, body: JSON.stringify({ role, vote, review, hesitations, etcText, ts: Date.now() }), is_featured: false, view_count: 0, status: 'published' }]),
      });
      return res.status(200).json({ ok: true });
    }
    // DELETE: 특정 투표 삭제 (?id=123) 또는 전체 삭제 (?id=all)
    if (req.method === 'DELETE') {
      const delId = req.query?.id;
      if (!delId) return res.status(400).json({ error: 'id required (?id=123 or ?id=all)' });
      const delUrl = delId === 'all'
        ? `${SB_URL}/rest/v1/wiki_documents?category=eq.shoeson_vote`
        : `${SB_URL}/rest/v1/wiki_documents?id=eq.${delId}&category=eq.shoeson_vote`;
      await fetch(delUrl, { method: 'DELETE', headers: sbH });
      return res.status(200).json({ ok: true, deleted: delId });
    }
    // GET: 결과 조회
    const r = await fetch(`${SB_URL}/rest/v1/wiki_documents?category=eq.shoeson_vote&select=id,body,summary&order=id.desc&limit=200`, { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } });
    if (r.ok) return res.status(200).json(await r.json());
    return res.status(200).json([]);
  }

  // ── 네이버 검색 프록시 ────────────────────────────────────
  if (section === 'naver-search') {
    const { query, type = 'local', display = '5' } = req.query;
    if (!query) return res.status(400).json({ error: 'query 필요' });
    const clientId     = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(500).json({ error: 'NAVER 환경변수 미설정' });
    const allowedTypes = ['local', 'blog', 'news'];
    const safeType = allowedTypes.includes(type) ? type : 'local';
    const url = `https://openapi.naver.com/v1/search/${safeType}.json?query=${encodeURIComponent(query)}&display=${Number(display)||5}`;
    try {
      const response = await fetch(url, {
        headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Supabase 캐시 조회 ────────────────────────────────────
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 미설정' });

  // ── 번들 조회 (부동산 페이지 전체 데이터 1회 호출) ────────
  if (section === 'all') {
    try {
      const cats = [
        'realestate_daily_comment', 'realestate_weekly_insight',
        'news_feed_news', 'news_summary',
        'realestate_trade', 'realestate_rent',
        'realestate_neighbor_trade', 'hogangnono_data',
      ];
      const results = await Promise.all(cats.map(async cat => {
        const r = await fetch(
          `${SB_URL}/rest/v1/wiki_documents?category=eq.${cat}&select=body,title&limit=1`,
          { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
        );
        if (!r.ok) return null;
        const rows = await r.json();
        return (rows.length && rows[0].body) ? JSON.parse(rows[0].body) : null;
      }));
      return res.status(200).json({
        dailyComment: results[0],
        weeklyInsight: results[1],
        news: results[2] || [],
        newsSummary: results[3],
        homeTrade: results[4] || [],
        homeRent: results[5] || [],
        neighborTrade: results[6] || [],
        hogangnono: results[7],
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (!section || !SECTION_MAP[section]) {
    return res.status(400).json({ error: 'section 파라미터 필요: all | daily-comment | weekly-insight | news-feed | naver-search' });
  }

  try {
    const categories = SECTION_MAP[section];

    // news-feed: type 필터 지원
    const feedType = req.query?.type || 'all';
    const filteredCats = section === 'news-feed' && feedType !== 'all'
      ? [`news_feed_${feedType}`]
      : categories;

    if (section === 'news-feed') {
      // 여러 카테고리 병합
      const all = [];
      for (const cat of filteredCats) {
        const r = await fetch(
          `${SB_URL}/rest/v1/wiki_documents?category=eq.${cat}&select=body,title&limit=1`,
          { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
        );
        if (r.ok) {
          const rows = await r.json();
          if (rows.length && rows[0].body) all.push(...JSON.parse(rows[0].body));
        }
      }
      // 날짜 정규화 (YYYYMMDD / RFC 2822 → ISO)
      for (const item of all) {
        if (/^\d{8}$/.test(item.pubDate)) {
          item._sortDate = `${item.pubDate.slice(0,4)}-${item.pubDate.slice(4,6)}-${item.pubDate.slice(6,8)}`;
        } else if (item.pubDate) {
          try { item._sortDate = new Date(item.pubDate).toISOString().slice(0,10); } catch(_) { item._sortDate = ''; }
        } else { item._sortDate = ''; }
      }
      // 최신순 정렬
      all.sort((a, b) => (b._sortDate || '').localeCompare(a._sortDate || ''));
      // 중복 제목 제거
      const seen = new Set();
      const deduped = all.filter(item => {
        const key = item.title.replace(/\s+/g, '').slice(0, 30);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      // _sortDate 필드 제거
      for (const item of deduped) delete item._sortDate;
      // 전체 탭: 타입별 최소 보장 (뉴스 20, 블로그 15, 카페 10 + 나머지)
      let result = deduped;
      if (feedType === 'all' && deduped.length > 60) {
        const byType = { news: [], blog: [], cafe: [] };
        for (const item of deduped) (byType[item.type] || []).push(item);
        const guaranteed = [
          ...byType.news.slice(0, 20),
          ...byType.blog.slice(0, 15),
          ...byType.cafe.slice(0, 10),
        ];
        const usedLinks = new Set(guaranteed.map(i => i.link));
        const rest = deduped.filter(i => !usedLinks.has(i.link));
        result = [...guaranteed, ...rest];
      }
      return res.status(200).json({ items: result.slice(0, 80), total: result.length });
    }

    // daily-comment, weekly-insight: 단일 카테고리
    const r = await fetch(
      `${SB_URL}/rest/v1/wiki_documents?category=eq.${categories[0]}&select=body,title&limit=1`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      if (rows.length && rows[0].body) {
        return res.status(200).json(JSON.parse(rows[0].body));
      }
    }
    return res.status(200).json(section === 'daily-comment' ? { comment: null } : { insight: null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
