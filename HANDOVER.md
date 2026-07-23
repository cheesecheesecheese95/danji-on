# DMC파크뷰자이 ON — 프로젝트 인수인계 문서

> 작성일: 2026-07-23 | 대상: 신규 담당자 (Claude 또는 개발자)

---

## 1. 프로젝트 개요

**DMC파크뷰자이 ON**은 서울 서대문구 DMC파크뷰자이 아파트(4,300세대) 입주민을 위한 통합 생활 플랫폼이다.
관리비 분석, 부동산 시세, 커뮤니티 시설 예약, AI 법률상담, 단지소식 등을 하나의 PWA 앱에서 제공한다.

- **URL**: https://www.dmcparkviewxion.com
- **GitHub**: git@github.com:cheesecheesecheese95/danji-on.git
- **배포**: Vercel (main 브랜치 push 시 자동 배포)
- **Google Analytics**: G-70WSQPNTTK

---

## 2. 기술 스택

| 구분 | 기술 |
|------|------|
| **프론트엔드** | Vanilla HTML/CSS/JS (빌드 없음, 정적 파일) |
| **PWA** | manifest.json + Service Worker (sw.js) |
| **차트** | Chart.js v4.4.0 (CDN) |
| **백엔드** | Vercel Serverless Functions (Node.js, /api 디렉토리) |
| **DB** | Supabase PostgreSQL (wiki_documents 테이블) |
| **캐시/설문** | Upstash Redis REST API |
| **AI** | Claude Haiku 4.5 (채팅), Claude Opus 4.6 (관리비 OCR) |
| **외부 API** | 국토부 실거래가, 호갱노노, 네이버 검색, 정보나루(도서관), 무비차트 |
| **배포** | Vercel + GitHub Actions |
| **도메인** | dmcparkviewxion.com (CNAME) |

---

## 3. 아키텍처

### 전체 구조
```
브라우저 (PWA)
  ├── index.html (SPA, 탭 기반 라우팅)
  ├── culture.html, faq.html, admin.html 등 (독립 페이지)
  └── /api/* (Vercel Functions)
        ├── claude.js — AI 채팅
        ├── extract-fee.js — 관리비 OCR (Claude Vision)
        ├── realestate-sync.js — 실거래 데이터 수집 (Cron)
        ├── hub-sync.js — 뉴스/시세분석/호갱노노 수집 (Cron)
        ├── notices-sync.js — 단지 공지사항 스크래핑 (Cron)
        ├── meeting-sync.js — 입대의 회의록 스크래핑 (Cron)
        ├── realestate.js — 실거래 데이터 조회
        ├── realestate-hub.js — 부동산 허브 통합 조회
        ├── library.js — 도서관 책 검색
        ├── survey.js — 설문조사 (Redis)
        ├── track.js — 이벤트 추적 (Redis)
        └── register.js — 입주민 인증 (Redis)
```

### 데이터 흐름
```
Cron 스케줄 (Vercel/GitHub Actions)
  → 외부 API 호출 (국토부, 호갱노노, 네이버 등)
  → Claude AI로 요약/분석 생성
  → Supabase wiki_documents 테이블에 캐싱
  → 프론트엔드에서 /api/* 호출하여 표시
```

### Cron 스케줄 (vercel.json)
| 시간(UTC) | 엔드포인트 | 주기 | 설명 |
|-----------|-----------|------|------|
| 22:00 | /api/realestate-sync | 매일 | 실거래 데이터 6~12개월치 수집 |
| 21:00 | /api/hub-sync?job=news | 매일 | 네이버 뉴스/블로그 수집 + AI 요약 |
| 21:00 | /api/hub-sync?job=daily-comment | 매일 | 시세 일일 브리핑 생성 |
| 21:15 | /api/hub-sync?job=hogangnono | 매일 | 호갱노노 매물/방문자 수집 |
| 21:30 일 | /api/hub-sync?job=weekly-insight | 매주 일 | 주간 시세 분석 (긍정2+신중2) |
| 22:00 일 | /api/notices-sync | 매주 일 | dmcpvx.com 공지사항 스크래핑 |
| 22:00 일 | /api/meeting-sync | 매주 일 | 입대의 회의록 스크래핑 |

### GitHub Actions
| 워크플로우 | 시간(KST) | 설명 |
|-----------|-----------|------|
| boxoffice.yml | 매일 09:00 | 영화 예매 순위 스크래핑 → boxoffice.json |
| culture.yml | 매월 26일 10:00 | 서대문마당 PDF → culture.html 자동 업데이트 |
| deploy.yml | push 시 | Vercel 자동 배포 |

