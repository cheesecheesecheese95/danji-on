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
당신은 한국 아파트 관리비 고지서(부과현황) 이미지 분석 전문가입니다.
이미지에서 관리비 항목과 금액을 정확하게 추출해 JSON으로만 응답하세요.

응답 형식 (JSON만, 마크다운·설명 없이):
{
  "ym": "YYYY-MM",
  "items": [
    {"name": "항목명", "amount": 숫자},
    ...
  ],
  "total": 숫자
}

숫자 인식 규칙 (매우 중요):
- 쉼표(,)는 천 단위 구분자입니다. 반드시 제거하고 정수로 변환하세요.
  예: "123,456" → 123456 / "1,234,567" → 1234567
- 숫자 앞뒤의 원(₩) 기호, 공백은 무시하세요.
- 0이 아닌 금액만 포함하세요 (0원 항목 제외).
- 각 항목의 amount는 반드시 양의 정수입니다. 소수점 없음.
- 표에서 항목명과 금액 열을 정확히 매칭하세요. 항목명 행과 금액 행이 같은 행인지 확인하세요.

검증 규칙:
- items의 amount 합산값이 total과 10% 이상 차이 나면 다시 확인하세요.
- 고지서의 합계/청구금액란이 있으면 그 값을 total로 사용하세요.

기타 규칙:
- ym: 고지서 상단의 부과 연월 (예: "2025년 02월" → "2025-02")
- items: 항목명은 고지서 원문 그대로 (줄임 없이)
- 관리비 고지서가 아니거나 텍스트를 인식할 수 없는 경우: {"error": "고지서를 인식할 수 없어요"}
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
