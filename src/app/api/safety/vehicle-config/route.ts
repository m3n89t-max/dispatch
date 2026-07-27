import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 차량별 능력치 설정 — 가능 대수(capacity) + 선호 모델(models). 자동 균등배차가 참조.
// 공유 DB(23.20.121.23)에 저장 → 여러 PC 공유. Prisma 스키마 변경 없이 raw 테이블 사용.

function isBusy(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)) || ''
  return /SQLITE_BUSY|database is locked|database table is locked|\bcode\b.*\b5\b/i.test(m)
}
async function withRetry<T>(fn: () => Promise<T>, tries = 7): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) {
      lastErr = e
      if (!isBusy(e)) throw e
      await new Promise(r => setTimeout(r, 50 * Math.pow(2, i)))
    }
  }
  throw lastErr
}

let ensuredOnce = false
async function ensureTable() {
  if (ensuredOnce) return
  await withRetry(() => prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "VehicleConfig" (vehicleNo TEXT PRIMARY KEY, maxCount INTEGER, models TEXT, lowOnly INTEGER, active INTEGER, region TEXT, updatedAt TEXT)`,
  ))
  // lowOnly(저층 전용) / active(가동 여부) / region(담당 구역) 컬럼 — 기존 테이블엔 없을 수 있어 ALTER (이미 있으면 에러 무시)
  try { await prisma.$executeRawUnsafe(`ALTER TABLE "VehicleConfig" ADD COLUMN lowOnly INTEGER`) } catch { /* 이미 존재 */ }
  try { await prisma.$executeRawUnsafe(`ALTER TABLE "VehicleConfig" ADD COLUMN active INTEGER`) } catch { /* 이미 존재 */ }
  try { await prisma.$executeRawUnsafe(`ALTER TABLE "VehicleConfig" ADD COLUMN region TEXT`) } catch { /* 이미 존재 */ }
  try { await prisma.$executeRawUnsafe(`ALTER TABLE "VehicleConfig" ADD COLUMN modelsOnly INTEGER`) } catch { /* 이미 존재 */ }
  try { await prisma.$executeRawUnsafe(`PRAGMA busy_timeout=8000`) } catch { /* noop */ }
  ensuredOnce = true
}

// GET: { configs: { [vehicleNo]: { maxCount: number, models: string[] } } }
export async function GET() {
  try {
    await ensureTable()
    const rows = await withRetry(() => prisma.$queryRawUnsafe<{ vehicleNo: string; maxCount: number | null; models: string | null; lowOnly: number | null; active: number | null; region: string | null; modelsOnly: number | null }[]>(
      `SELECT vehicleNo, maxCount, models, lowOnly, active, region, modelsOnly FROM "VehicleConfig"`,
    ))
    const configs: Record<string, { maxCount: number; models: string[]; lowOnly: boolean; active: boolean; region: string; modelsOnly: boolean }> = {}
    for (const r of rows) {
      if (!r.vehicleNo) continue
      let models: string[] = []
      try { const p = JSON.parse(r.models || '[]'); if (Array.isArray(p)) models = p.map(String) } catch { /* noop */ }
      // active: 값 없으면(기존행) 가동(true) 기본
      configs[r.vehicleNo] = { maxCount: Number(r.maxCount) || 0, models, lowOnly: !!r.lowOnly, active: r.active == null ? true : !!r.active, region: r.region || '', modelsOnly: !!r.modelsOnly }
    }
    return NextResponse.json({ configs })
  } catch {
    return NextResponse.json({ configs: {} })
  }
}

// POST { vehicleNo, maxCount, models[] } : 저장. maxCount<=0 & models 비면 삭제.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const vehicleNo = String(body?.vehicleNo ?? '').trim()
    if (!vehicleNo) return NextResponse.json({ error: 'vehicleNo 필요' }, { status: 400 })
    const maxCount = Math.max(0, Math.floor(Number(body?.maxCount) || 0))
    const models = Array.isArray(body?.models) ? [...new Set(body.models.map((m: unknown) => String(m)))] : []
    const lowOnly = body?.lowOnly ? 1 : 0
    const active = body?.active === false ? 0 : 1   // 기본 가동(1)
    const region = String(body?.region ?? '').trim()   // 담당 구역 (''=미배정)
    const modelsOnly = body?.modelsOnly ? 1 : 0        // 선호모델 전용(하드 제약)

    await ensureTable()
    // 모두 기본값이면 행 삭제, 아니면 저장
    if (maxCount <= 0 && models.length === 0 && !lowOnly && active === 1 && region === '' && !modelsOnly) {
      await withRetry(() => prisma.$executeRawUnsafe(`DELETE FROM "VehicleConfig" WHERE vehicleNo = ?`, vehicleNo))
    } else {
      await withRetry(() => prisma.$executeRawUnsafe(
        `INSERT INTO "VehicleConfig"(vehicleNo, maxCount, models, lowOnly, active, region, modelsOnly, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(vehicleNo) DO UPDATE SET maxCount=excluded.maxCount, models=excluded.models, lowOnly=excluded.lowOnly, active=excluded.active, region=excluded.region, modelsOnly=excluded.modelsOnly, updatedAt=excluded.updatedAt`,
        vehicleNo, maxCount, JSON.stringify(models), lowOnly, active, region, modelsOnly, new Date().toISOString(),
      ))
    }
    return NextResponse.json({ ok: true, vehicleNo, maxCount, models, lowOnly: !!lowOnly, active: !!active, region, modelsOnly: !!modelsOnly })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '저장 실패' }, { status: 500 })
  }
}
