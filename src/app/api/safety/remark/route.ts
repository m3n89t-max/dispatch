import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// SAP 비고(Remark) — 납품번호별로 공유 DB에 저장.
// 끌고오기 결과에만 있고 저장이 안 되면 새로고침/재접속 시 사라지므로,
// SafetyDispatch 와 같은 방식(raw SQL 테이블, Prisma 스키마 변경 불필요)으로 보관한다.

function isBusy(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)) || ''
  return /SQLITE_BUSY|database is locked|database table is locked/i.test(m)
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

let ensured = false
export async function ensureRemarkTable() {
  if (ensured) return
  await withRetry(() => prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "SafetyRemark" (deliveryNo TEXT PRIMARY KEY, remark TEXT, updatedAt TEXT)`,
  ))
  try { await prisma.$executeRawUnsafe(`PRAGMA busy_timeout=8000`) } catch { /* noop */ }
  ensured = true
}

// 끌고오기 결과 저장용 — 라우트 밖(pull-deliveries)에서도 재사용
export async function saveRemarks(rows: { deliveryNo: string; remark: string }[]) {
  if (rows.length === 0) return 0
  await ensureRemarkTable()
  const now = new Date().toISOString()
  let n = 0
  for (const r of rows) {
    const dn = String(r.deliveryNo ?? '').trim()
    const rm = String(r.remark ?? '').trim()
    if (!dn) continue
    if (rm) {
      await withRetry(() => prisma.$executeRawUnsafe(
        `INSERT INTO "SafetyRemark"(deliveryNo, remark, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(deliveryNo) DO UPDATE SET remark=excluded.remark, updatedAt=excluded.updatedAt`,
        dn, rm, now,
      ))
    } else {
      // 비고가 지워진 건은 같이 지운다 (오래된 값이 남지 않도록)
      await withRetry(() => prisma.$executeRawUnsafe(`DELETE FROM "SafetyRemark" WHERE deliveryNo = ?`, dn))
    }
    n++
  }
  return n
}

// GET: { remarks: { [deliveryNo]: remark } }
export async function GET() {
  try {
    await ensureRemarkTable()
    const rows = await withRetry(() => prisma.$queryRawUnsafe<{ deliveryNo: string; remark: string }[]>(
      `SELECT deliveryNo, remark FROM "SafetyRemark"`,
    ))
    const remarks: Record<string, string> = {}
    for (const r of rows) if (r.deliveryNo && r.remark) remarks[r.deliveryNo] = r.remark
    return NextResponse.json({ remarks })
  } catch {
    return NextResponse.json({ remarks: {} })
  }
}

// POST { items: [{ deliveryNo, remark }] }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    if (!Array.isArray(body?.items)) return NextResponse.json({ error: 'items 필요' }, { status: 400 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await saveRemarks((body.items as any[]).map(r => ({ deliveryNo: String(r?.deliveryNo ?? ''), remark: String(r?.remark ?? '') })))
    return NextResponse.json({ ok: true, count })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '저장 실패' }, { status: 500 })
  }
}
