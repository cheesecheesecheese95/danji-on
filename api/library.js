// api/library.js — 도서관 책 소장·대출 가능 여부 조회 (도서관 정보나루 API)
const KEY = process.env.DATA4LIBRARY_KEY;
const BASE = 'http://data4library.kr/api';

// 네이버 Books API
const NAVER_ID     = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;

// DMC파크뷰자이 중심 좌표
const HOME = { lat: 37.5733, lng: 126.9198 };

// 근처 구 필터 (주소 기준)
const TARGET_GU = ['서대문구', '은평구', '마포구'];

// Haversine 거리 계산 (km)
function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
    + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function apiFetch(path, params) {
  const qs = new URLSearchParams({ authKey: KEY, format: 'json', ...params }).toString().replace(/\+/g, '%20');
  const res = await fetch(`${BASE}/${path}?${qs}`);
  if (!res.ok) throw new Error(`API 오류 ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();
  if (!KEY) return res.status(500).json({ error: 'DATA4LIBRARY_KEY 누락' });

  const { action, q, isbn } = req.query;

  // ── 1. 도서 검색 (네이버 Books API) ───────────────────
  if (action === 'search') {
    if (!q) return res.status(400).json({ error: '검색어를 입력하세요' });
    if (!NAVER_ID || !NAVER_SECRET) return res.status(500).json({ error: 'NAVER API 키 누락' });
    try {
      const qs = new URLSearchParams({ query: q, display: 10, sort: 'sim' });
      const r = await fetch(`https://openapi.naver.com/v1/search/book.json?${qs}`, {
        headers: {
          'X-Naver-Client-Id': NAVER_ID,
          'X-Naver-Client-Secret': NAVER_SECRET,
        },
      });
      if (!r.ok) throw new Error(`네이버 API 오류 ${r.status}`);
      const data = await r.json();
      const books = (data.items || []).map(item => {
        // isbn 필드: "ISBN10 ISBN13" 또는 "ISBN13" 형식
        const isbnParts = (item.isbn || '').trim().split(/\s+/);
        const isbn13 = isbnParts.find(s => s.length === 13) || isbnParts[isbnParts.length - 1] || '';
        const pubYear = (item.pubdate || '').slice(0, 4);
        return {
          title:            item.title?.replace(/<[^>]+>/g, '') || '',
          author:           item.author?.replace(/<[^>]+>/g, '') || '',
          isbn13,
          publisher:        item.publisher || '',
          publication_year: pubYear,
          bookImageURL:     item.image || '',
        };
      }).filter(b => b.isbn13);
      return res.json({ books });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── 2. 근처 도서관 대출 가능 여부 ────────────────────
  if (action === 'availability') {
    if (!isbn) return res.status(400).json({ error: 'ISBN이 없습니다' });
    try {
      // 서울 전체에서 해당 책 소장 도서관 조회 (최대 100개)
      const data = await apiFetch('libSrchByBook', {
        isbn: isbn,
        region: '11',
        pageSize: 100,
      });

      const allLibs = (data?.response?.libs || []).map(l => l.lib).filter(Boolean);

      // 서대문·은평·마포구 필터
      const nearby = allLibs.filter(lib =>
        TARGET_GU.some(gu => (lib.address || '').includes(gu))
      );

      if (nearby.length === 0) return res.json({ libs: [] });

      // 각 도서관에 대해 bookExist API로 대출 가능 여부 확인 (병렬)
      const results = await Promise.all(
        nearby.map(lib =>
          apiFetch('bookExist', { libCode: lib.libCode, isbn13: isbn })
            .then(d => {
              const result = d?.response?.result || {};
              const gu = TARGET_GU.find(g => (lib.address || '').includes(g)) || '';
              const lat = parseFloat(lib.latitude);
              const lng = parseFloat(lib.longitude);
              const dist = (lat && lng) ? distKm(HOME.lat, HOME.lng, lat, lng) : 999;
              return {
                libCode:   lib.libCode,
                libName:   lib.libName,
                region:    gu,
                address:   lib.address || '',
                homepage:  lib.homepage || '',
                hasBook:   result.hasBook === 'Y',
                available: result.loanAvailable === 'Y',
                distKm:    Math.round(dist * 10) / 10,
              };
            })
            .catch(() => null)
        )
      );

      const libs = results
        .filter(Boolean)
        .filter(l => l.hasBook)
        .sort((a, b) => a.distKm - b.distKm);

      return res.json({ libs });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'action 파라미터가 필요합니다 (search | availability)' });
}
