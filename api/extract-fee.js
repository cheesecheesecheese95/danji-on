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
당신은 아파트 관리비 고지서 이미지를 분석하는 전문가입니다.
이미지에서 관리비 항목과 금액을 추출해 JSON으로만 응답하세요.

응답 형식 (JSON만, 설명 없이):
{
  "ym": "YYYY-MM",
  "items": [
    {"name": "항목명", "amount": 숫자},
    ...
  ],
  "total": 숫자
}

규칙:
- ym: 고지서에 표시된 부과 연월 (없으면 현재 연월)
- items: 금액이 0원 이상인 모든 항목 (이름은 고지서 원문 그대로)
- amount: 원 단위 정수 (쉼표 제거, 숫자만)
- total: 모든 항목 합계 (고지서의 합계란 기준, 없으면 items 합산)
- 항목이 없거나 고지서가 아닌 경우: {"error": "고지서를 인식할 수 없어요"}
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

    // total 없으면 합산
    if (!parsed.total && parsed.items) {
      parsed.total = parsed.items.reduce((s, i) => s + (i.amount || 0), 0);
    }

    return res.json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
