import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as ExcelJS from 'exceljs'
import { judgeModelType, getInstallCount } from '@/lib/modelJudge'

function extractMatnr(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim().toUpperCase()
    if (s.startsWith('AR') || s.startsWith('AF') || s.startsWith('AC') || s.startsWith('L-')) return s
  }
  return ''
}

function extractAugru(values: unknown[]): string {
  for (const v of values) {
    if (String(v ?? '').trim().toUpperCase() === 'ZL4') return 'ZL4'
  }
  return ''
}

function extractDeliveryNo(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (/^7\d{9}$/.test(s)) return s
  }
  return ''
}

const PLATE_RE = /\d{2,3}\s*[가-힣]\s*\d{4}/
function extractVehicleNo(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (PLATE_RE.test(s)) return s
  }
  return ''
}

// SAP의 Customer 컬럼에서 마스킹된 고객명 추출
// 예: "양*호", "백*엽", "허*****혜)", "d****영욱", "오***농원"
function extractSapCustomer(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (!s) continue
    // *를 포함하는 마스킹 패턴 (한글 + * + 한글, 또는 영문 + * + 한글)
    if (/\*/.test(s) && /^[가-힣A-Za-z()*]+$/.test(s) && s.length >= 2 && s.length <= 20) {
      return s
    }
  }
  return ''
}

function parseCustomerName(cn: string): { driverName: string; vehicleNo: string; sapCustomer: string } {
  // customerName format: "기사명 (차량번호)|SAP고객" 또는 "기사명 (차량번호)"
  const parts = cn.split('|')
  const baseLabel = parts[0]
  const sapCustomer = parts[1] || ''
  const m = baseLabel.match(/^(.+) \((.+)\)$/)
  if (m) return { driverName: m[1], vehicleNo: m[2], sapCustomer }
  return { driverName: baseLabel, vehicleNo: '', sapCustomer }
}

interface ParsedRecord {
  deliveryNo: string
  customerName: string
  vehicleNo: string
  driverName: string
  matched: boolean
  matnr: string
  modelType: string
  installCount: number
  sapCustomer: string
}

