import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()))
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))

  const mm = String(month).padStart(2, '0')
  const startDate = `${year}-${mm}-01`
  const endDate = `${year}-${mm}-31`

  const workDates = await prisma.workDate.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
      sessions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        some: { uploadType: { in: ['PREV_DELIVERY', 'SAME_DAY_DELIVERY'] as any } },
      },
    },
    include: {
      sessions: {
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          uploadType: { in: ['PREV_DELIVERY', 'SAME_DAY_DELIVERY'] as any },
        },
        include: {
          records: { select: { installCount: true } },
        },
      },
    },
    orderBy: { date: 'asc' },
  })

  const dates = workDates.map(wd => {
    const prevSession = wd.sessions.find(s => s.uploadType === 'PREV_DELIVERY')
    const sameDaySession = wd.sessions.find(s => s.uploadType === 'SAME_DAY_DELIVERY')

    return {
      date: wd.date,
      hasPrev: !!prevSession,
      hasSameDay: !!sameDaySession,
      prevInstallCount: prevSession?.records.reduce((s, r) => s + r.installCount, 0) ?? 0,
      sameDayInstallCount: sameDaySession?.records.reduce((s, r) => s + r.installCount, 0) ?? 0,
    }
  })

  return NextResponse.json({ dates })
}
