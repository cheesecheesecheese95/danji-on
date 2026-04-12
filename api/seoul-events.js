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

// 서울 열린데이터광장 culturalEventInfo THEMECODE 실제 값 매핑
// 실제 반환값: '기타', '어린이/청소년 문화행사', '가족 문화행사', '어르신 문화행사', '여성 문화행사'
function mapTheme(code) {
  if (!code) return '기타';
  const c = code.trim();
  if (c.includes('어린이') || c.includes('청소년')) return '어린이·청소년';
  if (c.includes('가족')) return '가족';
  if (c.includes('어르신')) return '어르신';
  if (c.includes('여성')) return '여성';
  return '기타';
}

// PLACE 문자열에서 구 이름 추출 (구 suffix 없는 지명도 포함)
function extractDistrict(place) {
  const map = {
    '서대문구':'서대문구','마포구':'마포구','은평구':'은평구','종로구':'종로구','중구':'중구',
    '용산구':'용산구','성동구':'성동구','광진구':'광진구','동대문구':'동대문구','성북구':'성북구',
    '강북구':'강북구','도봉구':'도봉구','노원구':'노원구','중랑구':'중랑구','강동구':'강동구',
    '송파구':'송파구','강남구':'강남구','서초구':'서초구','관악구':'관악구','동작구':'동작구',
    '영등포구':'영등포구','구로구':'구로구','금천구':'금천구','양천구':'양천구','강서구':'강서구',
    // 구 suffix 없는 지명
    '서대문':'서대문구','마포':'마포구','은평':'은평구','종로':'종로구',
    '용산':'용산구','성동':'성동구','광진':'광진구','동대문':'동대문구','성북':'성북구',
    '강북':'강북구','도봉':'도봉구','노원':'노원구','중랑':'중랑구','강동':'강동구',
    '송파':'송파구','강남':'강남구','서초':'서초구','관악':'관악구','동작':'동작구',
    '영등포':'영등포구','구로':'구로구','금천':'금천구','양천':'양천구','강서':'강서구',
  };
  // 긴 키 먼저 매칭 (오탐 방지)
  const keys = Object.keys(map).sort((a,b) => b.length - a.length);
  for (const k of keys) {
    if (place.includes(k)) return map[k];
  }
  return '기타';
}
