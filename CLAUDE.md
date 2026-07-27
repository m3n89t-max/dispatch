# CLAUDE.md

## 프로젝트 개요
제주 물류센터 가전/에어컨 설치 배차 자동화 시스템.
전일 배차 기준으로 실적, 납기방어력, 순환배차, 권역균형을 반영한다.

---

## 핵심 도메인 규칙

### 설치대수 산정
- 설치대수는 **실내기 기준**
- 벽걸이 = 1
- 스탠드 = 1
- 홈멀티 = 2
- 시스템에어컨 = 1 (설치대수 포함, **"시스템"으로 별도 표기**)

### 모델구분 (UNCOB 모델군 기반 — 품번 패턴 파싱 폐기)
ZRLEJ56700 리포트의 **UNCOB(모델군)** 컬럼 접두사로 판별. 구현: [src/lib/modelJudge.ts](src/lib/modelJudge.ts) `classifyUncob` + `resolveModelType`.
- `RAC*` → 벽걸이(1)
- `PAC*` → 업소용(1)
- `HMRAC*` → 홈멀티 마커(1)
- `HMPAC(S)*` → **같은 고객(Delivery)에 HMRAC 있으면 홈멀티, 없으면 스탠드** (1)
- `SYSS4W*` → 4웨이 시스템(1) / `SYSS2W*` → 원웨이 시스템(1)
- `LAIR*` → 이전설치(이사, L-MAIR) (1)
- 그 외(`ACO*`, `ACDAE`, `TACOPTI` 등) → 실외기·부속 = 제외(0)
- 실내기 1대당 카운팅 마커 UNCOB가 1개뿐 → 동일 실내기 중복 SKU 카운트 문제 자동 해소

### 예외
- SO Reason = ZL4 → 사전방문 → 설치대수 제외 (UNCOB보다 우선)

---

## ZRLEJ56700 데이터 / 자동화 / UI (2026-06 전환 요약)

### 파일 포맷 (중요)
SAP "스프레드시트 export(EXDL)"는 확장자만 .xlsx인 **MHTML(HTML)** 인 경우가 많음 → ExcelJS는 `Can't find end of central directory`로 실패. 파서 [delivery/upload/route.ts](src/app/api/delivery/upload/route.ts) `bufferToMatrix`가 **zip(PK)=진짜 xlsx / MHTML·HTML 표 / TSV·CSV** 를 자동 판별해 행렬로 변환 후 동일 로직 처리.

### ZRLEJ56700 컬럼 (헤더명 기준 파싱 — [delivery/upload/route.ts](src/app/api/delivery/upload/route.ts))
| 컬럼 | 용도 |
|------|------|
| Route | 601 서귀포 / 602 제주시 |
| Material | 모델명(표시용) |
| **UNCOB** | 모델군 → 설치대수 판정 |
| SO Reason | ZL4 = 사전방문 제외 |
| SalesDLTime | 고객요청일(YYYY-MM-DD) → 과거=연기, 미래=선설치 |
| ShipToPostalCode | 우편번호 → ABCD 구역 ([zipcodeRegion.ts](src/lib/zipcodeRegion.ts)) |
| ShipToAddress | 배달주소 |
| Vehicle Number(Full) | 차량번호 → 기사 매칭 |
| Freight Order | 배차(Delivery) 단위 키 |
| ShipToPartyName | 고객명(마스킹) |

### SAP 자동 다운로드
- 트랜잭션 **ZRLEJ56700** (기존 ZRLEK51270 폐기)
- 선택화면: `S_RWERKS-LOW`(플랜트, 기본 **L106**) + `S_CARCD-LOW`(**CA06E**), 날짜 파라미터 없음
- export: ALV toolbar **EXDL** → 저장 → 덮어쓰기 항상 "예"
- **저장/감시 폴더 = `C:\temp`** (보안 PC DRM 예외 임시경로 — 바탕화면 폴더는 DRM 암호화됨), 파일명 **`ZRLEJ56700.xlsx` 고정**, VBS는 저장 다이얼로그에 전체 경로 직접 입력
- 스크립트: VBS 생성기 [add-vbs-method.js](scripts/add-vbs-method.js)(주), ps1/watcher는 [rebuild-standalone-full.js](scripts/rebuild-standalone-full.js)가 생성. import 경로 [sap/import/route.ts](src/app/api/sap/import/route.ts)는 body.plant/carrierCode.
- USB 배포: `next build` → `node scripts/rebuild-standalone-full.js` → `node scripts/add-vbs-method.js` → `.next/standalone/.../dispatch` 를 USB(`D:\제주배차시스템_standalone_20260605`)로 robocopy `/E`

### 업로드 탭 UI ([upload/page.tsx](src/app/upload/page.tsx))
- 전일/당일 토글·비교탭 제거 (단일 업로드)
- 결과 = 2단: 좌(📊 대시보드 + 🚚 기사별 요약) / 우(🗺 구역 분포 + 지도, 항시 표시)
- 대시보드: 차량투입(팀)·배송(건)·설치(대)·연기·선설치 / 모델별 / 구역별(A~E)
- 날짜 = 컴퓨터 날짜 기준 자동(진입 시 오늘 자동 조회)
- 과거 날짜 구역/지도: [compare/route.ts](src/app/api/delivery/compare/route.ts)가 저장 region으로 재구성 (단, 연기/선설치는 업로드 시점만)

---

## 인력 구성

### 셀 (Cell)
- **셀** = 주기사(팀장)들의 군집 단위
- 예) 명성셀 → 명성셀 소속 주기사 팀이 10개 존재
- 셀 단위로 권역 배정, 실적 집계, 배차 관리 가능

