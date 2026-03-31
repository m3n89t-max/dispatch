import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 날씨 조회/수정
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') // YYYY-MM-DD
  const to = searchParams.get('to')

  const workDates = await prisma.workDate.findMany({
    where: {
      date: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    },
    include: {
      sessions: {
        select: {
          id: true,
          uploadType: true,
          fileName: true,
          uploadedAt: true,
          _count: { select: { records: true } },
        },
      },
    },
    orderBy: { date: 'desc' },
  })

  return NextResponse.json(workDates)
}

export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const { date, isRainy, note } = body

  const workDate = await prisma.workDate.upsert({
    where: { date },
    update: { isRainy, ...(note !== undefined ? { note } : {}) },
    create: { date, isRainy: isRainy ?? false, note },
  })

  return NextResponse.json(workDate)
}
