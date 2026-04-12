// api/seoul-events.js — 서울 문화행사 API 프록시

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.SEOUL_API_KEY || '697573464e6368653130336b7a757655';

  try {
    // 서울 열린데이터광장 문화행사 API (최대 1000건)
    const url = `http://openapi.seoul.go.kr:8088/${key}/json/culturalEventInfo/1/1000/`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Seoul API ${resp.status}`);
    const data = await resp.json();

    const raw = data?.culturalEventInfo?.row || [];
    if (!raw.length) {
      const msg = data?.culturalEventInfo?.RESULT?.MESSAGE || '결과 없음';
      throw new Error(msg);
    }

    // 오늘 이후 행사만
    const today = new Date().toISOString().slice(0, 10);
    let events = raw.filter(e => {
      const end = (e.END_DATE || '').trim();
      return !end || end >= today;
    });

    // 시작일 순 정렬 → 최대 300건
    events.sort((a, b) => (a.STRTDATE || '').localeCompare(b.STRTDATE || ''));
    events = events.slice(0, 300);

    const result = events.map(e => {
      const fee = (e.USE_FEE || '').trim();
      const isFree =
        e.IS_FREE === '무료' ||
        fee === '' || fee === '무료' || fee === '0' || fee === '0원' ||
        fee.startsWith('무료') || fee === '없음';

      // 지역 추출 (PLACE에서 구 이름 파싱)
      const place = (e.PLACE || '').trim();
      const district = extractDistrict(place);

      return {
        id: e.CULTCODE || '',
        title: (e.TITLE || '').trim(),
        category: mapTheme(e.THEMECODE),
        rawTheme: (e.THEMECODE || '').trim(),
        district,
        place,
        org: (e.ORG_NAME || '').trim(),
        startDate: (e.STRTDATE || '').trim(),
        endDate: (e.END_DATE || '').trim(),
        isFree,
        fee: isFree ? '' : fee,
        url: (e.HMPG_ADDR || e.TICKET || '').trim(),
        program: (e.PROGRAM || '').trim().slice(0, 100),
      };
    });

    return res.status(200).json({ events: result, total: result.length });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// 서울 열린데이터광장 THEMECODE 실제 값에 맞춘 매핑
function mapTheme(code) {
  if (!code) return '기타';
  const c = code.trim();
  // 완전 일치 우선
  const exact = {
    '교육강좌': '교육·체험',
    '전시/관람': '전시·관람',
    '공연/음악/무용': '공연·음악',
    '스포츠관람': '스포츠',
    '문화/관광': '문화·축제',
    '축제/이벤트': '문화·축제',
  };
  if (exact[c]) return exact[c];
  // 부분 매핑
  if (c.includes('교육') || c.includes('강좌') || c.includes('체험')) return '교육·체험';
  if (c.includes('전시') || c.includes('관람') || c.includes('미술') || c.includes('박물')) return '전시·관람';
  if (c.includes('공연') || c.includes('음악') || c.includes('무용') || c.includes('연극') || c.includes('뮤지컬')) return '공연·음악';
  if (c.includes('스포츠') || c.includes('체육') || c.includes('운동')) return '스포츠';
  if (c.includes('축제') || c.includes('이벤트') || c.includes('문화') || c.includes('관광')) return '문화·축제';
  return '기타';
}

// PLACE 문자열에서 구 이름 추출
function extractDistrict(place) {
  const districts = [
    '서대문구','마포구','은평구','종로구','중구','용산구','성동구','광진구',
    '동대문구','성북구','강북구','도봉구','노원구','중랑구','강동구','송파구',
    '강남구','서초구','관악구','동작구','영등포구','구로구','금천구','양천구',
    '강서구','서대문','마포','은평','홍제','홍은','신촌','연희','남가좌','북가좌',
  ];
  for (const d of districts) {
    if (place.includes(d)) return d.endsWith('구') ? d : d + '구';
  }
  return '기타';
}
