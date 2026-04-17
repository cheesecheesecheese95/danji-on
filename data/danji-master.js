// data/danji-master.js
// DMC파크뷰자이 + 이웃 단지 7개 마스터 데이터
// 검증 소스: KB부동산(kbland.kr), 호갱노노(hogangnono.com) — 2026-04-17 기준

export const DANJI_MASTER = [
  {
    id: 'parkviewxion',
    name: 'DMC파크뷰자이',
    aliases: ['디엠씨파크뷰자이', '파크뷰자이'],
    address: '서울 서대문구 가재울미래로 2',
    lawdCd: '11410',        // 서대문구
    legalDongCode: '1141012000', // 남가좌동
    dong: '남가좌동',
    sedaeCount: 4300,
    builtYear: 2015,
    builtMonth: '2015.10',
    hgnnId: '9YLdc',       // 호갱노노 해시
    isHome: true,
    displayOrder: 0,
  },
  {
    id: 'remian-epyeonhan',
    name: 'DMC래미안e편한세상',
    aliases: ['래미안이편한세상', 'DMC래미안이편한세상'],
    address: '서울 서대문구 수색로 100',
    lawdCd: '11410',
    legalDongCode: '1141011900', // 북가좌동
    dong: '북가좌동',
    sedaeCount: 3293,
    builtYear: 2012,
    builtMonth: '2012.10',
    hgnnId: 'Me23',
    isHome: false,
    displayOrder: 1,
  },
  {
    id: 'remian-lucentia',
    name: 'DMC래미안루센티아',
    aliases: ['래미안루센티아', '루센티아'],
    address: '서울 서대문구 가재울미래로 66',
    lawdCd: '11410',
    legalDongCode: '1141012000', // 남가좌동
    dong: '남가좌동',
    sedaeCount: 997,
    builtYear: 2020,
    builtMonth: '2020.02',
    hgnnId: 'b4Zfa',
    isHome: false,
    displayOrder: 2,
  },
  {
    id: 'central-ipark',
    name: 'DMC센트럴아이파크',
    aliases: ['센트럴아이파크', 'DMC아이파크'],
    address: '서울 서대문구 가재울미래로 36',
    lawdCd: '11410',
    legalDongCode: '1141012000', // 남가좌동
    dong: '남가좌동',
    sedaeCount: 1061,
    builtYear: 2018,
    builtMonth: '2018.12',
    hgnnId: 'aVO1a',
    isHome: false,
    displayOrder: 3,
  },
  {
    id: 'eco-xi',
    name: 'DMC에코자이',
    aliases: ['에코자이'],
    address: '서울 서대문구 거북골로 84',
    lawdCd: '11410',
    legalDongCode: '1141012000', // 남가좌동
    dong: '남가좌동',
    sedaeCount: 1047,
    builtYear: 2019,
    builtMonth: '2019.12',
    hgnnId: 'b4T67',
    isHome: false,
    displayOrder: 4,
  },
  {
    id: 'centreville',
    name: 'DMC센트레빌',
    aliases: ['센트레빌'],
    address: '서울 서대문구 가재울미래로 15',
    lawdCd: '11410',
    legalDongCode: '1141012000', // 남가좌동
    dong: '남가좌동',
    sedaeCount: 473,
    builtYear: 2010,
    builtMonth: '2010.02',
    hgnnId: 'MB78',
    isHome: false,
    displayOrder: 5,
  },
  {
    id: 'central-xi',
    name: 'DMC센트럴자이',
    aliases: ['센트럴자이'],
    address: '서울 은평구 증산로 11',
    lawdCd: '11380',        // 은평구
    legalDongCode: '1138011000', // 증산동
    dong: '증산동',
    sedaeCount: 1388,
    builtYear: 2022,
    builtMonth: '2022.03',
    hgnnId: 'dzJ4f',
    isHome: false,
    displayOrder: 6,
  },
  {
    id: 'sk-view',
    name: 'DMC SK뷰',
    aliases: ['SK뷰', 'DMC에스케이뷰'],
    address: '서울 은평구 수색로 220',
    lawdCd: '11380',        // 은평구
    legalDongCode: '1138010100', // 수색동
    dong: '수색동',
    sedaeCount: 753,
    builtYear: 2021,
    builtMonth: '2021.10',
    hgnnId: 'dsbc5',
    isHome: false,
    displayOrder: 7,
  },
];

// 국토부 API에서 사용할 고유 LAWD_CD 목록
export const LAWD_CODES = [...new Set(DANJI_MASTER.map(d => d.lawdCd))];
// → ['11410', '11380']

// 단지명으로 빠르게 찾기 (API 응답의 aptNm과 매칭용)
export function findDanji(aptNm) {
  if (!aptNm) return null;
  return DANJI_MASTER.find(d =>
    aptNm.includes(d.name) || d.aliases.some(a => aptNm.includes(a))
  ) || null;
}

// 홈 단지
export const HOME_DANJI = DANJI_MASTER.find(d => d.isHome);
