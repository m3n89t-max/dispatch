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

### 모델 규칙
- MATNR startswith `AR` → 벽걸이 (1)
- MATNR startswith `AF` + 끝 영문 3자리 → 홈멀티 (2)
- MATNR startswith `AF` → 스탠드 (1)
- MATNR startswith `AC` → 시스템에어컨 (1, 별도 표기)

### 예외
- AUGRU = ZL4 → 사전방문 → 설치대수 제외

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
```bash
node -e "
const { judgeModelType, getInstallCount } = require('./src/lib/modelJudge');
const cases = [
  ['AR12345', undefined, 'WALL_MOUNT', 1],
  ['AF12345', undefined, 'STAND', 1],
  ['AF123ABC', undefined, 'HOME_MULTI', 2],
  ['AC12345', undefined, 'SYSTEM_AC', 1],
  ['AR12345', 'ZL4', 'PRE_VISIT', 0],
];
let pass = true;
for (const [matnr, augru, expectedType, expectedCount] of cases) {
  const type = judgeModelType(matnr, augru);
  const count = getInstallCount(type);
  const ok = type === expectedType && count === expectedCount;
  console.log(ok ? 'PASS' : 'FAIL', matnr, augru, '->', type, count);
  if (!ok) pass = false;
}
console.log(pass ? '모든 케이스 통과' : '실패 케이스 있음');
"
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
