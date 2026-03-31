import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * 기사별 납기확정률 / 설치완료율 분석
 * 날씨(맑음/비) 분리 비교 포함
 *
 * 계산 방식 (Delivery 번호 기준 매칭):
 *   납기확정률 = DISPATCH에 있는 Delivery 중 CONFIRM에도 있는 비율
 *   설치완료율 = DISPATCH에 있는 Delivery 중 COMPLETE에도 있는 비율
 *   납기완료율 = CONFIRM에 있는 Delivery 중 COMPLETE에도 있는 비율
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') // YYYY-MM-DD
  const to = searchParams.get('to')

  if (!from || !to) {
    return NextResponse.json({ error: 'from, to 날짜 필수' }, { status: 400 })
  }

  // 날짜 범위 내 WorkDate + sessions + records 조회
  const workDates = await prisma.workDate.findMany({
    where: { date: { gte: from, lte: to } },
    include: {
      sessions: {
        include: { records: true },
      },
    },
    orderBy: { date: 'asc' },
  })

  // 기사별 통계 누적
  type DriverStat = {
    customerName: string
    // 전체
    dispatched: number      // 전일배차 Delivery 건수
    confirmed: number       // 납기확정 Delivery 건수
    completed: number       // 설치완료 Delivery 건수
    // 맑은날
    clearDispatched: number
    clearConfirmed: number
    clearCompleted: number
    // 비오는날
    rainyDispatched: number
    rainyConfirmed: number
    rainyCompleted: number
    // 설치대수
    dispatchedInstall: number
    confirmedInstall: number
    completedInstall: number
    // 날짜별 데이터
    days: { date: string; isRainy: boolean; dispatched: number; confirmed: number; completed: number }[]
  }

  const driverStats: Record<string, DriverStat> = {}

  for (const wd of workDates) {
    const isRainy = wd.isRainy

    // 이 날의 DISPATCH / CONFIRM / COMPLETE 세션에서 Delivery 번호 추출
    const dispatchDeliveries = new Map<string, { customerName: string; installCount: number }>()
    const confirmDeliveries = new Set<string>()
    const completeDeliveries = new Set<string>()

    for (const session of wd.sessions) {
      if (session.uploadType === 'DISPATCH') {
        // Delivery 단위로 중복 제거 (같은 Delivery에 여러 행)
        for (const r of session.records) {
          if (!dispatchDeliveries.has(r.deliveryNo)) {
            dispatchDeliveries.set(r.deliveryNo, {
              customerName: r.customerName,
              installCount: 0,
            })
          }
          dispatchDeliveries.get(r.deliveryNo)!.installCount += r.installCount
        }
      } else if (session.uploadType === 'CONFIRM') {
        for (const r of session.records) {
          confirmDeliveries.add(r.deliveryNo)
        }
      } else if (session.uploadType === 'COMPLETE') {
        for (const r of session.records) {
          completeDeliveries.add(r.deliveryNo)
        }
      }
    }

    // 기사별로 이 날의 수치 집계
    // dispatchDeliveries를 기준으로 기사별 그룹핑
    const driverDayMap: Record<string, { dispatched: number; confirmed: number; completed: number; installCount: number }> = {}

    for (const [deliveryNo, info] of dispatchDeliveries) {
      const name = info.customerName || 'UNKNOWN'
      if (!driverDayMap[name]) {
        driverDayMap[name] = { dispatched: 0, confirmed: 0, completed: 0, installCount: 0 }
      }
      driverDayMap[name].dispatched++
      driverDayMap[name].installCount += info.installCount
      if (confirmDeliveries.has(deliveryNo)) driverDayMap[name].confirmed++
      if (completeDeliveries.has(deliveryNo)) driverDayMap[name].completed++
    }

    // 전체 stats에 누적
    for (const [name, day] of Object.entries(driverDayMap)) {
      if (!driverStats[name]) {
        driverStats[name] = {
          customerName: name,
          dispatched: 0, confirmed: 0, completed: 0,
          clearDispatched: 0, clearConfirmed: 0, clearCompleted: 0,
          rainyDispatched: 0, rainyConfirmed: 0, rainyCompleted: 0,
          dispatchedInstall: 0, confirmedInstall: 0, completedInstall: 0,
          days: [],
        }
      }
      const s = driverStats[name]
      s.dispatched += day.dispatched
      s.confirmed += day.confirmed
      s.completed += day.completed
      s.dispatchedInstall += day.installCount

      if (isRainy) {
        s.rainyDispatched += day.dispatched
        s.rainyConfirmed += day.confirmed
        s.rainyCompleted += day.completed
      } else {
        s.clearDispatched += day.dispatched
        s.clearConfirmed += day.confirmed
        s.clearCompleted += day.completed
      }

      s.days.push({
        date: wd.date,
        isRainy,
        dispatched: day.dispatched,
        confirmed: day.confirmed,
        completed: day.completed,
      })
    }
  }

  // 비율 계산 후 정렬
  const result = Object.values(driverStats).map(s => {
    const pct = (a: number, b: number) => b === 0 ? null : Math.round((a / b) * 1000) / 10

    return {
      customerName: s.customerName,
      // 전체
      dispatched: s.dispatched,
      confirmed: s.confirmed,
      completed: s.completed,
      confirmRate: pct(s.confirmed, s.dispatched),       // 납기확정률
      completeRate: pct(s.completed, s.dispatched),      // 설치완료율 (배차 대비)
      confirmToComplete: pct(s.completed, s.confirmed),  // 납기 → 완료율
      // 맑은날
      clearDispatched: s.clearDispatched,
      clearConfirmRate: pct(s.clearConfirmed, s.clearDispatched),
      clearCompleteRate: pct(s.clearCompleted, s.clearDispatched),
      // 비오는날
      rainyDispatched: s.rainyDispatched,
      rainyConfirmRate: pct(s.rainyConfirmed, s.rainyDispatched),
      rainyCompleteRate: pct(s.rainyCompleted, s.rainyDispatched),
      // 날씨 영향도 (맑음 - 비 차이)
      weatherImpact: (() => {
        const c = pct(s.clearCompleted, s.clearDispatched)
        const r = pct(s.rainyCompleted, s.rainyDispatched)
        return c !== null && r !== null ? Math.round((c - r) * 10) / 10 : null
      })(),
      // 설치대수
      dispatchedInstall: s.dispatchedInstall,
      days: s.days,
    }
  }).sort((a, b) => (b.confirmRate ?? 0) - (a.confirmRate ?? 0))

  // 날짜별 요약 (날씨 현황)
  const dateSummary = workDates.map(wd => {
    const hasDispatch = wd.sessions.some(s => s.uploadType === 'DISPATCH')
    const hasConfirm = wd.sessions.some(s => s.uploadType === 'CONFIRM')
    const hasComplete = wd.sessions.some(s => s.uploadType === 'COMPLETE')
    return {
      date: wd.date,
      isRainy: wd.isRainy,
      note: wd.note,
      hasDispatch,
      hasConfirm,
      hasComplete,
    }
  })

  return NextResponse.json({
    from,
    to,
    totalDays: workDates.length,
    rainyDays: workDates.filter(w => w.isRainy).length,
    drivers: result,
    dateSummary,
  })
}