async function parseExcel(
  buffer: Buffer,
  vehicleMap: Map<string, string>
): Promise<{ records: ParsedRecord[]; unmatchedVehicles: string[] }> {
  const workbook = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any)
  const worksheet = workbook.getWorksheet(1)
  if (!worksheet) throw new Error('워크시트를 찾을 수 없습니다')

  const rows: ParsedRecord[] = []
  worksheet.eachRow((row: ExcelJS.Row, rowNumber: number) => {
    if (rowNumber === 1) return
    const vals = row.values as unknown[]
    const deliveryNo = extractDeliveryNo(vals)
    if (!deliveryNo) return

    const vehicleNo = extractVehicleNo(vals)
    const vehicleKey = vehicleNo.replace(/\s/g, '').toUpperCase()
    const matchedName = vehicleMap.get(vehicleKey)
    const driverName = matchedName || vehicleNo || 'UNKNOWN'
    const matched = !!matchedName

    const matnr = extractMatnr(vals)
    const augru = extractAugru(vals)
    const modelType = matnr ? judgeModelType(matnr, augru || undefined) : 'UNKNOWN'
    const installCount = getInstallCount(modelType as Parameters<typeof getInstallCount>[0])
    const sapCustomer = extractSapCustomer(vals)

    // customerName에 SAP 고객명을 함께 저장: "기사명 (차량번호)|SAP고객"
    const baseLabel = matched ? `${driverName} (${vehicleNo})` : vehicleNo || 'UNKNOWN'
    const customerName = sapCustomer ? `${baseLabel}|${sapCustomer}` : baseLabel

    rows.push({
      deliveryNo,
      customerName,
      vehicleNo,
      driverName,
      matched,
      matnr,
      modelType,
      installCount,
      sapCustomer,
    })
  })

  const unmatchedVehicles = [...new Set(
    rows.filter(r => !r.matched && r.vehicleNo).map(r => r.vehicleNo)
  )]

  // ─── Delivery 단위 후처리 ───────────────────────────────────────────
  // 1) 리모컨 검출: AFR(AF용) + ARR(AR용) 둘 다 있으면 홈멀티
  // 2) 같은 model family의 다른 SKU(WS/WNKO/WXKO 등)는 1대로 통합
  //    - family = matnr에서 W로 시작하는 trailing suffix 제거
  //    - 같은 family에서 가장 자주 출현한 code의 횟수가 indoor 수
  const remoteByDelivery = new Map<string, Set<string>>()
  for (const r of rows) {
    const u = r.matnr.toUpperCase()
    if (u.startsWith('AFR') || u.startsWith('ARR')) {
      if (!remoteByDelivery.has(r.deliveryNo)) remoteByDelivery.set(r.deliveryNo, new Set())
      remoteByDelivery.get(r.deliveryNo)!.add(u.startsWith('AFR') ? 'AFR' : 'ARR')
    }
  }

  // AFR + ARR 둘 다 있는 Delivery → indoor 모두 HOME_MULTI로 변환
  for (const r of rows) {
    const remotes = remoteByDelivery.get(r.deliveryNo)
    if (remotes && remotes.has('AFR') && remotes.has('ARR')) {
      if (r.modelType === 'WALL_MOUNT' || r.modelType === 'STAND') {
        r.modelType = 'HOME_MULTI'
      }
    }
  }

  // Family 단위 dedup: 같은 family의 다른 SKU는 installCount=0으로 표시
  // (UI에서 코드는 보이지만 합계엔 안 들어감)
  // 예: WS + WNKO + WXKO → max(1,1) = 1대만 카운트
  //     WS × 2 + WNKO → max(2,1) = 2대 카운트
  const getFamily = (matnr: string) => {
    // W로 시작하는 trailing suffix 제거 (예: WS, WNKO, WXKO, WRT, WN)
    return matnr.replace(/W[A-Z]+(?:KO)?$/, '')
  }

  // Delivery 별로 family → code → records[] 맵 구성
  const byDelivery = new Map<string, ParsedRecord[]>()
  for (const r of rows) {
    if (!byDelivery.has(r.deliveryNo)) byDelivery.set(r.deliveryNo, [])
    byDelivery.get(r.deliveryNo)!.push(r)
  }

  for (const [, group] of byDelivery) {
    const familyMap = new Map<string, Map<string, ParsedRecord[]>>()
    for (const r of group) {
      if (!['WALL_MOUNT', 'STAND', 'HOME_MULTI'].includes(r.modelType)) continue
      const family = getFamily(r.matnr)
      if (!familyMap.has(family)) familyMap.set(family, new Map())
      const codeMap = familyMap.get(family)!
      if (!codeMap.has(r.matnr)) codeMap.set(r.matnr, [])
      codeMap.get(r.matnr)!.push(r)
    }
    // 각 family에서 가장 자주 나온 code만 installCount 유지
    for (const [, codeMap] of familyMap) {
      let maxCode = '', maxCount = 0
      for (const [code, recs] of codeMap) {
        if (recs.length > maxCount) { maxCount = recs.length; maxCode = code }
      }
      for (const [code, recs] of codeMap) {
        if (code !== maxCode) {
          for (const r of recs) r.installCount = 0
        }
      }
    }
  }

  return { records: rows, unmatchedVehicles }
}

interface DriverSummary {
  driverName: string
  vehicleNo: string
  matched: boolean
  deliveryNos: string[]
  deliveryCount: number
  totalInstall: number
  wallMount: number
  stand: number
  homeMulti: number
  systemAc: number
  preVisit: number
  moveInstall: number
}

