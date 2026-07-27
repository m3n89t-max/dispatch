import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import iconv from 'iconv-lite'
import { prisma } from '@/lib/prisma'
import { parseFloor, extractDeliveryNumbers } from '@/lib/floorJudge'

// 결과를 공유 DB(23.20.121.23)에 스냅샷 저장/조회 → 여러 PC 공유.
// ★ 안전관리(safety)와 VADS(vads)는 완전히 별개 스냅샷 — 서로 덮어쓰지/보이지 않는다.
//   'current'는 분리 이전(안전관리 단독) 레거시 키 → 안전관리에서만 폴백으로 읽는다.
async function ensureSafetyTable() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SafetySnapshot" (id TEXT PRIMARY KEY, data TEXT, updatedAt TEXT)`)
}
// scope: 'vads' = VADS(납품번호) / 'safety' = 안전관리(주문번호)
function scopeOf(mode?: string | null): 'vads' | 'safety' {
  return mode === 'delivery' || mode === 'vads' ? 'vads' : 'safety'
}
async function saveSnapshot(obj: unknown, scope: 'vads' | 'safety') {
  await ensureSafetyTable()
  await prisma.$executeRawUnsafe(
    `INSERT OR REPLACE INTO "SafetySnapshot"(id, data, updatedAt) VALUES (?, ?, ?)`,
    scope, JSON.stringify(obj), new Date().toISOString(),
  )
}

// GET ?mode=delivery|order : 해당 탭의 최신 스냅샷만 조회 (다른 탭 데이터는 절대 반환 안 함)
export async function GET(request: NextRequest) {
  const scope = scopeOf(request.nextUrl.searchParams.get('mode'))
  try {
    await ensureSafetyTable()
    // 안전관리만 레거시 'current' 폴백 허용 (VADS는 자기 스냅샷만)
    const ids = scope === 'safety' ? [scope, 'current'] : [scope]
    for (const id of ids) {
      const rows = await prisma.$queryRawUnsafe<{ data: string; updatedAt: string }[]>(
        `SELECT data, updatedAt FROM "SafetySnapshot" WHERE id = ?`, id,
      )
      if (rows && rows[0]?.data) return NextResponse.json({ ...JSON.parse(rows[0].data), updatedAt: rows[0].updatedAt })
    }
  } catch { /* 테이블 없음/DB 미연결 → 빈 결과 */ }
  return NextResponse.json({ items: [] })
}

// 안전관리 2단계 조회:
//  1) 주문번호 → safety-address.vbs (zrlek51030) → 납품번호별 "전체 주소"(마스킹 안 됨)
//  2) 주문번호 → safety-dispatch.vbs (zrlek51270) → 납품번호별 차량번호/모델/납기약속시간
//  3) 납품번호로 조인 → 주소의 층으로 2층/저층 분류 → 대표모델 산정 → 반환
// 타임아웃 없음(51030 FU5가 느릴 수 있음).

const TEMP_DIR = 'C:\\temp'
const ADDR_IN = path.join(TEMP_DIR, 'safety_deliveries.txt')  // safety-address.vbs 입력
const ADDR_OUT = path.join(TEMP_DIR, 'safety_address.tsv')
const DISP_IN = path.join(TEMP_DIR, 'safety_orders2f.txt')    // safety-dispatch.vbs 입력
const DISP_OUT = path.join(TEMP_DIR, 'safety_dispatch.tsv')

// VBS 실행 — 타임아웃 필수. SAP에 팝업이 떠 있거나 로그인이 풀리면 cscript가 무한 대기해
// 요청이 끝나지 않고 브라우저에는 "Failed to fetch"만 뜬다(원인 파악 불가).
// 51030(FU5)이 느릴 수 있어 넉넉히 6분.
const VBS_TIMEOUT_MS = 360000
function runVbs(scriptPath: string, timeoutMs = VBS_TIMEOUT_MS): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const cscript32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'cscript.exe')
  const exe = fsSync.existsSync(cscript32) ? cscript32 : 'cscript.exe'
  return new Promise((resolve, reject) => {
    const ps = spawn(exe, ['//NoLogo', scriptPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const out: Buffer[] = [], err: Buffer[] = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { ps.kill() } catch { /* 이미 종료 */ }
    }, timeoutMs)
    ps.stdout?.on('data', (d: Buffer) => out.push(d))
    ps.stderr?.on('data', (d: Buffer) => err.push(d))
    const dec = (c: Buffer[]) => { const b = Buffer.concat(c); try { return iconv.decode(b, 'cp949') } catch { return b.toString('utf8') } }
    ps.on('error', (e) => { clearTimeout(timer); reject(e) })
    ps.on('exit', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: dec(out), stderr: dec(err), timedOut }) })
  })
}

function parseTsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  return { headers: lines[0].split('\t'), rows: lines.slice(1).map(l => l.split('\t')) }
}
const norm = (s: string) => (s ?? '').toLowerCase().replace(/[\s_().\-/]/g, '')
function findCol(headers: string[], ...names: string[]): number {
  const set = names.map(norm)
  for (let i = 0; i < headers.length; i++) if (set.includes(norm(headers[i]))) return i
  return -1
}
const cell = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] ?? '') : '').toString().trim()

// 대표모델 판정 (안전점검 참고용, Material 코드 기준)
//  - FPC*/ARR* (배관·부속·리모컨) 제외
//  - AC*(시스템에어컨) · AP*(업소용) · AF*(스탠드) · AR*(벽걸이) 만 봄
//  - 우선순위(매출 높은 순): 시스템 → 업소용 → 홈멀티(AF·AR 둘 다) → 벽걸이(AR) → 스탠드(AF) → 이전설치(L-MAIR) → 단품
// 주문사유(AUGRU) ZL4 = 사전방문. 대표모델 뒤에 붙여 "벽걸이 사전방문" 처럼 표기하고,
// 설치 대수(대시보드·캐파)에는 포함하지 않는다.
const PREVISIT_REASON = 'ZL4'
const PREVISIT = '사전방문'

const REMOTE = '리모컨'    // ARR* 부속만 있는 납품 = 리모컨 배달 (건수·대수 제외, 지도엔 표시)

// 실제 제품 자재코드만 추림(배관·부속 제외). 없으면 리모컨(ARR) 포함 원본을 그대로.
function productCodes(materials: string[]): string[] {
  const up = materials.map(m => String(m ?? '').toUpperCase().trim()).filter(Boolean)
  const prod = up.filter(m => /^AC\d|^AP\d|^AF\d|^AR\d/.test(m) || m.startsWith('L-MAIR') || m.startsWith('LMAIR'))
  if (prod.length) return [...new Set(prod)]
  const remote = up.filter(m => m.startsWith('ARR'))
  if (remote.length) return [...new Set(remote)]
  return [...new Set(up)]
}

// 대표모델에 해당하는 "풀 모델명" — 그 모델 접두의 코드만 (예: 벽걸이 → AR..., 스탠드 → AF...).
// 홈멀티는 실내/실외 두 종이라 AF·AR 모두 표기.
const MODEL_PREFIX: Record<string, RegExp> = {
  시스템에어컨: /^AC\d/, 업소용: /^AP\d/, 스탠드: /^AF\d/, 벽걸이: /^AR\d/,
  이전설치: /^L-?MAIR/, 홈멀티: /^AF\d|^AR\d/, 리모컨: /^ARR/,
}
// 실외기 추정: 세트에서 코드가 'X'로 끝나는 것(예: ...HAX). 실내기(...HZN 등)만 표기하려고 제외.
function indoorOnly(codes: string[]): string[] {
  const indoor = codes.filter(c => !/X$/.test(c))
  return indoor.length ? indoor : codes   // 전부 X로 끝나면(판정 실패) 원본 유지
}
function repModelName(materials: string[], repModelKo: string): string {
  const codes = productCodes(materials)
  const re = MODEL_PREFIX[repModelKo]
  if (re) { const hit = indoorOnly(codes.filter(c => re.test(c))); if (hit.length) return hit.join('+') }
  return indoorOnly(codes).join('+')   // 단품 등 매핑 없으면 제품코드(실내기만)
}

function repModel(materials: string[]): string {
  let hasAF = false, hasAR = false, hasMove = false, hasSystem = false, hasBiz = false, hasRemote = false
  for (const raw of materials) {
    const m = String(raw ?? '').toUpperCase().trim()
    // 제품 코드는 접두 뒤에 숫자(AC.., AP130.., AF60.., AR60..). AFR-/ARR-/FPC-/FRC- 등 부속은 제외됨.
    if (/^AC\d/.test(m)) hasSystem = true          // 시스템에어컨
    else if (/^AP\d/.test(m)) hasBiz = true        // 업소용
    else if (/^AF\d/.test(m)) hasAF = true
    else if (/^AR\d/.test(m)) hasAR = true
    else if (m === 'L-MAIR' || m.startsWith('L-MAIR') || m.startsWith('LMAIR')) hasMove = true  // 이전설치
    else if (m.startsWith('ARR')) hasRemote = true  // 리모컨(부속) — 실제 제품 없으면 리모컨 배달
  }
  if (hasSystem) return '시스템에어컨'
  if (hasBiz) return '업소용'
  if (hasAF && hasAR) return '홈멀티'
  if (hasAR) return '벽걸이'
  if (hasAF) return '스탠드'
  if (hasMove) return '이전설치'
  if (hasRemote) return REMOTE   // 실제 설치 제품이 하나도 없고 ARR(리모컨)만 → 리모컨 배달
  return '단품'
}

