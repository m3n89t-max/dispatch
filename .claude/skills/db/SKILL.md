---
name: db
description: SQLite DB 스키마 push, 초기화, Prisma generate 등 데이터베이스 관리 스킬
---

# DB 관리 스킬

## 환경 정보

- DB 엔진: SQLite (libsql 어댑터)
- DB 파일: `prisma/dispatch.db`
- 어댑터: `@prisma/adapter-libsql` + `@libsql/client`
- Prisma 버전: 7.x (Rust 엔진 제거됨 — 반드시 driver adapter 사용)

`.env` 내용:
```
DATABASE_URL="file:./prisma/dispatch.db"
NEXTAUTH_SECRET="dispatch-secret-key-change-in-production"
```

## Prisma Generate (클라이언트 재생성)

스키마 변경 후 반드시 실행:
```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
$env:DATABASE_URL = "file:./prisma/dispatch.db"
node node_modules/prisma/build/index.js generate
```

## 스키마 DB 반영 (마이그레이션 없이)

```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
$env:DATABASE_URL = "file:./prisma/dispatch.db"
node node_modules/prisma/build/index.js db push --schema ./prisma/schema.prisma
```

## DB 초기화 (전체 삭제 후 재생성)

```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
Remove-Item "prisma\dispatch.db" -ErrorAction SilentlyContinue
$env:DATABASE_URL = "file:./prisma/dispatch.db"
node node_modules/prisma/build/index.js db push --schema ./prisma/schema.prisma
node node_modules/prisma/build/index.js generate
```

## Prisma Studio (GUI)

```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
$env:DATABASE_URL = "file:./prisma/dispatch.db"
npm run db:studio
```
→ http://localhost:5555 에서 데이터 확인

## 스키마 위치

`prisma/schema.prisma` — 주요 모델:

| 모델 | 용도 |
|------|------|
| Driver | 기사/팀 정보 |
| WorkDate | 작업일 (date: "YYYY-MM-DD") |
| DeliverySession | 업로드 세션 (PREV_DELIVERY / SAME_DAY_DELIVERY) |
| DeliveryRecord | 개별 배송건 |
| DispatchUpload | 전일 배차 업로드 원본 |
| Dispatch | 배차 항목 |

## UploadType enum

```
DISPATCH          // 전일배차 (실적분석용)
CONFIRM           // 납기확정
COMPLETE          // 설치완료
PREV_DELIVERY     // 전일 납기
SAME_DAY_DELIVERY // 당일 납기
```

## 흔한 문제

| 증상 | 해결 |
|------|------|
| `Using engine type "client" requires adapter` | prisma.ts에서 PrismaLibSql 어댑터 사용 확인 |
| `provider mismatch` | schema.prisma provider = "sqlite" 확인 |
| `P3005` table already exists | `--force-reset` 추가 (주의: 데이터 삭제) |
