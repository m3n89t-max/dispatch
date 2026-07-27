import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 안전관리 지도 배차 — 납품번호별 차량번호 배정을 공유 DB(23.20.121.23)에 저장 → 여러 PC 공유.
// 배차 완료 후 차량별 납품번호를 복사해 SAP에서 수동 배차하는 흐름.

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
    `CREATE TABLE IF NOT EXISTS "SafetyDispatch" (deliveryNo TEXT PRIMARY KEY, vehicleNo TEXT, driverName TEXT, updatedAt TEXT)`,
  ))
  // source(자동/수동) 컬럼 — 기존 테이블엔 없을 수 있어 ALTER (이미 있으면 에러 무시)
  try { await prisma.$executeRawUnsafe(`ALTER TABLE "SafetyDispatch" ADD COLUMN source TEXT`) } catch { /* 이미 존재 */ }
  try { await prisma.$executeRawUnsafe(`PRAGMA busy_timeout=8000`) } catch { /* noop */ }
  ensuredOnce = true
}

// GET: 배차 목록 → { assignments: { [deliveryNo]: { vehicleNo, driverName } } }
export async function GET() {
  try {
    await ensureTable()
    const rows = await withRetry(() => prisma.$queryRawUnsafe<{ deliveryNo: string; vehicleNo: string; driverName: string; source: string | null }[]>(
      `SELECT deliveryNo, vehicleNo, driverName, source FROM "SafetyDispatch"`,
    ))
    const assignments: Record<string, { vehicleNo: string; driverName: string; source: string }> = {}
    for (const r of rows) if (r.deliveryNo && r.vehicleNo) assignments[r.deliveryNo] = { vehicleNo: r.vehicleNo, driverName: r.driverName || '', source: r.source || 'manual' }
    return NextResponse.json({ assignments })
  } catch {
    return NextResponse.json({ assignments: {} })
  }
}

// POST { deliveryNo, vehicleNo, driverName } : 배정/해제(빈 vehicleNo → 삭제)
//   또는 { items: [{ deliveryNo, vehicleNo, driverName }] } : 일괄 저장(자동배차/초기화). 빈 vehicleNo=해당 건 삭제.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))

    // ── 일괄 저장 ──
    if (Array.isArray(body?.items)) {
      await ensureTable()
      const now = new Date().toISOString()
      let ok = 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const raw of body.items as any[]) {
        const dn = String(raw?.deliveryNo ?? '').trim()
        if (!dn) continue
        const veh = String(raw?.vehicleNo ?? '').trim()
        const drv = String(raw?.driverName ?? '').trim()
        const src = (raw?.source === 'auto' || raw?.source === 'sap') ? raw.source : 'manual'
        if (veh) {
          await withRetry(() => prisma.$executeRawUnsafe(
            `INSERT INTO "SafetyDispatch"(deliveryNo, vehicleNo, driverName, source, updatedAt) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(deliveryNo) DO UPDATE SET vehicleNo=excluded.vehicleNo, driverName=excluded.driverName, source=excluded.source, updatedAt=excluded.updatedAt`,
            dn, veh, drv, src, now,
          ))
        } else {
          await withRetry(() => prisma.$executeRawUnsafe(`DELETE FROM "SafetyDispatch" WHERE deliveryNo = ?`, dn))
        }
        ok++
      }
      return NextResponse.json({ ok: true, count: ok })
    }

    const deliveryNo = String(body?.deliveryNo ?? '').trim()
    const vehicleNo = String(body?.vehicleNo ?? '').trim()
    const driverName = String(body?.driverName ?? '').trim()
    const source = body?.source === 'auto' ? 'auto' : 'manual'
    if (!deliveryNo) return NextResponse.json({ error: 'deliveryNo 필요' }, { status: 400 })

    await ensureTable()
    if (vehicleNo) {
      await withRetry(() => prisma.$executeRawUnsafe(
        `INSERT INTO "SafetyDispatch"(deliveryNo, vehicleNo, driverName, source, updatedAt) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(deliveryNo) DO UPDATE SET vehicleNo=excluded.vehicleNo, driverName=excluded.driverName, source=excluded.source, updatedAt=excluded.updatedAt`,
        deliveryNo, vehicleNo, driverName, source, new Date().toISOString(),
      ))
    } else {
      await withRetry(() => prisma.$executeRawUnsafe(`DELETE FROM "SafetyDispatch" WHERE deliveryNo = ?`, deliveryNo))
    }
    return NextResponse.json({ ok: true, deliveryNo, vehicleNo })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '저장 실패' }, { status: 500 })
  }
}
