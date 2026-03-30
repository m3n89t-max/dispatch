import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as ExcelJS from 'exceljs'
import { judgeModelType, getInstallCount } from '@/lib/modelJudge'

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
    await workbook.xlsx.load(buffer)

    const worksheet = workbook.getWorksheet(1)
    if (!worksheet) {
      return NextResponse.json({ error: '워크시트를 찾을 수 없습니다' }, { status: 400 })
    }

    interface RowData {
      teamCode: string
      teamName: string
      route: string
      matnr: string
      augru: string
      quantity: number
    }

    const rows: RowData[] = []
    worksheet.eachRow((row: ExcelJS.Row, rowNumber: number) => {
      if (rowNumber === 1) return // skip header
      const rowData = row.values as unknown[]
      rows.push({
        teamCode: String(rowData[1] ?? ''),
        teamName: String(rowData[2] ?? ''),
        route: String(rowData[3] ?? ''),
        matnr: String(rowData[4] ?? ''),
        augru: String(rowData[5] ?? ''),
        quantity: Number(rowData[6] ?? 1),
      })
    })

    // Save raw data
    const upload = await prisma.dispatchUpload.create({
      data: {
        uploadDate: new Date(),
        fileName: file.name,
        rawData: rows as unknown as import('@prisma/client').Prisma.JsonArray,
      }
    })

    // Process each row with model type judgment
    const processedItems = rows.map((row: RowData) => {
      const modelType = judgeModelType(row.matnr, row.augru || undefined)
      const installCount = getInstallCount(modelType)
      return {
        teamCode: row.teamCode,
        teamName: row.teamName,
        route: row.route,
        matnr: row.matnr,
        augru: row.augru,
        quantity: row.quantity,
        modelType,
        installCount,
      }
    })

    // Group by team and calculate totals
    const teamSummary: Record<string, { teamCode: string; teamName: string; route: string; totalInstall: number; itemCount: number }> = {}
    for (const item of processedItems) {
      const key = item.teamCode || 'UNKNOWN'
      if (!teamSummary[key]) {
        teamSummary[key] = {
          teamCode: item.teamCode,
          teamName: item.teamName,
          route: item.route,
          totalInstall: 0,
          itemCount: 0,
        }
      }
      teamSummary[key].totalInstall += item.installCount * item.quantity
      teamSummary[key].itemCount++
    }

    return NextResponse.json({
      success: true,
      uploadId: upload.id,
      totalRows: rows.length,
      teamCount: Object.keys(teamSummary).length,
      items: processedItems,
      teamSummary: Object.values(teamSummary),
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: '업로드 처리 중 오류가 발생했습니다' }, { status: 500 })
  }
}
