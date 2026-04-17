// api/news-sync.js — 네이버 뉴스/블로그/카페 수집 → Supabase 저장
// Cron: 매일 06:00 KST = 21:00 UTC (전일)
export const config = { maxDuration: 30 };

import { DANJI_MASTER, HOME_DANJI } from '../data/danji-master.js';

const SB_URL = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const NAVER_ID = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;

// ── 검색 키워드 ─────────────────────────────────────────────
const KEYWORDS = [
  HOME_DANJI.name,                         // DMC파크뷰자이
  '가재울뉴타운',
  '서대문구 아파트',
  'DMC 부동산',
];

// ── 카페 광고 필터 ──────────────────────────────────────────
const AD_KEYWORDS = /급매|급전세|문의주세요|초특가|매물안내|부동산문의|중개|분양상담|투자상담|떨이|세입자모집/;
const PHONE_RE = /\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const AD_CAFE_NAMES = /부동산|중개|매물|분양|공인/;

function isAdContent(item) {
  const text = `${item.title} ${item.description}`;
  if (PHONE_RE.test(text)) return true;
  if (AD_KEYWORDS.test(text)) return true;
  if (item.cafename && AD_CAFE_NAMES.test(item.cafename)) return true;
  return false;
}

// ── 네이버 검색 API 호출 ────────────────────────────────────
async function naverSearch(type, query, display = 20) {
  const url = `https://openapi.naver.com/v1/search/${type}.json`
    + `?query=${encodeURIComponent(query)}&display=${display}&sort=date`;
  const r = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
    },
  });
  if (!r.ok) return [];
  const data = await r.json();
  return data.items || [];
}

// ── HTML 태그 제거 ──────────────────────────────────────────
function strip(html) {
  return (html || '').replace(/<\/?b>/g, '').replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ── 수집 + 정규화 ──────────────────────────────────────────
async function collectAll() {
  const seen = new Set();
  const results = { news: [], blog: [], cafe: [] };

  for (const kw of KEYWORDS) {
    const [newsItems, blogItems, cafeItems] = await Promise.all([
      naverSearch('news', kw, 20),
      naverSearch('blog', kw, 20),
      naverSearch('cafearticle', kw, 20),
    ]);

    for (const item of newsItems) {
      const key = item.link;
      if (seen.has(key)) continue;
      seen.add(key);
      results.news.push({
        type: 'news',
        title: strip(item.title),
        description: strip(item.description),
        link: item.link,
        pubDate: item.pubDate,
        source: item.originallink || item.link,
      });
    }

    for (const item of blogItems) {
      const key = item.link;
      if (seen.has(key)) continue;
      seen.add(key);
      results.blog.push({
        type: 'blog',
        title: strip(item.title),
        description: strip(item.description),
        link: item.link,
        pubDate: item.postdate, // YYYYMMDD
        bloggerName: item.bloggername || '',
      });
    }

    for (const item of cafeItems) {
      if (isAdContent(item)) continue;
      const key = item.link;
      if (seen.has(key)) continue;
      seen.add(key);
      results.cafe.push({
        type: 'cafe',
        title: strip(item.title),
        description: strip(item.description),
        link: item.link,
        pubDate: item.pubDate || '',
        cafeName: item.cafename || '',
      });
    }
  }

  // 날짜순 정렬 (최신 먼저)
  const byDate = (a, b) => (b.pubDate || '').localeCompare(a.pubDate || '');
  results.news.sort(byDate);
  results.blog.sort(byDate);
  results.cafe.sort(byDate);

  return results;
}

// ── Supabase 저장 ───────────────────────────────────────────
async function saveCache(category, items) {
  const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
  await fetch(`${SB_URL}/rest/v1/wiki_documents?category=eq.${category}`, {
    method: 'DELETE', headers,
  });
  await fetch(`${SB_URL}/rest/v1/wiki_documents`, {
    method: 'POST', headers,
    body: JSON.stringify([{
      category,
      title: new Date().toISOString().slice(0, 10),
      summary: `${items.length}건`,
      body: JSON.stringify(items),
      is_featured: false,
      view_count: 0,
      status: 'published',
    }]),
  });
}

// ── 핸들러 ──────────────────────────────────────────────────
export default async function handler(req, res) {
  if (!NAVER_ID || !NAVER_SECRET) {
    return res.status(500).json({ error: 'NAVER 환경변수 미설정' });
  }
  if (!SB_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY 미설정' });
  }

  try {
    const results = await collectAll();

    // 카테고리별 저장
    await Promise.all([
      saveCache('news_feed_news', results.news),
      saveCache('news_feed_blog', results.blog),
      saveCache('news_feed_cafe', results.cafe),
    ]);

    return res.status(200).json({
      ok: true,
      news: results.news.length,
      blog: results.blog.length,
      cafe: results.cafe.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[news-sync]', err);
    return res.status(500).json({ error: err.message });
  }
}
