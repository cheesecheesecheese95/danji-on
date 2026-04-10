// api/claude.js — Claude AI 검색 보조
// 앱 내 키워드 미매칭 쿼리를 자연어로 처리

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { question, messages } = req.body || {};

  // 다중 턴 대화(messages) 또는 단일 질문(question) 둘 다 지원
  let claudeMessages;
  if (messages && Array.isArray(messages) && messages.length > 0) {
    claudeMessages = messages;
  } else if (question && question.trim().length >= 2) {
    claudeMessages = [{ role: 'user', content: question.trim() }];
  } else {
    return res.status(400).json({ error: '질문을 입력해주세요.' });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'API 키 미설정' });

  // 단지 컨텍스트 — 앱 내 핵심 정보 요약
  const CONTEXT = `
당신은 서울 서대문구 남가좌동 DMC파크뷰자이 아파트(4,300세대) 입주민 전용 앱의 AI 도우미입니다.
아래 정보를 바탕으로 입주민의 질문에 간결하고 정확하게 답변합니다.

[관리비]
- 2026년 2월 세대당 평균 38.7만원 (총 166억)
- 주요 항목: 난방비 12.1만원, 전기료 8.9만원, 경비비 4.0만원, 청소비 2.5만원
- 장기수선충당금: 세대당 월 19,675원 (고정) — 임차인 납부 시 이사 때 임대인 청구 가능
- 납부 마감: 매월 25일
- 관리사무소: 02-931-8360

[커뮤니티 시설]
- 수영장, 헬스장, 골프연습장, 독서실, 탁구장, 더 테라스 카페 운영
- 2026.04.01부터 이용규정 개정: 출입 방식 변경, 신청 일정 개편
- 2026.05부터 신청은 바이비(ByB) 앱에서만 가능
- 월별 신청 일정: 재등록·취소 1~20일 / 신규 20~24일 / 현장 25~28일

[주차]
- 방문차량 월 150시간 무료 (2026.03.01 시행), 초과 시 30분당 500원
- 전기차 전용구역: 충전 완료 후 14시간 내 이동 의무
- 소화전·장애인구역·이중주차 위반 신고: 관리사무소 또는 민원게시판

[수리·하자]
- 누수·결로·곰팡이·엘리베이터 이상: 관리사무소 신고 → 하자보수 업체 연결
- 입주 후 10년 이내 구조·방수 하자: 시공사 하자보수 대상

[생활 편의]
- 음식물 RFID 카드 없이 투입 시 건당 200원, 관리사무소 발급
- 대형폐기물: 서대문구 다산콜 02-391-7171 신청
- 택배 무인함 문의: 관리사무소

[층간소음·민원]
- 소음 시간대 기록 후 관리사무소 제출 → 측정 조사 요청 가능
- 층간소음이웃사이센터: 1661-2642
- 지정 흡연구역 외 흡연 시 관리규약에 따라 과태료

[연락처 전체]
관리사무소 대표: 02-931-8360
내선 안내:
  1번 - 생활안내
  2번 - 커뮤니티센터
  3번 - 전기·설비·승강기
  4번 - 관리비·전출입
  5번 - SH임대
  6번 - 난방·수도·전기요금
  7번 - 경비·보안·초소
  8번 - 미화·청소
  9번 - 기타

방재실 (24시간, 화재·재난 긴급):
  1단지: 070-7727-8378
  2단지: 070-4285-8365
  3단지: 070-7725-8374
  4·5단지: 070-4906-8376

홈페이지: www.dmcpwgapt.com
관리사무소 이메일: dmcpwgapt@naver.com
커뮤니티센터 이메일: dmccommunity@naver.com

[운영 시간]
관리사무소: 월~금 09:00~18:00
커뮤니티센터 운영사무실: 화~일 09:00~18:00 (월 휴무)
운동시설: 화~금 06:00~23:00 / 토~일 09:00~21:00 (월 휴무)
카페 테라스: 월~금 07:00~19:00 / 토~일 08:00~19:00 (라스트오더 18:30)

[응급]
- 세브란스병원 응급실: 02-2227-7777
- 경비실 24시간: 02-931-8360 (내선 7번)
`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: CONTEXT,
        messages: claudeMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: 'Claude API 오류', detail: err });
    }

    const data = await response.json();
    const answer = data.content?.[0]?.text || '답변을 생성할 수 없어요.';
    return res.status(200).json({ answer });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
