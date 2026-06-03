---
name: validate
description: 코드 변경 후 타입체크 → 도메인 로직 검증 → 빌드 확인을 순서대로 실행하는 스킬
---

# 코딩 후 검증 스킬

CLAUDE.md에 정의된 3단계 검증 파이프라인을 순서대로 실행한다.

## 1단계 — 타입 체크

```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
node node_modules/typescript/bin/tsc --noEmit
```

에러 0개 확인 후 2단계 진행. 에러가 있으면 먼저 수정한다.

## 2단계 — 도메인 로직 검증 (모델 판정)

```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
node -e "
const { judgeModelType, getInstallCount } = require('./src/lib/modelJudge');
const cases = [
  ['ARWT',   undefined, 'WALL_MOUNT', 1],
  ['AF09GT', undefined, 'STAND',      1],
  ['AFWRS',  undefined, 'HOME_MULTI', 1],
  ['AC12345',undefined, 'SYSTEM_AC',  1],
  ['ARWT',   'ZL4',     'PRE_VISIT',  0],
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

모든 케이스 PASS 확인 후 3단계 진행.

## 3단계 — 빌드 확인

```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
$env:DATABASE_URL = "file:./prisma/dispatch.db"
node node_modules/next/dist/bin/next build
```

빌드 에러 없는지 확인. 에러가 있으면 수정 후 1단계부터 재실행.

## 모든 단계 한번에

```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
node node_modules/typescript/bin/tsc --noEmit
# 위 성공 시:
$env:DATABASE_URL = "file:./prisma/dispatch.db"
node node_modules/next/dist/bin/next build
```

## 도메인 규칙 (검증 기준)

| MATNR 패턴 | ModelType | 설치대수 | 비고 |
|-----------|-----------|---------|------|
| AR로 시작 | WALL_MOUNT | 1 | 벽걸이 |
| AF로 시작 + W로 시작하는 suffix (WRS, WN 등) | HOME_MULTI | 1 | 홈멀티 (행당 1대) |
| AF로 시작 | STAND | 1 | 스탠드 |
| AC로 시작 | SYSTEM_AC | 1 | 시스템에어컨 (별도 표기) |
| AUGRU = ZL4 | PRE_VISIT | 0 | 사전방문 제외 |
