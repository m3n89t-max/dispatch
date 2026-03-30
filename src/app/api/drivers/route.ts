import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const route = searchParams.get('route')
    const status = searchParams.get('status')

    const drivers = await prisma.driver.findMany({
      where: {
        ...(route ? { route } : {}),
        ...(status ? { status: status as 'ACTIVE' | 'SUSPENDED' | 'CONTRACT_ENDED' | 'ON_LEAVE' } : {}),
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
    const { teamCode, teamName, route, contractEndDate } = body

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
        ...(contractEndDate ? { contractEndDate: new Date(contractEndDate) } : {}),
      }
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
    const { id, status, contractEndDate, teamName } = body

    if (!id) {
      return NextResponse.json({ error: 'id가 필요합니다' }, { status: 400 })
    }

    const driver = await prisma.driver.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(contractEndDate ? { contractEndDate: new Date(contractEndDate) } : {}),
        ...(teamName ? { teamName } : {}),
      }
    })

    return NextResponse.json(driver)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '수정 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
