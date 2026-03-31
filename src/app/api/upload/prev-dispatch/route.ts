import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as ExcelJS from 'exceljs'
import { judgeModelType, getInstallCount } from '@/lib/modelJudge'

// SAP 납기전 배차 엑셀 — 컬럼 위치를 고정하지 않고 값 스캔으로 감지

// 모델코드 자동 감지: AR/AF/AC/L- 로 시작하는 값
function extractMatnr(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim().toUpperCase()
    if (
      s.startsWith('AR') || s.startsWith('AF') ||
      s.startsWith('AC') || s.startsWith('L-')
    ) {
      return s
    }
  }
  return ''
}

// AUGRU 감지: ZL4 포함 여부
function extractAugru(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim().toUpperCase()
    if (s === 'ZL4') return 'ZL4'
  }
  return ''
}

// Delivery 번호: 7로 시작하는 10자리 숫자 (SAP 납기문서 형식: 73xxxxxxxx)
function extractDeliveryNo(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (/^7\d{9}$/.test(s)) return s
  }
  return ''
}

// 차량번호: 한글이 포함된 값 (마지막 발견값 우선)
// SAP 리스트에는 기사명 없이 차량번호만 있으므로, 이 값으로 Driver DB 매칭
function extractVehicleNo(values: unknown[]): string {
  let found = ''
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (/[가-힣]/.test(s)) found = s
  }
  return found
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const workbook = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any)

    const worksheet = workbook.getWorksheet(1)
    if (!worksheet) {
      return NextResponse.json({ error: '워크시트를 찾을 수 없습니다' }, { status: 400 })
    }

    // 헤더 읽기 (1행)
    const headers: string[] = []
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value ?? '').trim()
    })

    // DB에서 기사 목록 로드 → 차량번호로 매칭
    const allDrivers = await prisma.driver.findMany({
      select: { teamCode: true, teamName: true, vehicleNumber: true },
    })
    // 차량번호 → 기사 매핑 (공백 무시, 대소문자 무시)
    const vehicleMap = new Map<string, { teamCode: string; teamName: string }>()
    for (const d of allDrivers) {
      if (d.vehicleNumber) {
        vehicleMap.set(d.vehicleNumber.replace(/\s/g, '').toUpperCase(), {
          teamCode: d.teamCode,
          teamName: d.teamName,
        })
      }
    }

    interface RowData {
      deliveryNo: string
      vehicleNo: string      // SAP 원본 차량번호
      driverName: string     // DB 매칭된 기사명 (없으면 차량번호 그대로)
      teamCode: string       // DB 매칭된 팀코드
      matched: boolean       // DB 매칭 여부
      matnr: string
      augru: string
      rawValues: (string | null)[]
    }

    const rows: RowData[] = []
    worksheet.eachRow((row: ExcelJS.Row, rowNumber: number) => {
      if (rowNumber === 1) return
      const vals = row.values as unknown[]

      const vehicleNo = extractVehicleNo(vals)
      const vehicleKey = vehicleNo.replace(/\s/g, '').toUpperCase()
      const driver = vehicleMap.get(vehicleKey)

      rows.push({
        deliveryNo: extractDeliveryNo(vals),
        vehicleNo,
        driverName: driver ? driver.teamName : vehicleNo,
        teamCode: driver ? driver.teamCode : '',
        matched: !!driver,
        matnr: extractMatnr(vals),
        augru: extractAugru(vals),
        rawValues: vals.slice(1).map(v => v == null ? null : String(v)),
      })
    })

    // undefined → null 정리 후 저장
    const cleanRows = JSON.parse(JSON.stringify(rows, (_, v) => v === undefined ? null : v))

    const upload = await prisma.dispatchUpload.create({
      data: {
        uploadDate: new Date(),
        fileName: file.name,
        rawData: cleanRows as import('@prisma/client').Prisma.JsonArray,
      }
    })

    // 모델 판정 및 설치대수 계산
    const processedItems = rows.map(row => {
      const modelType = row.matnr
        ? judgeModelType(row.matnr, row.augru || undefined)
        : 'UNKNOWN'
      const installCount = getInstallCount(modelType as Parameters<typeof getInstallCount>[0])
      return {
        deliveryNo: row.deliveryNo,
        vehicleNo: row.vehicleNo,
        driverName: row.driverName,
        teamCode: row.teamCode,
        matched: row.matched,
        matnr: row.matnr,
        augru: row.augru,
        modelType,
        installCount,
      }
    })

    // Delivery 단위 집계
    const deliveryMap: Record<string, {
      deliveryNo: string
      vehicleNo: string
      driverName: string
      teamCode: string
      matched: boolean
      totalInstall: number
      itemCount: number
      wallMount: number
      stand: number
      homeMulti: number
      systemAc: number
      preVisit: number
      moveInstall: number
      unknown: number
    }> = {}

    for (const item of processedItems) {
      const key = item.deliveryNo || 'UNKNOWN'
      if (!deliveryMap[key]) {
        deliveryMap[key] = {
          deliveryNo: item.deliveryNo,
          vehicleNo: item.vehicleNo,
          driverName: item.driverName,
          teamCode: item.teamCode,
          matched: item.matched,
          totalInstall: 0,
          itemCount: 0,
          wallMount: 0,
          stand: 0,
          homeMulti: 0,
          systemAc: 0,
          preVisit: 0,
          moveInstall: 0,
          unknown: 0,
        }
      }
      const d = deliveryMap[key]
      d.totalInstall += item.installCount
      d.itemCount++
      if (item.modelType === 'WALL_MOUNT') d.wallMount++
      else if (item.modelType === 'STAND') d.stand++
      else if (item.modelType === 'HOME_MULTI') d.homeMulti++
      else if (item.modelType === 'SYSTEM_AC') d.systemAc++
      else if (item.modelType === 'PRE_VISIT') d.preVisit++
      else if (item.modelType === 'MOVE_INSTALL') d.moveInstall++
      else d.unknown++
    }

    // 기사별 집계 (teamCode 또는 vehicleNo 기준)
    const driverMap: Record<string, {
      vehicleNo: string
      driverName: string
      teamCode: string
      matched: boolean
      totalInstall: number
      deliveryCount: number
      wallMount: number
      stand: number
      homeMulti: number
      systemAc: number
      preVisit: number
      moveInstall: number
    }> = {}

    for (const d of Object.values(deliveryMap)) {
      // 매칭된 경우 teamCode, 미매칭이면 vehicleNo를 key로 사용
      const key = d.teamCode || d.vehicleNo || 'UNKNOWN'
      if (!driverMap[key]) {
        driverMap[key] = {
          vehicleNo: d.vehicleNo,
          driverName: d.driverName,
          teamCode: d.teamCode,
          matched: d.matched,
          totalInstall: 0,
          deliveryCount: 0,
          wallMount: 0,
          stand: 0,
          homeMulti: 0,
          systemAc: 0,
          preVisit: 0,
          moveInstall: 0,
        }
      }
      const c = driverMap[key]
      c.totalInstall += d.totalInstall
      c.deliveryCount++
      c.wallMount += d.wallMount
      c.stand += d.stand
      c.homeMulti += d.homeMulti
      c.systemAc += d.systemAc
      c.preVisit += d.preVisit
      c.moveInstall += d.moveInstall
    }

    // 미매칭 차량번호 목록
    const unmatchedVehicles = [...new Set(
      rows.filter(r => !r.matched && r.vehicleNo).map(r => r.vehicleNo)
    )]

    return NextResponse.json({
      success: true,
      uploadId: upload.id,
      totalRows: rows.length,
      deliveryCount: Object.keys(deliveryMap).length,
      driverCount: Object.keys(driverMap).length,
      unmatchedVehicles,
      headers,
      items: processedItems,
      deliverySummary: Object.values(deliveryMap),
      driverSummary: Object.values(driverMap).sort((a, b) =>
        b.totalInstall - a.totalInstall
      ),
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: '업로드 처리 중 오류가 발생했습니다' }, { status: 500 })
  }
}