### 팀 구성
- **1팀 = 주기사(팀장) 1인 + 전문기사(보조인력) 1인 → 2인 1조**
- **주기사 (팀장)** : 배차 대상, 실적 점수 산정 기준, 권역 배정 주체
- **전문기사 (보조인력)** : 주기사 팀에 소속, 배차 점수 미산정, 주기사 지원 역할

---

## 배차 핵심 원칙

### 기본
- 전일 배차 시스템
- 실적 기반 우선배차

### 저물량
- 최소 배차량 보장 (2~3대)
- 순환배차 적용
- 미배차 팀 우선

### 추가배차
- 실적 우수자 추가 배차 허용

---

## 권역 규칙
- ROUTE 0601 = 서귀포
- ROUTE 0602 = 제주시

### 중요
- 특정 권역 쏠림 금지
- 권역별 배차 비율 유지

---

## 안전/근무
- 연속 7일 이상 근무 → 경고
- 안전위반 → 배차정지 가능
- 계약종료 → 배차 불가

---

## 구현 규칙
- 점수 계산은 서버에서만 수행
- 업로드 원본 반드시 저장
- 배차 결과는 재현 가능해야 함
- 모델 판정 실패는 UNKNOWN 처리 후 수동 보정

---

## 코딩 후 검증 프로세스

코드 변경 후 반드시 아래 순서대로 검증한다.

### 1단계 — 타입 체크
```bash
node node_modules/typescript/bin/tsc --noEmit
```
- 에러 0개 확인 후 다음 단계 진행

### 2단계 — 도메인 로직 검증 (모델 판정)

CLAUDE.md의 2단계는 참고용입니다. 실제 검증은 `/validate` 스킬을 사용하세요 (TypeScript 파일이라 ts-node 필요).

```bash
# validate 스킬 케이스 (UNCOB 모델군 기반, classifyUncob + resolveModelType)
# HMPACS18 (단독)      → STAND (1)        스탠드
# HMPACS18 + HMRAC     → HOME_MULTI (1)   같은 고객에 HMRAC 동반 시 홈멀티
# HMRAC                → HOME_MULTI (1)   홈멀티 실내기 마커
# RAC10 / RAC6         → WALL_MOUNT (1)   벽걸이
# PAC*                 → COMMERCIAL (1)   업소용
# SYSS4W               → SYSTEM_4WAY (1)  4웨이 시스템
# SYSS2W               → SYSTEM_1WAY (1)  원웨이 시스템
# ACDAE/ACOPTI/ACOR*   → UNKNOWN (0)      실외기/부속 제외
# (UNCOB 무관) ZL4     → PRE_VISIT (0)    사전방문 (SO Reason)
```

### 3단계 — 빌드 확인
```bash
node node_modules/next/dist/bin/next build
```
- 빌드 에러 없는지 확인

### 4단계 — GitHub Push
```bash
git add -A
git commit -m "feat: 변경 내용 요약"
git push origin main
```

---

## GitHub 저장소
- Remote: https://github.com/m3n89t-max/dispatch.git
- Branch: main

### 최초 연결 (저장소 초기화 시)
```bash
cd "c:\Users\문인성\Desktop\Dispatch"
git init
git remote add origin https://github.com/m3n89t-max/dispatch.git
git branch -M main
git add -A
git commit -m "init: 제주 배차 자동화 시스템 초기 구성"
git push -u origin main
```

### 이후 push
```bash
git add -A
git commit -m "feat|fix|refactor: 변경 내용"
git push origin main
```

### .gitignore 필수 항목
```
node_modules/
.next/
.env
*.log
```

---

## oh-my-claudecode (OMC) 실행 지침

### 언제 어떤 명령을 쓸지

| 상황 | 명령 | 설명 |
|------|------|------|
| 복잡한 기능 개발 | `/team "기능 설명"` | 계획→설계→실행→검증 파이프라인 자동 실행 |
| 빠른 단순 작업 | 직접 대화 | 파일 1~2개 수정, 단순 질문 등 |
| 대규모 리팩토링 | `/ultrawork "작업 설명"` | 병렬 에이전트로 빠르게 처리 |
| 지속 자동화 작업 | `ralph` | 반복 작업, 모니터링 |
| 버그 분석 | `debugger` 에이전트 위임 | 복잡한 버그 추적 |
| 코드 리뷰 | `code-reviewer` 에이전트 위임 | PR/커밋 검토 |

### 이 프로젝트 전용 워크플로

**새 기능 추가 시:**
```
/team "배차 로직에 [기능명] 추가해줘"
```
→ planner → architect → executor → verifier 순으로 자동 진행

**버그 수정 시:**
```
debugger에게 위임: [증상 설명]
```

**검증 포함 전체 작업 시:**
```
/autopilot "[작업 내용] — 타입체크·빌드 포함 검증까지"
```

### 에이전트 역할 참조

| 에이전트 | 역할 |
|---------|------|
| `planner` | 작업을 단계로 분해, 우선순위 결정 |
| `architect` | 스키마·API 설계, 파일 구조 결정 |
| `executor` | 실제 코드 작성·수정 (복잡한 작업은 `model=opus`) |
| `verifier` | 타입체크·빌드·동작 검증 |
| `code-reviewer` | 코드 품질·보안 리뷰 |
| `debugger` | 버그 원인 추적 |
| `explore` | 코드베이스 파일/심볼 탐색 |

### 모델 선택 기준

- **haiku** — 단순 검색, 파일 읽기
- **sonnet** — 일반 코딩, 수정
- **opus** — 복잡한 배차 로직, 스키마 설계, 아키텍처 결정

### 주의사항
- 검증(`/validate`)은 항상 코드 변경 후 실행
- DB 스키마 변경 시 `/db` 스킬로 push 필수
- OMC 작업 중단: `/oh-my-claudecode:cancel`
