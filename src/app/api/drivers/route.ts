import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const route = searchParams.get('route')
    const status = searchParams.get('status')
    const cellName = searchParams.get('cellName')

    const drivers = await prisma.driver.findMany({
      where: {
        ...(route ? { route } : {}),
        ...(status ? { status: status as 'ACTIVE' | 'SUSPENDED' | 'CONTRACT_ENDED' | 'ON_LEAVE' } : {}),
        ...(cellName ? { cellName } : {}),
      },
      orderBy: { teamCode: 'asc' },
    })

    return NextResponse.json(drivers)
  } catch (error) {
    console.error('Drivers GET error:', error)
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      teamCode, teamName, route,
      center, vehicleNumber, vehicleType, vehicleStructure,
      cellName, cellRole, residency,
      contractDone, contractExpectedDate, contractEndDate,
      safetyEduDone, safetyEduDate,
      expertSecured, expertExpectedDate, expertRelation,
      canSupportOther, supportableCenters,
    } = body

    if (!teamCode || !teamName || !route) {
      return NextResponse.json({ error: '필수 항목 누락 (teamCode, teamName, route)' }, { status: 400 })
    }

    if (!['0601', '0602'].includes(route)) {
      return NextResponse.json({ error: '권역은 0601(서귀포) 또는 0602(제주시)여야 합니다' }, { status: 400 })
    }

    const driver = await prisma.driver.create({
      data: {
        teamCode,
        teamName,
        route,
        center: center || null,
        vehicleNumber: vehicleNumber || null,
        vehicleType: vehicleType || null,
        vehicleStructure: vehicleStructure || null,
        cellName: cellName || null,
        cellRole: cellRole || null,
        residency: residency || null,
        contractDone: contractDone === true,
        contractExpectedDate: contractExpectedDate ? new Date(contractExpectedDate) : null,
        contractEndDate: contractEndDate ? new Date(contractEndDate) : null,
        safetyEduDone: safetyEduDone === true,
        safetyEduDate: safetyEduDate ? new Date(safetyEduDate) : null,
        expertSecured: expertSecured === true,
        expertExpectedDate: expertExpectedDate ? new Date(expertExpectedDate) : null,
        expertRelation: expertRelation || null,
        canSupportOther: canSupportOther === true,
        supportableCenters: supportableCenters || null,
      },
    })

    return NextResponse.json(driver, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '생성 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...rest } = body

    if (!id) {
      return NextResponse.json({ error: 'id가 필요합니다' }, { status: 400 })
    }

    const dateFields = ['contractExpectedDate', 'contractEndDate', 'safetyEduDate', 'expertExpectedDate']
    const data: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue
      if (dateFields.includes(key)) {
        data[key] = value ? new Date(value as string) : null
      } else {
        data[key] = value
      }
    }

    const driver = await prisma.driver.update({ where: { id }, data })
    return NextResponse.json(driver)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '수정 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
