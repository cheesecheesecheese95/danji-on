// api/library.js — 도서관 책 소장·대출 가능 여부 조회 (도서관 정보나루 API)
const KEY = process.env.DATA4LIBRARY_KEY;
const BASE = 'http://data4library.kr/api';

// 근처 구 필터 (주소 기준)
const TARGET_GU = ['서대문구', '은평구', '마포구'];

async function apiFetch(path, params) {
  const qs = new URLSearchParams({ authKey: KEY, format: 'json', ...params });
  const res = await fetch(`${BASE}/${path}?${qs}`);
  if (!res.ok) throw new Error(`API 오류 ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();
  if (!KEY) return res.status(500).json({ error: 'API 키 누락' });

  const { action, q, isbn } = req.query;

  // ── 1. 도서 검색 ──────────────────────────────────────
  if (action === 'search') {
    if (!q) return res.status(400).json({ error: '검색어를 입력하세요' });
    try {
      const data = await apiFetch('srchBooks', { title: q, pageSize: 8 });
      const docs = data?.response?.docs || [];
      const books = docs.map(d => ({
        title:            d.doc?.title            || '',
        author:           d.doc?.author           || '',
        isbn13:           d.doc?.isbn13           || '',
        publisher:        d.doc?.publisher        || '',
        publication_year: d.doc?.publication_year || '',
        bookImageURL:     d.doc?.bookImageURL     || '',
      })).filter(b => b.isbn13);
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
              return {
                libCode:   lib.libCode,
                libName:   lib.libName,
                region:    gu,
                address:   lib.address || '',
                homepage:  lib.homepage || '',
                hasBook:   result.hasBook === 'Y',
                available: result.loanAvailable === 'Y',
              };
            })
            .catch(() => null)
        )
      );

      const libs = results
        .filter(Boolean)
        .filter(l => l.hasBook)
        .sort((a, b) => b.available - a.available);

      return res.json({ libs });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'action 파라미터가 필요합니다 (search | availability)' });
}