function buildDriverSummary(records: ParsedRecord[]): DriverSummary[] {
  // 1단계: Delivery 단위 집계
  const deliveryMap: Record<string, {
    driverName: string; vehicleNo: string; matched: boolean
    totalInstall: number; wallMount: number; stand: number
    homeMulti: number; systemAc: number; preVisit: number; moveInstall: number
  }> = {}

  for (const r of records) {
    if (!deliveryMap[r.deliveryNo]) {
      deliveryMap[r.deliveryNo] = {
        driverName: r.driverName, vehicleNo: r.vehicleNo, matched: r.matched,
        totalInstall: 0, wallMount: 0, stand: 0, homeMulti: 0, systemAc: 0, preVisit: 0, moveInstall: 0,
      }
    }
    const d = deliveryMap[r.deliveryNo]
    d.totalInstall += r.installCount
    // installCount 기반 집계 (family dedup으로 0인 row는 카운트 안 함)
    if (r.modelType === 'WALL_MOUNT') d.wallMount += r.installCount
    else if (r.modelType === 'STAND') d.stand += r.installCount
    else if (r.modelType === 'HOME_MULTI') d.homeMulti += r.installCount
    else if (r.modelType === 'SYSTEM_AC') d.systemAc += r.installCount
    else if (r.modelType === 'PRE_VISIT') d.preVisit += r.installCount
    else if (r.modelType === 'MOVE_INSTALL') d.moveInstall += r.installCount
  }

  // 2단계: 기사별 집계
  const driverMap: Record<string, DriverSummary> = {}
  for (const [deliveryNo, d] of Object.entries(deliveryMap)) {
    const key = d.driverName || 'UNKNOWN'
    if (!driverMap[key]) {
      driverMap[key] = {
        driverName: d.driverName, vehicleNo: d.vehicleNo, matched: d.matched,
        deliveryNos: [], deliveryCount: 0, totalInstall: 0,
        wallMount: 0, stand: 0, homeMulti: 0, systemAc: 0, preVisit: 0, moveInstall: 0,
      }
    }
    const c = driverMap[key]
    c.deliveryNos.push(deliveryNo)
    c.deliveryCount++
    c.totalInstall += d.totalInstall
    c.wallMount += d.wallMount
    c.stand += d.stand
    c.homeMulti += d.homeMulti
    c.systemAc += d.systemAc
    c.preVisit += d.preVisit
    c.moveInstall += d.moveInstall
  }

  return Object.values(driverMap).sort((a, b) => b.totalInstall - a.totalInstall)
}

interface ComparisonDriver {
  driverName: string
  vehicleNo: string
  prevDeliveryCount: number
  prevInstallCount: number
  sameDayDeliveryCount: number
  sameDayInstallCount: number
  maintained: number
  postponed: number
  added: number
}

