// api/library.js — 도서관 책 소장·대출 가능 여부 조회 (도서관 정보나루 API)
const KEY = process.env.DATA4LIBRARY_KEY;
const BASE = 'http://data4library.kr/api';

// 단지 근처 도서관 권역 (서대문·은평·마포)
const REGIONS = [
  { region: '11', dtl: '11230', name: '서대문구' },
  { region: '11', dtl: '11380', name: '은평구' },
  { region: '11', dtl: '11440', name: '마포구' },
];

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
        title:  d.doc?.title  || '',
        author: d.doc?.author || '',
        isbn13: d.doc?.isbn13 || '',
        publisher: d.doc?.publisher || '',
        publication_year: d.doc?.publication_year || '',
        bookImageURL: d.doc?.bookImageURL || '',
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
      const results = await Promise.all(
        REGIONS.map(r =>
          apiFetch('libSrchByBook', {
            isbn: isbn,
            region: r.region,
            dtl_region: r.dtl,
            pageSize: 10,
          }).then(data => {
            const libs = data?.response?.libs || [];
            return libs.map(l => ({
              libCode:  l.lib?.libCode  || '',
              libName:  l.lib?.libName  || '',
              region:   r.name,
              available: l.lib?.loanAvailable === 'Y',
              homepage: l.lib?.homepage || '',
            }));
          }).catch(() => [])
        )
      );
      const libs = results.flat().sort((a, b) => b.available - a.available);
      return res.json({ libs });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'action 파라미터가 필요합니다 (search | availability)' });
}