---

## 4. 주요 의사결정과 이유

### 4-1. 빌드 도구 없는 순수 HTML/JS
- **이유**: 입주민 대상 서비스라 빠른 수정·배포가 핵심. 빌드 스텝 없이 파일 수정 → push → 즉시 반영.
- **트레이드오프**: index.html이 408KB로 비대하지만, gzip 압축 후 ~150KB로 모바일에서도 문제없음.

### 4-2. Supabase를 캐시 레이어로 사용
- **이유**: 국토부 API는 호출 제한이 있고 응답이 느림. wiki_documents 테이블에 일 1회 수집 후 캐싱하면 프론트엔드 응답 <200ms.
- **구조**: category 컬럼으로 데이터 타입 구분 (realestate_trade, news_feed_news 등).

### 4-3. 부동산 분석에 AI 양면 관점 적용
- **이유**: 매수/매도 추천은 법적 리스크. daily-comment는 팩트만, weekly-insight는 반드시 긍정 2개 + 신중 2개로 균형 유지.
- **원칙**: "투자 판단은 전문가 상담 권장" 면책 문구 필수 포함.

### 4-4. 관리비 OCR에 Claude Vision (Opus) 사용
- **이유**: 관리비 고지서는 25개 항목이 고정된 표 형식. Claude Vision이 OCR + 구조화를 한 번에 처리. 정확도 높음.
- **주의**: 반드시 "당월고지금액" 열만 읽도록 시스템 프롬프트에 명시.

### 4-5. 8개 단지 비교 체계
- **이유**: DMC파크뷰자이 단독 시세만으로는 맥락 부족. 인근 7개 단지(래미안, 센트럴파크, 에코자이 등)를 함께 수집해 비교 분석 제공.
- **데이터**: data/danji-master.js에 단지별 ID, 세대수, 호갱노노 해시, 법정동코드 정의.

### 4-6. Service Worker v2 — 자체 삭제 전략
- **이유**: PWA 캐시가 오래된 버전을 보여주는 문제 발생. sw.js가 설치 즉시 모든 캐시를 삭제하고 자신도 unregister. 항상 최신 버전 보장.

---

## 5. 파일 구조

```
danji-on/
├── index.html          # 메인 SPA (408KB) — 홈, 관리비, 커뮤니티, 생활편의, 주차, 단지소식 탭
├── admin.html          # 관리자 대시보드
├── culture.html        # 문화·행사 (월별 자동 업데이트)
├── dashboard.html      # 분석 대시보드
├── faq.html            # FAQ & 생활 가이드
├── law.html            # 관리규약·법률정보
├── clear.html          # 캐시 초기화 유틸리티
├── sw.js               # Service Worker
├── manifest.json       # PWA 매니페스트
├── vercel.json         # Cron 스케줄 + 리다이렉트
├── CNAME               # 커스텀 도메인
├── api/                # 12개 Vercel 서버리스 함수
├── data/               # 정적 데이터 (단지 마스터, 영화 순위 등)
├── scripts/            # Python 스크립트 (영화순위, 문화행사 자동화)
├── icons/              # PWA 아이콘 (12개)
└── .github/workflows/  # CI/CD (배포, 영화순위, 문화행사)
```

---

## 6. 환경변수 (Vercel Secrets)

```
ANTHROPIC_API_KEY         # Claude API
SUPABASE_SERVICE_KEY      # Supabase DB
NAVER_CLIENT_ID           # 네이버 검색 API
NAVER_CLIENT_SECRET       # 네이버 검색 API
REALESTATE_KEY            # 국토부 실거래 API
DATA4LIBRARY_KEY          # 정보나루 도서관 API
UPSTASH_REDIS_REST_URL    # Redis 엔드포인트
UPSTASH_REDIS_REST_TOKEN  # Redis 인증 토큰
DMCPVX_ID                 # dmcpvx.com 로그인 ID
DMCPVX_PW                 # dmcpvx.com 로그인 PW
VERCEL_TOKEN              # (GitHub Actions 배포용)
```

---

## 7. 현재 진행 상황 (2026-07-23 기준)

### 완료된 작업
- 관리비: 2025.01 ~ 2026.05 (17개월) 데이터 반영 완료
- 문화·행사: 2026년 7월 서대문마당 기반 업데이트 완료
- 부동산 허브: 일일 브리핑 + 주간 인사이트 + 호갱노노 자동 수집 가동 중
- 영화 예매순위: 매일 자동 갱신 중
- 입대의 회의록: 20건 이상 공개 완료

