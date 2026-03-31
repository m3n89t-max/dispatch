import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as ExcelJS from 'exceljs'
import { judgeModelType, getInstallCount } from '@/lib/modelJudge'

// SAP 납기전 배차 엑셀 컬럼 (1-indexed, ExcelJS)
// [1]=Delivery [2]=ShippingPoint [3]=S.Org [4]=Material [5]=Qty [6]=Unit [7]=Customer

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

// Delivery 번호: 1번째 컬럼
function extractDeliveryNo(values: unknown[]): string {
  return String(values[1] ?? '').trim()
}

// 고객명(기사명): 7번째 컬럼
function extractCustomerName(values: unknown[]): string {
  return String(values[7] ?? '').trim()
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

    interface RowData {
      deliveryNo: string
      customerName: string
      matnr: string
      augru: string
      rawValues: (string | null)[]
    }

    const rows: RowData[] = []
    worksheet.eachRow((row: ExcelJS.Row, rowNumber: number) => {
      if (rowNumber === 1) return // 헤더 스킵
      const vals = row.values as unknown[]

      rows.push({
        deliveryNo: extractDeliveryNo(vals),
        customerName: extractCustomerName(vals),
        matnr: extractMatnr(vals),
        augru: extractAugru(vals),
        rawValues: vals.slice(1).map(v => v == null ? null : String(v)),
      })
    })

    // undefined → null 정리 후 저장 (Prisma JSON 필드는 undefined 불허)
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
        customerName: row.customerName,
        matnr: row.matnr,
        augru: row.augru,
        modelType,
        installCount,
      }
    })

    // Delivery 단위 집계
    const deliveryMap: Record<string, {
      deliveryNo: string
      customerName: string
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
          customerName: item.customerName,
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

    // 기사(고객)별 집계
    const customerMap: Record<string, {
      customerName: string
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
      const key = d.customerName || 'UNKNOWN'
      if (!customerMap[key]) {
        customerMap[key] = {
          customerName: d.customerName,
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
      const c = customerMap[key]
      c.totalInstall += d.totalInstall
      c.deliveryCount++
      c.wallMount += d.wallMount
      c.stand += d.stand
      c.homeMulti += d.homeMulti
      c.systemAc += d.systemAc
      c.preVisit += d.preVisit
      c.moveInstall += d.moveInstall
    }

    return NextResponse.json({
      success: true,
      uploadId: upload.id,
      totalRows: rows.length,
      deliveryCount: Object.keys(deliveryMap).length,
      customerCount: Object.keys(customerMap).length,
      headers,
      items: processedItems,
      deliverySummary: Object.values(deliveryMap),
      customerSummary: Object.values(customerMap),
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: '업로드 처리 중 오류가 발생했습니다' }, { status: 500 })
  }
}