function buildComparison(
  prevRecords: { deliveryNo: string; customerName: string; installCount: number }[],
  sameDayRecords: ParsedRecord[]
): ComparisonDriver[] {
  // Delivery 단위 집계 (전일)
  const prevMap: Record<string, { driverName: string; vehicleNo: string; installCount: number }> = {}
  for (const r of prevRecords) {
    if (!prevMap[r.deliveryNo]) {
      const { driverName, vehicleNo } = parseCustomerName(r.customerName)
      prevMap[r.deliveryNo] = { driverName, vehicleNo, installCount: 0 }
    }
    prevMap[r.deliveryNo].installCount += r.installCount
  }

  // Delivery 단위 집계 (당일)
  const sameDayMap: Record<string, { driverName: string; vehicleNo: string; installCount: number }> = {}
  for (const r of sameDayRecords) {
    if (!sameDayMap[r.deliveryNo]) {
      sameDayMap[r.deliveryNo] = { driverName: r.driverName, vehicleNo: r.vehicleNo, installCount: 0 }
    }
    sameDayMap[r.deliveryNo].installCount += r.installCount
  }

  // 전체 기사명 집합
  const allDrivers = new Set([
    ...Object.values(prevMap).map(d => d.driverName),
    ...Object.values(sameDayMap).map(d => d.driverName),
  ])

  return [...allDrivers].map(driverName => {
    const prevEntries = Object.entries(prevMap).filter(([, d]) => d.driverName === driverName)
    const sameDayEntries = Object.entries(sameDayMap).filter(([, d]) => d.driverName === driverName)
    const prevNos = new Set(prevEntries.map(([no]) => no))
    const sameDayNos = new Set(sameDayEntries.map(([no]) => no))

    return {
      driverName,
      vehicleNo: prevEntries[0]?.[1].vehicleNo || sameDayEntries[0]?.[1].vehicleNo || '',
      prevDeliveryCount: prevNos.size,
      prevInstallCount: prevEntries.reduce((s, [, d]) => s + d.installCount, 0),
      sameDayDeliveryCount: sameDayNos.size,
      sameDayInstallCount: sameDayEntries.reduce((s, [, d]) => s + d.installCount, 0),
      maintained: [...prevNos].filter(no => sameDayNos.has(no)).length,
      postponed: [...prevNos].filter(no => !sameDayNos.has(no)).length,
      added: [...sameDayNos].filter(no => !prevNos.has(no)).length,
    }
  }).sort((a, b) => (b.postponed + b.added) - (a.postponed + a.added) || a.driverName.localeCompare(b.driverName))
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const uploadType = formData.get('uploadType') as string
    const installDate = formData.get('installDate') as string

    if (!file) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
    if (!['PREV_DELIVERY', 'SAME_DAY_DELIVERY'].includes(uploadType)) {
      return NextResponse.json({ error: '유효하지 않은 uploadType' }, { status: 400 })
    }
    if (!installDate || !/^\d{4}-\d{2}-\d{2}$/.test(installDate)) {
      return NextResponse.json({ error: '날짜 형식 오류 (YYYY-MM-DD)' }, { status: 400 })
    }

    // 차량번호 → 기사명 매핑
    const allDrivers = await prisma.driver.findMany({ select: { teamName: true, vehicleNumber: true } })
    const vehicleMap = new Map<string, string>()
    for (const d of allDrivers) {
      if (d.vehicleNumber) vehicleMap.set(d.vehicleNumber.replace(/\s/g, '').toUpperCase(), d.teamName)
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const { records, unmatchedVehicles } = await parseExcel(buffer, vehicleMap)

    if (records.length === 0) {
      return NextResponse.json({ error: '유효한 데이터가 없습니다 (Delivery 번호 없음)' }, { status: 400 })
    }

    // WorkDate upsert (설치일 기준)
    const workDate = await prisma.workDate.upsert({
      where: { date: installDate },
      update: {},
      create: { date: installDate },
    })

    // 기존 동일 타입 세션 삭제 (재업로드 시 교체)
    const existingSessions = await prisma.deliverySession.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { workDateId: workDate.id, uploadType: uploadType as any },
      select: { id: true },
    })
    if (existingSessions.length > 0) {
      const ids = existingSessions.map(s => s.id)
      await prisma.deliveryRecord.deleteMany({ where: { sessionId: { in: ids } } })
      await prisma.deliverySession.deleteMany({ where: { id: { in: ids } } })
    }

    // DeliverySession + DeliveryRecord 생성
    await prisma.deliverySession.create({
      data: {
        workDateId: workDate.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        uploadType: uploadType as any,
        fileName: file.name,
        records: {
          create: records.map(r => ({
            deliveryNo: r.deliveryNo,
            customerName: r.customerName,
            matnr: r.matnr,
            modelType: r.modelType,
            installCount: r.installCount,
          })),
        },
      },
    })

    const driverSummary = buildDriverSummary(records)

    // 당일 납기일 경우 전일 납기와 비교
    let comparison: ComparisonDriver[] | null = null
    if (uploadType === 'SAME_DAY_DELIVERY') {
      const prevSession = await prisma.deliverySession.findFirst({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: { workDateId: workDate.id, uploadType: 'PREV_DELIVERY' as any },
        include: { records: true },
      })
      if (prevSession) {
        comparison = buildComparison(prevSession.records, records)
      }
    }

    return NextResponse.json({
      success: true,
      installDate,
      uploadType,
      totalRows: records.length,
      deliveryCount: driverSummary.reduce((s, d) => s + d.deliveryCount, 0),
      driverSummary,
      unmatchedVehicles,
      comparison,
    })
  } catch (error) {
    console.error('Delivery upload error:', error)
    return NextResponse.json({ error: '업로드 중 오류가 발생했습니다' }, { status: 500 })
  }
}
