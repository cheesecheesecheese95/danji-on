#!/usr/bin/env python3
"""
매월 26일 실행: 서대문마당 최신호 PDF → culture.html 자동 업데이트
"""
import os, re, sys, json, tempfile, textwrap
import requests
from bs4 import BeautifulSoup
from pdfminer.high_level import extract_text

BASE = "https://www.sdm.go.kr"
LIST_URL = f"{BASE}/news/media/madang.do"
ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]
CULTURE_HTML = os.path.join(os.path.dirname(__file__), "../culture.html")

# ── 1. 최신 PDF URL 찾기 ─────────────────────────────────────────
def find_latest_pdf():
    r = requests.get(LIST_URL, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/fileUpload/board/92/" in href and href.endswith(".pdf"):
            return BASE + href if href.startswith("/") else href
    raise RuntimeError("PDF 링크를 찾지 못했습니다.")

# ── 2. PDF 다운로드 & 텍스트 추출 ───────────────────────────────
def extract_pdf_text(pdf_url):
    r = requests.get(pdf_url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(r.content)
        tmp = f.name
    text = extract_text(tmp)
    os.unlink(tmp)
    return text.strip(), pdf_url

# ── 3. Claude API로 HTML 섹션 생성 ──────────────────────────────
SYSTEM_PROMPT = """
당신은 서울 서대문구 DMC파크뷰자이 아파트(남가좌동) 입주민 앱의 HTML 생성기입니다.
서대문마당 소식지 텍스트를 받아 입주민에게 실질적으로 도움 되는 콘텐츠를 추출하고,
정해진 HTML 포맷으로 출력합니다.

[선택 기준]
- 포함: 새로 출시되는 서비스, 행사, 체육 프로그램, 시설, 자연·산책, 아이·가족 관련 내용
- 포함: 생활 편의 신규 서비스 (신청 방법, 문의처 있는 것)
- 제외: 구의원 의정 활동, 구정홍보단, 재개발·재건축 사업, 서울서베이 통계, 일반 행정 홍보

[HTML 포맷 규칙]
- 섹션 구분: <div class="sub-sec-label">🔤 섹션명</div>
- 각 항목은 <a class="card" href="PDF_URL#page=N" target="_blank" rel="noopener"> 태그로 감싸기
  (PDF_URL은 실제 PDF URL로 대체, N은 해당 내용이 있는 페이지 번호)
- 카드 내부 구조:
  <div style="font-size:13px;font-weight:700;color:var(--gray-800);margin-bottom:4px;">제목</div>
  <div style="font-size:12px;color:var(--gray-600);line-height:1.7;">내용 요약 (2~3줄)</div>
  <div style="margin-top:6px;font-size:11px;color:var(--gray-400);">문의 부서명 ☎ 전화번호</div>
- 신규 오픈 예정인 경우 제목 옆에:
  <span style="font-size:10px;font-weight:700;color:var(--green);background:var(--green-bg);padding:1px 6px;border-radius:10px;margin-left:4px;">YYYY.MM 오픈 예정</span>
- 공연/행사 일정표가 있으면 <table> 포함 가능
- 섹션 아이콘 예시: 🌸 축제, 🏃 체육·스포츠, 🌿 자연·산책, 👶 아이·가족, 🆕 신규 서비스
- 마지막에 출처 표시:
  <div style="text-align:center;margin-top:12px;font-size:11px;color:var(--gray-400);">출처: 서대문마당 YYYY년 N월호 (VOL.XXX)</div>

[중요] HTML 코드만 출력. 설명 텍스트 없이 순수 HTML만.
""".strip()

def generate_html(pdf_text, pdf_url):
    # 토큰 절약: 텍스트 앞 8000자만 사용 (소식지 주요 내용은 앞부분에 집중)
    trimmed = pdf_text[:9000]
    payload = {
        "model": "claude-opus-4-6",
        "max_tokens": 4000,
        "system": SYSTEM_PROMPT,
        "messages": [{
            "role": "user",
            "content": f"PDF URL: {pdf_url}\n\n아래는 서대문마당 소식지 텍스트입니다:\n\n{trimmed}"
        }]
    }
    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=payload,
        timeout=60,
    )
    r.raise_for_status()
    return r.json()["content"][0]["text"].strip()

# ── 4. culture.html 내용 교체 ────────────────────────────────────
MARKER_START = "<!-- CULTURE_CONTENT_START -->"
MARKER_END   = "<!-- CULTURE_CONTENT_END -->"

def update_culture_html(new_content):
    with open(CULTURE_HTML, "r", encoding="utf-8") as f:
        html = f.read()

    if MARKER_START not in html or MARKER_END not in html:
        raise RuntimeError(f"마커를 찾지 못했습니다: {MARKER_START}")

    pattern = re.compile(
        re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END),
        re.DOTALL
    )
    replaced = pattern.sub(
        f"{MARKER_START}\n{new_content}\n{MARKER_END}",
        html
    )
    with open(CULTURE_HTML, "w", encoding="utf-8") as f:
        f.write(replaced)
    print("culture.html 업데이트 완료")

# ── 메인 ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("1. 최신 PDF URL 탐색 중...")
    pdf_url = find_latest_pdf()
    print(f"   → {pdf_url}")

    print("2. PDF 텍스트 추출 중...")
    pdf_text, _ = extract_pdf_text(pdf_url)
    print(f"   → {len(pdf_text)}자 추출")

    print("3. Claude API로 HTML 생성 중...")
    new_html = generate_html(pdf_text, pdf_url)
    print(f"   → {len(new_html)}자 생성")

    print("4. culture.html 업데이트 중...")
    update_culture_html(new_html)

    print("완료!")