interface DispatchInfo { vehicle: string; promiseTime: string; model: string; delivery: string }

// zrlek51270 TSV → { Sales Order 키 맵, Delivery 키 맵 } 둘 다 반환(51030 키가 무엇이든 조인).
function parseDispatch(text: string): { bySO: Map<string, DispatchInfo>; byDel: Map<string, DispatchInfo> } {
  const bySO = new Map<string, DispatchInfo>()
  const byDel = new Map<string, DispatchInfo>()
  const { headers, rows } = parseTsv(text)
  if (rows.length === 0) return { bySO, byDel }
  const cSO = findCol(headers, 'salesorder', 'sonumber', 'so')
  const cDel = findCol(headers, 'delivery', 'vbeln', 'deliveryno')
  const cVeh = findCol(headers, 'vehiclenumberfull', 'vehiclenumber', 'deliverytruckno')
  const cTime = findCol(headers, 'promisetime', 'bookdltime', 'bookdltim', 'bookdl')
  const cMat = findCol(headers, 'material')

  // 실제 납품번호(Delivery)로 그룹 (없으면 Sales Order로)
  const groupCol = cDel >= 0 ? cDel : cSO
  const groups = new Map<string, string[][]>()
  for (const r of rows) {
    const g = cell(r, groupCol)
    if (!g) continue
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(r)
  }
  for (const rs of groups.values()) {
    const vehicle = rs.map(r => cell(r, cVeh)).find(v => v) ?? ''
    const promiseTime = rs.map(r => cell(r, cTime)).find(v => v) ?? ''
    const model = repModel(rs.map(r => cell(r, cMat)))       // AF/AR 기준
    const delivery = cDel >= 0 ? (rs.map(r => cell(r, cDel)).find(v => v) ?? '') : ''
    const so = cSO >= 0 ? (rs.map(r => cell(r, cSO)).find(v => v) ?? '') : ''
    const info: DispatchInfo = { vehicle, promiseTime, model, delivery }
    if (delivery) byDel.set(delivery, info)
    if (so) bySO.set(so, info)   // 주문번호로도 조인 가능
  }
  return { bySO, byDel }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const pasted = String(body?.deliveries ?? '')
    // VADS = 납품번호(delivery) 입력 / 안전관리 = 주문번호(order) 입력
    const isDelivery = body?.mode === 'delivery'
    const orders = extractDeliveryNumbers(pasted)
    if (orders.length === 0) {
      return NextResponse.json({ error: `${isDelivery ? '납품번호(Delivery)' : '주문번호(Sales Order)'}가 없습니다. 7~10자리 숫자를 붙여넣어 주세요.` }, { status: 400 })
    }

    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {})
    const listTxt = orders.join('\r\n') + '\r\n'
    await fs.writeFile(ADDR_IN, listTxt, 'utf8')
    await fs.writeFile(DISP_IN, listTxt, 'utf8')
    await fs.unlink(ADDR_OUT).catch(() => {})
    await fs.unlink(DISP_OUT).catch(() => {})

    // VADS(납품번호)면 납품번호 선택 VBS, 안전관리(주문번호)면 기존 VBS
    const addrVbsName = isDelivery ? 'safety-address-del.vbs' : 'safety-address.vbs'
    const addrVbs = path.join(process.cwd(), addrVbsName)
    const dispVbs = path.join(process.cwd(), 'safety-dispatch.vbs')
    try { await fs.access(addrVbs) } catch { return NextResponse.json({ error: `${addrVbsName} 없음 (배포폴더에 VBS 필요)` }, { status: 500 }) }

    // 1) 주소 조회 (zrlek51030) — 필수
    const a = await runVbs(addrVbs)
    if (a.timedOut) {
      return NextResponse.json({
        error: 'SAP 응답이 없어 6분 후 중단했습니다.\n\n확인사항:\n① SAP 화면에 팝업/대화상자가 떠 있으면 닫아주세요\n② SAP Logon 로그인이 유지되고 있는지 확인\n③ SAP GUI 스크립팅이 허용되어 있는지 확인',
        timedOut: true, stdout: a.stdout.slice(-800),
      }, { status: 504 })
    }
    let addrText = ''
    try { addrText = await fs.readFile(ADDR_OUT, 'utf8') } catch {
      return NextResponse.json({
        error: 'SAP 주소 결과를 읽지 못했습니다. SAP 로그인 상태를 확인해주세요.',
        code: a.code, stdout: a.stdout.slice(0, 800),
      }, { status: 500 })
    }

    // 2) 배차정보 조회 (zrlek51270) — 있으면 조인, 실패해도 주소/층은 반환
    //    VADS(납품번호=익일 물량)는 배차 전이라 51270이 비어 있음 → 조회 생략, 모델은 51030 자재로 산정
    let dispatch = { bySO: new Map<string, DispatchInfo>(), byDel: new Map<string, DispatchInfo>() }
    let dispLog = ''
    if (!isDelivery) {
      try {
        await fs.access(dispVbs)
        const d = await runVbs(dispVbs)
        dispLog = d.stdout.slice(-600)
        const dispText = await fs.readFile(DISP_OUT, 'utf8').catch(() => '')
        if (dispText) dispatch = parseDispatch(dispText)
      } catch { /* 51270 실패 → 주소만 */ }
    }

    // 3) 주소(51030) 파싱 + 조인 (51030 키 = 주문번호 또는 납품번호 → 둘 다 시도)
    const { headers, rows } = parseTsv(addrText)
    const addrCol = findCol(headers, 'street', '주소', 'address', 'shiptoaddress', 'stras')
    const delCol = findCol(headers, 'delivery', 'vbeln', 'deliveryno')
    const matCol = findCol(headers, 'materials', 'material', 'matnr')  // 51030 자재목록(';'구분) — 미래날짜용 모델 산정
    const rsnCol = findCol(headers, 'reason', 'augru', 'orderreason')   // 주문사유 — ZL4 = 사전방문

    let matched = 0
    const seen = new Set<string>()
    const items = rows.map(r => {
      const key = cell(r, delCol)              // 51030이 내보낸 키 (주문번호 or 납품번호)
      const address = cell(r, addrCol)
      const { floor, isHigh } = parseFloor(address)
      const info = dispatch.bySO.get(key) || dispatch.byDel.get(key)
      if (info) matched++
      // 미래날짜 주문은 배차 전이라 51270이 비어 info 없음 → 51030 자재로 대표모델 산정
      const mats = matCol >= 0 ? cell(r, matCol).split(/[;,]/).map(s => s.trim()).filter(Boolean) : []
      const baseModel = info?.model || (mats.length ? repModel(mats) : '')
      // 주문사유 ZL4 = 사전방문 → "벽걸이 사전방문" 처럼 표기. 설치 대수에는 포함하지 않는다.
      const reason = rsnCol >= 0 ? cell(r, rsnCol).trim().toUpperCase() : ''
      const model = reason === PREVISIT_REASON && baseModel ? `${baseModel} ${PREVISIT}` : baseModel
      // 대표모델의 풀 모델명(자재코드) — 그 모델 접두 코드만. 예: 벽걸이 → AR06D1150HZN
      const modelName = repModelName(mats, baseModel)
      return {
        deliveryNo: info?.delivery || key,     // 51270의 진짜 납품번호 우선
        address, floor, isHigh,
        vehicle: info?.vehicle ?? '',
        model, modelName,
        promiseTime: info?.promiseTime ?? '',
      }
    }).filter(it => {
      if (!it.deliveryNo) return true
      if (seen.has(it.deliveryNo)) return false
      seen.add(it.deliveryNo); return true
    })

    const highCount = items.filter(i => i.isHigh).length
    const payload = {
      success: true,
      requested: orders.length,
      fetched: items.length,
      highCount, lowCount: items.length - highCount,
      addrCol, delCol,
      items,
    }
    // 공유 DB에 저장 (다른 PC에서도 조회) — 탭별 분리 저장, 실패해도 응답은 정상 반환
    await saveSnapshot({ ...payload, savedAt: new Date().toISOString() }, scopeOf(body?.mode)).catch(() => {})
    return NextResponse.json({
      ...payload,
      dispatchRows: dispatch.bySO.size + dispatch.byDel.size,
      dispatchMatched: matched,
      log: a.stdout.slice(-800),
      dispLog,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'SAP 조회 중 오류' }, { status: 500 })
  }
}
