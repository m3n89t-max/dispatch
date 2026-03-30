import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get('driverId')
    const resolved = searchParams.get('resolved')

    const violations = await prisma.safetyViolation.findMany({
      where: {
        ...(driverId ? { driverId } : {}),
        ...(resolved !== null ? { resolved: resolved === 'true' } : {}),
      },
      include: { driver: true },
      orderBy: { occurredAt: 'desc' },
    })

    return NextResponse.json(violations)
  } catch (error) {
    console.error('Safety GET error:', error)
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { driverId, violationType, occurredAt, action } = body

    if (!driverId || !violationType || !occurredAt) {
      return NextResponse.json({ error: '필수 항목 누락' }, { status: 400 })
    }

    const violation = await prisma.safetyViolation.create({
      data: {
        driverId,
        violationType,
        occurredAt: new Date(occurredAt),
        action,
      },
      include: { driver: true }
    })

    // Auto-suspend driver if they have safety violation
    await prisma.driver.update({
      where: { id: driverId },
      data: { status: 'SUSPENDED' }
    })

    return NextResponse.json(violation, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '생성 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, resolved, action } = body

    if (!id) {
      return NextResponse.json({ error: 'id가 필요합니다' }, { status: 400 })
    }

    const violation = await prisma.safetyViolation.update({
      where: { id },
      data: {
        ...(resolved !== undefined ? { resolved } : {}),
        ...(action ? { action } : {}),
      },
      include: { driver: true }
    })

    // If resolved, check if driver can be reactivated
    if (resolved) {
      const remainingViolations = await prisma.safetyViolation.count({
        where: { driverId: violation.driverId, resolved: false }
      })

      if (remainingViolations === 0) {
        await prisma.driver.update({
          where: { id: violation.driverId },
          data: { status: 'ACTIVE' }
        })
      }
    }

    return NextResponse.json(violation)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '수정 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
