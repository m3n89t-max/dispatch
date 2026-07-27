import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 안전관리 주소 플래그(실내 실외기실 / 2점고정 …)를 공유 DB(23.20.121.23)에 "정규화 주소키" 기준으로 저장.
// 판매처마다 주소를 미세하게 다르게 입력해도, 카카오맵 표준주소로 만든 키가 같으면 같은 건물로 취급 → 자동 체크/누적.
// flag = 'indoor'(실내실외기실) | 'twopoint'(2점고정). 표시(=행 존재)된 것만 남기고 해제 시 삭제.

const FLAGS = ['indoor', 'twopoint'] as const
type FlagType = typeof FLAGS[number]

// 공유 SMB SQLite 는 동시 쓰기(SAP 자동가져오기 등)와 겹치면 SQLITE_BUSY(잠금) 발생 → 재시도로 흡수.
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
      await new Promise(r => setTimeout(r, 50 * Math.pow(2, i)))  // 50,100,200,400,800,1600,3200ms
    }
  }
  throw lastErr
}

// 테이블 생성 + 구버전 마이그레이션은 프로세스당 1회만 (매 요청마다 하면 쓰기 잠금↑)
let ensuredOnce = false
async function ensureTable() {
  if (ensuredOnce) return
  await withRetry(() => prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "SafetyAddrFlag" (addrKey TEXT, flag TEXT, sample TEXT, hitCount INTEGER, updatedAt TEXT, PRIMARY KEY(addrKey, flag))`,
  ))
  // 잠금 대기(각 연결) — 즉시 실패 대신 최대 8초 대기
  try { await prisma.$executeRawUnsafe(`PRAGMA busy_timeout=8000`) } catch { /* noop */ }
  // 구버전(SafetyIndoorAddr, indoor 전용) → 새 통합 테이블로 1회 마이그레이션
  try {
    await withRetry(() => prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "SafetyAddrFlag"(addrKey, flag, sample, hitCount, updatedAt)
       SELECT addrKey, 'indoor', sample, hitCount, updatedAt FROM "SafetyIndoorAddr" WHERE indoor = 1`,
    ))
  } catch { /* 구 테이블 없음 → 무시 */ }
  ensuredOnce = true
}

// GET: 플래그별 표시된 주소키 → { flags: { indoor: {[key]:true}, twopoint: {...} }, samples: {[key]: 주소} }
export async function GET() {
  const empty: Record<FlagType, Record<string, boolean>> = { indoor: {}, twopoint: {} }
  try {
    await ensureTable()
    const rows = await withRetry(() => prisma.$queryRawUnsafe<{ addrKey: string; flag: string; sample: string }[]>(
      `SELECT addrKey, flag, sample FROM "SafetyAddrFlag"`,
    ))
    const flags: Record<string, Record<string, boolean>> = { indoor: {}, twopoint: {} }
    const samples: Record<string, string> = {}
    for (const r of rows) {
      if (!r.addrKey || !flags[r.flag]) continue
      flags[r.flag][r.addrKey] = true
      if (r.sample) samples[r.addrKey] = r.sample
    }
    return NextResponse.json({ flags, samples })
  } catch {
    return NextResponse.json({ flags: empty, samples: {} })
  }
}

// POST { key, flag, on, sample } : 표시/해제 저장. 표시 시 hitCount 누적(같은 주소 재확인 횟수).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const key = String(body?.key ?? '').trim()
    const flag = String(body?.flag ?? 'indoor').trim() as FlagType
    // 하위호환: 이전 방식(indoor 전용)의 {indoor:boolean}도 허용
    const on = body?.on !== undefined ? !!body.on : !!body?.indoor
    const sample = String(body?.sample ?? '').trim()
    if (!key) return NextResponse.json({ error: 'key(주소키) 필요' }, { status: 400 })
    if (!FLAGS.includes(flag)) return NextResponse.json({ error: 'flag 값 오류' }, { status: 400 })

    await ensureTable()
    if (on) {
      await withRetry(() => prisma.$executeRawUnsafe(
        `INSERT INTO "SafetyAddrFlag"(addrKey, flag, sample, hitCount, updatedAt) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(addrKey, flag) DO UPDATE SET sample=excluded.sample, hitCount=hitCount+1, updatedAt=excluded.updatedAt`,
        key, flag, sample, new Date().toISOString(),
      ))
    } else {
      await withRetry(() => prisma.$executeRawUnsafe(`DELETE FROM "SafetyAddrFlag" WHERE addrKey = ? AND flag = ?`, key, flag))
    }
    return NextResponse.json({ ok: true, key, flag, on })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '저장 실패' }, { status: 500 })
  }
}
