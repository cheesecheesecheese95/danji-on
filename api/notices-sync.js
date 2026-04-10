// Vercel 서버리스 함수 — dmcpvx.com 공지사항 스크래핑 → Supabase upsert
// Cron: 매일 07:00 KST (22:00 UTC) 자동 실행

export const config = { maxDuration: 30 };

const SB_URL    = 'https://svifbukyvyrtqzhbatvm.supabase.co';
const SB_KEY    = process.env.SUPABASE_SERVICE_KEY;
const DMCPVX_ID = process.env.DMCPVX_ID;
const DMCPVX_PW = process.env.DMCPVX_PW;

export default async function handler(req, res) {
  // cron 또는 수동 호출 모두 허용
  try {
    // 1. dmcpvx.com 로그인
    const loginRes = await fetch('https://dmcpvx.com/comExec/procLogin.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://dmcpvx.com/',
        'User-Agent': 'Mozilla/5.0',
      },
      body: `tbID=${encodeURIComponent(DMCPVX_ID)}&tbPWD=${encodeURIComponent(DMCPVX_PW)}`,
      redirect: 'follow',
    });

    const cookie = loginRes.headers.get('set-cookie') || '';
    const sessionCookie = cookie.split(';')[0];

    // 2. 공지사항 페이지 가져오기
    const pageRes = await fetch('https://dmcpvx.com/controlOffice/page.apt?codeSeq=64', {
      headers: {
        'Cookie': sessionCookie,
        'Referer': 'https://dmcpvx.com/',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    const html = await pageRes.text();

    // 3. 공지사항 파싱
    const notices = [];
    const re = /LinkBoard\(\s*"(\d+)",\s*"64"[^)]+\)[^>]*>\s*(?:<img[^>]+>\s*)?([\s\S]*?)(?:<span[^>]*>[\s\S]*?<\/span>\s*)?<\/a>/gi;
    const dateRe = /(\d{4}-\d{2}-\d{2})/g;
    const dates = [...html.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map(m => m[1]);

    let m, idx = 0;
    while ((m = re.exec(html)) !== null) {
      const bSeq  = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (title.length > 2) {
        notices.push({
          category:   'notice',
          title,
          summary:    dates[idx] || '',
          body:       `https://dmcpvx.com/controlOffice/page.apt?codeSeq=64&bSeq=${bSeq}&do=view`,
          is_featured: false,
          view_count:  0,
          status:     'published',
        });
        idx++;
      }
    }

    if (!notices.length) {
      return res.status(200).json({ message: '파싱된 공지사항 없음' });
    }

    // 4. 기존 notice 삭제 후 재삽입 (upsert 대신)
    await fetch(`${SB_URL}/rest/v1/wiki_documents?category=eq.notice`, {
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
      body: JSON.stringify(notices),
    });

    const status = insertRes.status;
    return res.status(200).json({
      message: `완료: ${notices.length}개 공지사항 동기화`,
      insertStatus: status,
    });

  } catch (err) {
    console.error('[notices-sync]', err);
    return res.status(500).json({ error: err.message });
  }
}
