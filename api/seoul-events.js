// api/seoul-events.js — 서울 문화행사 API 프록시 (서대문구 필터)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.SEOUL_API_KEY;
  if (!key) return res.status(500).json({ error: 'API 키 미설정' });

  const { region = '서대문' } = req.query;

  try {
    // 서울 열린데이터광장 문화행사 API (최대 1000건)
    const url = `http://openapi.seoul.go.kr:8088/${key}/json/culturalEventInfo/1/1000/`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Seoul API ${resp.status}`);
    const data = await resp.json();

    const raw = data?.culturalEventInfo?.row || [];
    const code = data?.culturalEventInfo?.RESULT?.CODE || '';
    if (!raw.length && code !== 'INFO-000') {
      throw new Error(data?.culturalEventInfo?.RESULT?.MESSAGE || '데이터 없음');
    }

    // 오늘 이후 행사만
    const today = new Date().toISOString().slice(0, 10);
    let events = raw.filter(e => {
      const end = (e.END_DATE || '').trim();
      return !end || end >= today;
    });

    // 지역 필터
    if (region !== 'all') {
      const keywords = ['서대문', '홍제', '홍은', '남가좌', '북가좌', '연희', '신촌', '이화'];
      events = events.filter(e => {
        const txt = (e.PLACE || '') + (e.ORG_NAME || '');
        return keywords.some(k => txt.includes(k));
      });
    }

    // 시작일 순 정렬
    events.sort((a, b) => (a.STRTDATE || '').localeCompare(b.STRTDATE || ''));

    const result = events.map(e => {
      const fee = (e.USE_FEE || '').trim();
      const isFree =
        e.IS_FREE === '무료' ||
        fee === '무료' || fee === '' || fee === '0' || fee === '0원' ||
        fee.startsWith('무료');

      return {
        id: e.CULTCODE || '',
        title: (e.TITLE || '').trim(),
        category: mapTheme(e.THEMECODE),
        place: (e.PLACE || '').trim(),
        org: (e.ORG_NAME || '').trim(),
        startDate: (e.STRTDATE || '').trim(),
        endDate: (e.END_DATE || '').trim(),
        isFree,
        fee: isFree ? '' : fee,
        img: (e.MAIN_IMG || '').trim(),
        url: (e.HMPG_ADDR || e.TICKET || '').trim(),
        program: (e.PROGRAM || '').trim().slice(0, 100),
      };
    });

    return res.status(200).json({ events: result, total: result.length });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function mapTheme(code) {
  if (!code) return '기타';
  if (/교육|강좌|체험/.test(code)) return '교육·체험';
  if (/전시|관람|미술|박물/.test(code)) return '전시·관람';
  if (/공연|음악|무용|연극|뮤지컬/.test(code)) return '공연·음악';
  if (/스포츠|체육|운동/.test(code)) return '스포츠';
  if (/축제|이벤트|문화|관광/.test(code)) return '문화·축제';
  return '기타';
}
