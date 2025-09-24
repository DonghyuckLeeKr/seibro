## Seibro 채권 정보 조회 서비스 - PRD

### 목적
- `Guide_Bond.md`에 정의된 8개 Open API를 하나의 웹 UI에서 손쉽게 조회할 수 있게 한다.
- 검색 파라미터 입력 → 서버 프록시를 통해 Seibro OpenPlatform 호출 → 표 형태로 결과 표시.

### 대상 API (8)
1) 채권 발행내역: `getBondIssuInfo` (ISSU_DT?, ISSUCO_CUSTNO?)
2) 채권 종목 정보: `getBondStatInfo` (ISIN)
3) 이자지급 정보: `getIntPayInfo` (ISIN)
4) 조기상환 정보: `getBondOptionXrcInfo` (ISIN?, ERLY_RED_DT?)
5) 단기금융증권 발행내역: `getShortmIssuInfo` (ISSU_DT, SECN_TPCD)
6) CD 종목 정보: `getCDInfo` (ISIN)
7) CP 종목 정보: `getCPInfo` (ISIN)
8) 전자단기사채 종목 정보: `getESTBInfo` (ISIN)

참고: `Guide_Bond.md`의 각 섹션 표를 기준으로 파라미터(required/optional)와 설명을 표시한다.

### 핵심 요구사항
- 모든 API를 UI에서 탭/사이드바로 전환하며 조회 가능
- 입력 검증(필수 파라미터, 날짜 YYYYMMDD 형식 등)
- 서버 라우트에서 OpenPlatform 요청 프록시 (API 키는 서버만 접근)
- 요청/응답 로깅(브라우저 콘솔 최소화, 서버에서 안전한 로그)
- 실패 시 명확한 에러메시지 표현

### 아키텍처
- Next.js 14 App Router, TypeScript, React Server Actions 미사용(명시적으로 API 라우트 사용)
- API 라우트 `/api/seibro`가 공통 엔드포인트. `apiId`와 `params`를 받아 Seibro로 전달.
- 환경변수: `SEIBRO_API_KEY`, `SEIBRO_BASE_URL`(기본값 `https://seibro.or.kr/OpenPlatform/callOpenAPI.jsp`)

### 보안/운영
- API Key는 서버 환경변수로만 보관. 클라이언트에 노출 금지.
- 타임아웃/재시도(간단한 1회 재시도) 구현.
- CORS는 Next API 라우트로 종단.

### UX 가이드
- 좌측 네비게이션(8개 API) + 우측 콘텐츠 영역
- 각 API별 카드: 설명, 파라미터 폼, 샘플 링크, 결과 테이블
- 로딩 스피너, 빈 상태, 에러 상태

### 성공 기준
- 8개 API 모두 폼으로 호출 가능
- 정상/에러 응답을 시각적으로 구분
- README 및 .env 템플릿 제공

### 범위 밖
- 캐싱/인증 사용자 관리, 데이터 영속화, 고급 차트


