import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as ExcelJS from 'exceljs'
import { judgeModelType, getInstallCount } from '@/lib/modelJudge'

// SAP 엑셀 파싱 (배차/납기확정/설치완료 공통) — 컬럼 위치 스캔 방식

function extractMatnr(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim().toUpperCase()
    if (s.startsWith('AR') || s.startsWith('AF') || s.startsWith('AC') || s.startsWith('L-')) {
      return s
    }
  }
  return ''
}

function extractAugru(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim().toUpperCase()
    if (s === 'ZL4') return 'ZL4'
  }
  return ''
}

// Delivery 번호: 7로 시작하는 10자리 숫자 (SAP 납기문서: 73xxxxxxxx)
function extractDeliveryNo(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (/^7\d{9}$/.test(s)) return s
  }
  return ''
}

// 차량번호: 한국 번호판 패턴
const PLATE_RE = /\d{2,3}\s*[가-힣]\s*\d{4}/
function extractVehicleNo(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (PLATE_RE.test(s)) return s
  }
  return ''
}

async function parseExcel(
  buffer: Buffer,
  vehicleMap: Map<string, string>  // vehicleKey → driverName
): Promise<{ deliveryNo: string; customerName: string; matnr: string; modelType: string; installCount: number }[]> {
  const workbook = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any)

  const worksheet = workbook.getWorksheet(1)
  if (!worksheet) throw new Error('워크시트를 찾을 수 없습니다')

  const records: { deliveryNo: string; customerName: string; matnr: string; modelType: string; installCount: number }[] = []

  worksheet.eachRow((row: ExcelJS.Row, rowNumber: number) => {
    if (rowNumber === 1) return
    const vals = row.values as unknown[]

    const deliveryNo = extractDeliveryNo(vals)
    if (!deliveryNo) return

    const matnr = extractMatnr(vals)
    const augru = extractAugru(vals)

    // 차량번호 → 기사명 매칭 (vehicleMap이 있으면 기사명, 없으면 차량번호 그대로)
    const vehicleNo = extractVehicleNo(vals)
    const vehicleKey = vehicleNo.replace(/\s/g, '').toUpperCase()
    const driverName = vehicleMap.size > 0
      ? (vehicleMap.get(vehicleKey) ?? vehicleNo ?? 'UNKNOWN')
      : vehicleNo || 'UNKNOWN'

    const modelType = matnr ? judgeModelType(matnr, augru || undefined) : 'UNKNOWN'
    const installCount = getInstallCount(modelType as Parameters<typeof getInstallCount>[0])

    records.push({ deliveryNo, customerName: driverName, matnr, modelType, installCount })
  })

  return records
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const uploadType = formData.get('uploadType') as string // DISPATCH | CONFIRM | COMPLETE
    const date = formData.get('date') as string            // YYYY-MM-DD
    const isRainy = formData.get('isRainy') === 'true'

    if (!file) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
    if (!['DISPATCH', 'CONFIRM', 'COMPLETE'].includes(uploadType)) {
      return NextResponse.json({ error: '유효하지 않은 uploadType' }, { status: 400 })
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: '날짜 형식 오류 (YYYY-MM-DD)' }, { status: 400 })
    }

    // DISPATCH 타입은 차량번호 → 기사명 매칭
    const vehicleMap = new Map<string, string>()
    if (uploadType === 'DISPATCH') {
      const allDrivers = await prisma.driver.findMany({
        select: { teamName: true, vehicleNumber: true },
      })
      for (const d of allDrivers) {
        if (d.vehicleNumber) {
          vehicleMap.set(d.vehicleNumber.replace(/\s/g, '').toUpperCase(), d.teamName)
        }
      }
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const records = await parseExcel(buffer, vehicleMap)

    if (records.length === 0) {
      return NextResponse.json({ error: '유효한 데이터가 없습니다' }, { status: 400 })
    }

    // WorkDate upsert (날씨는 DISPATCH 업로드 시 또는 별도 API로 설정)
    const workDate = await prisma.workDate.upsert({
      where: { date },
      update: { isRainy },
      create: { date, isRainy },
    })

    // DeliverySession 생성
    const session = await prisma.deliverySession.create({
      data: {
        workDateId: workDate.id,
        uploadType: uploadType as 'DISPATCH' | 'CONFIRM' | 'COMPLETE',
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
      include: { records: true },
    })

    // Delivery 단위 집계 (같은 Delivery의 설치대수 합산)
    const deliveryMap: Record<string, { customerName: string; totalInstall: number; count: number }> = {}
    for (const r of records) {
      if (!deliveryMap[r.deliveryNo]) {
        deliveryMap[r.deliveryNo] = { customerName: r.customerName, totalInstall: 0, count: 0 }
      }
      deliveryMap[r.deliveryNo].totalInstall += r.installCount
      deliveryMap[r.deliveryNo].count++
    }

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      date,
      uploadType,
      isRainy,
      totalRows: records.length,
      deliveryCount: Object.keys(deliveryMap).length,
      deliveries: Object.entries(deliveryMap).map(([deliveryNo, v]) => ({
        deliveryNo,
        customerName: v.customerName,
        totalInstall: v.totalInstall,
      })),
    })

  } catch (error) {
    console.error('Performance upload error:', error)
    const msg = error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
