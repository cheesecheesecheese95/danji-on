// Vercel 서버리스 함수 — openapt.seoul.go.kr 회의록 스크래핑 → Supabase upsert
// Cron: 매주 일요일 07:00 KST (22:00 UTC)

export const config = { maxDuration: 30 };

const SB_URL = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const BOARD_URL = 'https://openapt.seoul.go.kr/boardForm/selectBoardList.do';
const APT_CODE  = 'A10027817';
const BBS_CODE  = '02'; // 입주자대표회의 회의록

export default async function handler(req, res) {
  try {
    // 1. 회의록 목록 페이지 가져오기 (POST 방식)
    const listRes = await fetch(BOARD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; DanjiOn-Bot/1.0)',
        'Referer': `https://openapt.seoul.go.kr/openApt/index.do?aptCode=${APT_CODE}`,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      body: `aptCode=${APT_CODE}&bbsCommCode=${BBS_CODE}&pageIndex=1&pageUnit=20`,
    });

    if (!listRes.ok) {
      return res.status(200).json({ message: `사이트 응답 오류: ${listRes.status}` });
    }

    const html = await listRes.text();

    // 서버 재시작 중인 경우
    if (html.includes('서버를 재시작') || html.includes('서버 재시작 중')) {
      return res.status(200).json({ message: '서울시 서버 재시작 중 — 다음 주에 재시도' });
    }

    // 2. 회의록 항목 파싱
    // egovframe 게시판 HTML 패턴:
    // <td class="title"><a href="javascript:goView('boardSeq','bbsCommCode','aptCode')">제목</a></td>
    // <td>2026-03-24</td>
    // 또는 onclick="selectBoardView(...)"
    const meetings = [];

    // 패턴 1: onclick="goView('숫자',...)"
    const viewRe1 = /goView\(['"](\d+)['"]\s*,\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\)/g;
    // 패턴 2: selectBoardView.do 직접 링크
    const viewRe2 = /selectBoardView\.do\?[^"']+boardSeq=(\d+)[^"']*/g;
    // 제목 파싱
    const titleRe = /class="title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/gi;
    // 날짜 파싱: YYYY-MM-DD or YYYY.MM.DD
    const dateMatches = [...html.matchAll(/(\d{4}[-\.]\d{2}[-\.]\d{2})/g)].map(m => m[1].replace(/\./g, '-'));

    let titleMatch;
    const titles = [];
    while ((titleMatch = titleRe.exec(html)) !== null) {
      const t = titleMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (t.length > 2 && (t.includes('회의록') || t.includes('결과') || t.includes('회의'))) {
        titles.push(t);
      }
    }

    // boardSeq 추출
    const seqs = [];
    let m1;
    while ((m1 = viewRe1.exec(html)) !== null) seqs.push(m1[1]);
    if (!seqs.length) {
      let m2;
      while ((m2 = viewRe2.exec(html)) !== null) seqs.push(m2[1]);
    }

    // 제목·날짜·링크 결합
    const count = Math.max(titles.length, seqs.length);
    for (let i = 0; i < count; i++) {
      const title = titles[i] || `회의록 ${i + 1}`;
      const seq   = seqs[i];
      const date  = dateMatches[i] || '';
      const body  = seq
        ? `https://openapt.seoul.go.kr/boardForm/selectBoardView.do?aptCode=${APT_CODE}&bbsCommCode=${BBS_CODE}&boardSeq=${seq}`
        : `https://openapt.seoul.go.kr/openApt/aMenu/aptLeaderMeeting/leaderMeetingList.open?aptCode=${APT_CODE}`;

      meetings.push({
        category:    'meeting',
        title,
        summary:     date,
        body,
        is_featured: false,
        view_count:  0,
        status:      'published',
      });
    }

    if (!meetings.length) {
      // 파싱 실패 — HTML 일부를 로그로 남김
      console.error('[meeting-sync] 파싱 실패. HTML 샘플:', html.substring(0, 500));
      return res.status(200).json({ message: '파싱된 회의록 없음 (HTML 구조 확인 필요)' });
    }

    // 3. 기존 meeting 삭제 후 재삽입
    await fetch(`${SB_URL}/rest/v1/wiki_documents?category=eq.meeting`, {
      method: 'DELETE',
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Prefer': 'return=minimal',
      },
    });

    const insertRes = await fetch(`${SB_URL}/rest/v1/wiki_documents`, {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(meetings),
    });

    return res.status(200).json({
      message: `완료: ${meetings.length}개 회의록 동기화`,
      insertStatus: insertRes.status,
    });

  } catch (err) {
    console.error('[meeting-sync]', err);
    return res.status(500).json({ error: err.message });
  }
}
