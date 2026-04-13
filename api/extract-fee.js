// api/extract-fee.js — 관리비 고지서 이미지 → 항목별 금액 추출 (Claude Vision)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { image, mediaType } = req.body || {};
  if (!image) return res.status(400).json({ error: '이미지가 없습니다.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키 누락' });

  const systemPrompt = `
당신은 DMC파크뷰자이 아파트 관리비 부과현황 이미지에서 숫자를 추출하는 전문가입니다.

이 표에는 열이 여러 개 있습니다. 반드시 "당월고지금액" 열의 숫자만 읽으세요.
"전월고지금액" 열은 절대 읽지 마세요. 표 상단 헤더에서 "당월고지금액"이라고 표시된 열을 찾아 그 열의 숫자만 사용하세요.

이 고지서의 항목은 아래 순서로 고정되어 있습니다. 항목명을 읽을 필요 없이, 각 행의 당월고지금액 열 숫자만 순서대로 읽어 아래 항목명에 매핑하세요.

고정 항목 순서:
1. 일반관리비
2. 청소비
3. 경비비
4. 소독비
5. 수선유지비
6. 승강기유지비
7. 위탁관리비
8. 보험료
9. 입주자대표회의
10. 선거관리운영비
11. 장기수선충당금
12. 커뮤니티기본료
13. 커뮤니티이용료
14. 커피숍이용료
15. 세대전기료
16. 공동전기료
17. 승강기전기료
18. TV수신료
19. 세대수도료
20. 세대난방비
21. 기본난방비
22. 세대급탕비
23. 음식물사용료
24. 공동관리비차감
25. 합계

숫자 읽기 규칙 (매우 중요):
- 쉼표(,)는 천 단위 구분자입니다. 반드시 제거 후 정수로 변환하세요.
  예) "12,345" → 12345 / "1,234,567" → 1234567
- 금액이 없거나 0인 항목도 0으로 포함하세요 (공동관리비차감은 음수 가능).
- 공동관리비차감은 차감 금액이면 음수(-) 정수로 표기하세요.
- 합계 행의 숫자를 total로 사용하세요.

응답 형식 (JSON만, 설명·마크다운 없이):
{
  "ym": "YYYY-MM",
  "items": [
    {"name": "일반관리비", "amount": 숫자},
    {"name": "청소비", "amount": 숫자},
    ...
    {"name": "공동관리비차감", "amount": 숫자}
  ],
  "total": 숫자
}

- ym: 고지서의 부과 연월 (예: "2025년 2월" → "2025-02")
- items: 합계 항목은 제외, 1~24번 항목만 포함
- 이미지가 관리비 고지서가 아닌 경우: {"error": "고지서를 인식할 수 없어요"}
`.trim();

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [{
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image }
          }, {
            type: 'text',
            text: '이 고지서의 항목별 금액을 JSON으로 추출해주세요.'
          }]
        }]
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(502).json({ error: 'Claude API 오류: ' + err });
    }

    const data = await r.json();
    const text = data.content?.[0]?.text?.trim() || '';

    // JSON 파싱 (코드블록 제거)
    const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(422).json({ error: '고지서를 인식할 수 없어요. 더 선명한 사진으로 다시 시도해주세요.' });
    }

    if (parsed.error) return res.status(422).json({ error: parsed.error });

    // ym 없으면 현재 연월
    if (!parsed.ym) {
      const now = new Date();
      parsed.ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    }

    // 숫자 보정: 혹시 문자열로 들어온 amount 처리 (쉼표 제거 후 정수 변환)
    if (parsed.items) {
      parsed.items = parsed.items.map(item => ({
        ...item,
        amount: typeof item.amount === 'string'
          ? parseInt(item.amount.replace(/[^0-9]/g, ''), 10) || 0
          : Math.round(item.amount || 0),
      })).filter(item => item.amount > 0);
    }

    // total 없으면 합산
    if (!parsed.total && parsed.items) {
      parsed.total = parsed.items.reduce((s, i) => s + (i.amount || 0), 0);
    }

    // total도 숫자 보정
    if (typeof parsed.total === 'string') {
      parsed.total = parseInt(parsed.total.replace(/[^0-9]/g, ''), 10) || 0;
    } else {
      parsed.total = Math.round(parsed.total || 0);
    }

    return res.json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
