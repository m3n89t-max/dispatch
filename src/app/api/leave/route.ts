import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get('driverId')
    const status = searchParams.get('status')
    const date = searchParams.get('date')

    const leaveRequests = await prisma.leaveRequest.findMany({
      where: {
        ...(driverId ? { driverId } : {}),
        ...(status ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' } : {}),
        ...(date ? {
          requestDate: {
            gte: new Date(new Date(date).setHours(0, 0, 0, 0)),
            lte: new Date(new Date(date).setHours(23, 59, 59, 999)),
          }
        } : {}),
      },
      include: { driver: true },
      orderBy: { requestDate: 'desc' },
    })

    return NextResponse.json(leaveRequests)
  } catch (error) {
    console.error('Leave GET error:', error)
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { driverId, requestDate, reason, note } = body

    if (!driverId || !requestDate || !reason) {
      return NextResponse.json({ error: '필수 항목 누락' }, { status: 400 })
    }

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        driverId,
        requestDate: new Date(requestDate),
        reason,
        note,
      },
      include: { driver: true }
    })

    return NextResponse.json(leaveRequest, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '생성 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, status } = body

    if (!id || !status) {
      return NextResponse.json({ error: 'id와 status가 필요합니다' }, { status: 400 })
    }

    const leaveRequest = await prisma.leaveRequest.update({
      where: { id },
      data: { status, updatedAt: new Date() },
      include: { driver: true }
    })

    return NextResponse.json(leaveRequest)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '수정 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
