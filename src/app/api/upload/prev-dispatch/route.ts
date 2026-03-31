import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as ExcelJS from 'exceljs'
import { judgeModelType, getInstallCount } from '@/lib/modelJudge'

// 모델코드 자동 감지: AR/AF/AC로 시작하는 값
function extractMatnr(values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim().toUpperCase()
    if (s.startsWith('AR') || s.startsWith('AF') || s.startsWith('AC')) {
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

// 팀코드: 차량번호처럼 보이는 값 (숫자+한글 혼합) or 첫 번째 값
function extractTeamCode(values: unknown[]): string {
  return String(values[1] ?? '').trim()
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
    let headers: string[] = []
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value ?? '').trim()
    })

    interface RowData {
      teamCode: string
      matnr: string
      augru: string
      rawValues: (string | null)[]
    }

    const rows: RowData[] = []
    worksheet.eachRow((row: ExcelJS.Row, rowNumber: number) => {
      if (rowNumber === 1) return // 헤더 스킵
      const vals = row.values as unknown[]

      const matnr = extractMatnr(vals)
      const augru = extractAugru(vals)
      const teamCode = extractTeamCode(vals)

      rows.push({
        teamCode,
        matnr,
        augru,
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

    // 모델 판정 및 설치대수 계산 (AR/AF/AC만 의미 있음, 나머지 0)
    const processedItems = rows.map(row => {
      const modelType = row.matnr
        ? judgeModelType(row.matnr, row.augru || undefined)
        : 'UNKNOWN'
      const installCount = getInstallCount(modelType as Parameters<typeof getInstallCount>[0])
      return {
        teamCode: row.teamCode,
        matnr: row.matnr,
        augru: row.augru,
        modelType,
        installCount,
      }
    })

    // 팀별 합산
    const teamSummary: Record<string, {
      teamCode: string
      totalInstall: number
      itemCount: number
      wallMount: number
      stand: number
      homeMulti: number
      systemAc: number
      preVisit: number
      unknown: number
    }> = {}

    for (const item of processedItems) {
      const key = item.teamCode || 'UNKNOWN'
      if (!teamSummary[key]) {
        teamSummary[key] = {
          teamCode: item.teamCode,
          totalInstall: 0,
          itemCount: 0,
          wallMount: 0,
          stand: 0,
          homeMulti: 0,
          systemAc: 0,
          preVisit: 0,
          unknown: 0,
        }
      }
      teamSummary[key].totalInstall += item.installCount
      teamSummary[key].itemCount++
      const t = teamSummary[key]
      if (item.modelType === 'WALL_MOUNT') t.wallMount++
      else if (item.modelType === 'STAND') t.stand++
      else if (item.modelType === 'HOME_MULTI') t.homeMulti++
      else if (item.modelType === 'SYSTEM_AC') t.systemAc++
      else if (item.modelType === 'PRE_VISIT') t.preVisit++
      else t.unknown++
    }

    // totalInstall 재계산
    for (const key of Object.keys(teamSummary)) {
      teamSummary[key].totalInstall = processedItems
        .filter(i => (i.teamCode || 'UNKNOWN') === key)
        .reduce((sum, i) => sum + i.installCount, 0)
    }

    return NextResponse.json({
      success: true,
      uploadId: upload.id,
      totalRows: rows.length,
      teamCount: Object.keys(teamSummary).length,
      headers,
      items: processedItems,
      teamSummary: Object.values(teamSummary),
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: '업로드 처리 중 오류가 발생했습니다' }, { status: 500 })
  }
}