### 자동 운영 중인 기능
- 부동산 데이터 수집 (Vercel Cron, 매일)
- 뉴스 수집 + AI 요약 (매일)
- 영화 예매순위 (GitHub Actions, 매일)
- 공지사항/회의록 스크래핑 (매주 일)

---

## 8. 남은 과제

### 단기
- [ ] 관리비 6월분 업데이트 (PDF 입수 후 작업)
- [ ] 문화·행사 8월 업데이트 (서대문마당 8월호 발행 후)
- [ ] admin.html 보안 강화 — `ADMIN_SECRET` 하드코딩 제거 → 환경변수로 이전
- [ ] 공개 API 엔드포인트에 레이트 리미팅 추가 (claude, survey, track)

### 중기
- [ ] 광고 네트워크 연동 (애드센스/데이블 승인 대기 중)
- [ ] 커뮤니티 시설 실시간 예약 현황 연동 (관리사무소 API 확인 필요)
- [ ] 주차 방문차량 등록 기능
- [ ] 에너지 사용량 세대별 트래킹

### 장기
- [ ] 입주민 커뮤니티 게시판 (모더레이션 포함)
- [ ] 다국어 지원 (영어, 중국어)
- [ ] Capacitor로 네이티브 앱 래핑

---

## 9. 작업 시 지켜야 할 원칙

### 코드
1. **빌드 도구 사용 금지** — HTML/CSS/JS 직접 편집 → push → 배포. 프레임워크 도입 불필요.
2. **index.html 단일 파일 유지** — SPA 구조. 새 탭 추가 시 index.html 내부에 `<div class="fee-page">` 패턴으로.
3. **수정 시 feed + unmatched + 관리자 데이터 모두 갱신** — 데이터 변경은 관련된 모든 곳에 반영 후 배포.

### 데이터
4. **관리비 업데이트 체크리스트** — 총계, 세대당, 도넛 차트(3개 카테고리), 특이사항 notice, 세대당 주요 항목, 차트 배열(FM/FT/FP/FH/FE), 월별 테이블 행 추가, 전년 비교 섹션.
5. **부동산 AI 분석은 반드시 양면 관점** — weekly-insight는 긍정 2개 + 신중 2개. 매수/매도 추천 절대 금지.
6. **문화·행사는 서대문마당 PDF 기반** — https://sdmnews.info/pdf/YYYYMM.pdf 에서 추출. 기존 카드 포맷 유지.

### 배포
7. **main 브랜치에 직접 push** — PR/브랜치 전략 없음. push 즉시 Vercel 배포.
8. **커밋 전 반드시 `git pull --rebase`** — GitHub Actions가 매일 boxoffice.json을 커밋하므로 리모트와 충돌 빈번.

### 보안
9. **API 키는 Vercel 환경변수에만 저장** — 코드에 하드코딩 금지.
10. **입주민 개인정보 외부 미공개** — register.js의 입주민 데이터는 관리 목적으로만 사용.

### UX
11. **모바일 퍼스트** — 최대 너비 430px. 모든 UI는 모바일 기준으로 설계.
12. **네이비(#1B3A6B) 테마 일관성 유지** — 헤더, 강조색, 차트 모두 통일.

---

## 10. 핵심 데이터 참조

### 단지 기본 정보
- 세대수: 4,300세대 (정확히는 4,296세대 기준 산출)
- 준공: 2015년
- 주소: 서울 서대문구 가재울미래로 2
- 관리사무소: 02-931-8360
- 장기수선충당금: 매월 84,603,800원 고정 (세대당 19,675원)

### 비교 대상 단지 (data/danji-master.js)
1. DMC파크뷰자이 (홈) — 4,300세대
2. DMC래미안e편한세상 — 2,611세대
3. DMC센트럴파크 — 662세대
4. DMC에코자이 — 642세대
5. 가재울센트레빌 — 543세대
6. DMC파크뷰자이2차 — 1,245세대
7. 가재울뉴오피스텔 — 기타
8. 증산역롯데캐슬 — 기타

### 관리비 차트 데이터 (2025.01 ~ 2026.05)
```javascript
FM = ['25.01','25.02',...,'26.05']  // 월 레이블 (17개)
FT = [180.7,...,134.5]              // 총 관리비 (억원)
FP = [42.0,...,31.3]                // 세대당 평균 (만원)
FH = [15.2,...,3.3]                 // 난방비 (만원/세대)
FE = [9.1,...,6.7]                  // 전기료 (만원/세대)
```

---

*이 문서는 프로젝트의 전체 맥락을 담고 있습니다. 코드를 읽기 전에 이 문서를 먼저 참조하세요.*
