import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { REGION_ORDER, REGION_NAMES, type RegionCode } from '@/lib/zipcodeRegion'

// customerName: "기사명 (차량번호)|SAP고객"
function parseCustomerName(cn: string): { driverName: string; vehicleNo: string } {
  const baseLabel = cn.split('|')[0]
  const m = baseLabel.match(/^(.+) \((.+)\)$/)
  if (m) return { driverName: m[1], vehicleNo: m[2] }
  return { driverName: baseLabel, vehicleNo: '' }
}

// 연속근무일수: 일(day) 번호 집합에서 최장 연속 구간
function maxConsecutive(days: Set<number>): number {
  const sorted = [...days].sort((a, b) => a - b)
  let best = 0, cur = 0, prev = -99
  for (const d of sorted) {
    cur = d === prev + 1 ? cur + 1 : 1
    if (cur > best) best = cur
    prev = d
  }
  return best
}

interface DriverAgg {
  driverName: string
  vehicleNo: string
  teamCode: string
  route: string
  cellName: string
  workDays: Set<string>
  dayNums: Set<number>
  delivSeen: Set<string>
  deliveryCount: number
  totalInstall: number
  wallMount: number
  stand: number
  homeMulti: number
  systemAc: number
  commercial: number
  moveInstall: number
  preVisitSeen: Set<string>
  region: Record<RegionCode, number>
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()))
    const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1))
    const route = searchParams.get('route') // '0601' | '0602' | null
    // 기간 지정(달력): start~end (YYYY-MM-DD). 둘 다 있으면 구간 집계, 없으면 월 집계
    const startParam = searchParams.get('start')
    const endParam = searchParams.get('end')
    const isRange = !!(startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) && endParam && /^\d{4}-\d{2}-\d{2}$/.test(endParam))
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`

    // 작업일 + 세션 + 레코드 (구간 또는 월)
    const workDates = await prisma.workDate.findMany({
      where: isRange
        ? { date: { gte: startParam!, lte: endParam! } }
        : { date: { startsWith: monthPrefix } },
      include: { sessions: { include: { records: true } } },
      orderBy: { date: 'asc' },
    })

    // 기사 마스터 (teamName 기준 보강)
    const drivers = await prisma.driver.findMany({
      select: { teamCode: true, teamName: true, route: true, vehicleNumber: true, cellName: true },
    })
    const driverInfo = new Map(drivers.map(d => [d.teamName, d]))

    const emptyRegion = (): Record<RegionCode, number> =>
      ({ A: 0, B: 0, C: 0, D: 0, E: 0, UNKNOWN: 0 })

    const aggMap = new Map<string, DriverAgg>()
    const getAgg = (driverName: string, vehicleNo: string): DriverAgg => {
      const key = driverName || 'UNKNOWN'
      let a = aggMap.get(key)
      if (!a) {
        const info = driverInfo.get(driverName)
        a = {
          driverName,
          vehicleNo: vehicleNo || info?.vehicleNumber || '',
          teamCode: info?.teamCode || '',
          route: info?.route || '',
          cellName: info?.cellName || '',
          workDays: new Set(), dayNums: new Set(), delivSeen: new Set(),
          deliveryCount: 0, totalInstall: 0,
          wallMount: 0, stand: 0, homeMulti: 0, systemAc: 0, commercial: 0, moveInstall: 0,
          preVisitSeen: new Set(), region: emptyRegion(),
        }
        aggMap.set(key, a)
      }
      return a
    }

    const workDateList: string[] = []
    for (const wd of workDates) {
      // 날짜별 대표 세션 (당일 우선, 없으면 전일)
      const session =
        wd.sessions.find(s => s.uploadType === 'SAME_DAY_DELIVERY') ??
        wd.sessions.find(s => s.uploadType === 'PREV_DELIVERY') ??
        wd.sessions[0]
      if (!session || session.records.length === 0) continue
      workDateList.push(wd.date)
      const dayNum = parseInt(wd.date.slice(8, 10))

      for (const r of session.records) {
        const { driverName, vehicleNo } = parseCustomerName(r.customerName)
        const a = getAgg(driverName, vehicleNo)
        a.workDays.add(wd.date)
        a.dayNums.add(dayNum)
        a.totalInstall += r.installCount

        if (r.modelType === 'WALL_MOUNT') a.wallMount += r.installCount
        else if (r.modelType === 'STAND') a.stand += r.installCount
        else if (r.modelType === 'HOME_MULTI') a.homeMulti += r.installCount
        else if (r.modelType === 'SYSTEM_4WAY' || r.modelType === 'SYSTEM_1WAY' || r.modelType === 'SYSTEM_AC') a.systemAc += r.installCount
        else if (r.modelType === 'COMMERCIAL') a.commercial += r.installCount
        else if (r.modelType === 'MOVE_INSTALL') a.moveInstall += r.installCount

        // Delivery 단위(날짜+번호) 1회: 배송건 + 구역
        const dkey = `${wd.date}|${r.deliveryNo}`
        if (!a.delivSeen.has(dkey)) {
          a.delivSeen.add(dkey)
          a.deliveryCount++
          const reg = (r.region as RegionCode) || 'UNKNOWN'
          a.region[reg] = (a.region[reg] ?? 0) + 1
        }
        if (r.modelType === 'PRE_VISIT') a.preVisitSeen.add(dkey)
      }
    }

    let list = [...aggMap.values()].map(a => ({
      driverName: a.driverName,
      vehicleNo: a.vehicleNo,
      teamCode: a.teamCode,
      route: a.route,
      cellName: a.cellName,
      workDays: a.workDays.size,
      maxConsecutive: maxConsecutive(a.dayNums),
      deliveryCount: a.deliveryCount,
      totalInstall: a.totalInstall,
      wallMount: a.wallMount,
      stand: a.stand,
      homeMulti: a.homeMulti,
      systemAc: a.systemAc,
      commercial: a.commercial,
      moveInstall: a.moveInstall,
      preVisit: a.preVisitSeen.size,
      region: a.region,
    }))

    if (route) list = list.filter(d => d.route === route)
    list.sort((a, b) => b.totalInstall - a.totalInstall || a.driverName.localeCompare(b.driverName))

    // 총괄
    const totals = {
      driverCount: list.length,
      workDateCount: workDateList.length,
      deliveryCount: list.reduce((s, d) => s + d.deliveryCount, 0),
      totalInstall: list.reduce((s, d) => s + d.totalInstall, 0),
      wallMount: list.reduce((s, d) => s + d.wallMount, 0),
      stand: list.reduce((s, d) => s + d.stand, 0),
      homeMulti: list.reduce((s, d) => s + d.homeMulti, 0),
      systemAc: list.reduce((s, d) => s + d.systemAc, 0),
      commercial: list.reduce((s, d) => s + d.commercial, 0),
      moveInstall: list.reduce((s, d) => s + d.moveInstall, 0),
      preVisit: list.reduce((s, d) => s + d.preVisit, 0),
      region: REGION_ORDER.reduce((acc, r) => {
        acc[r] = list.reduce((s, d) => s + (d.region[r] ?? 0), 0)
        return acc
      }, {} as Record<RegionCode, number>),
    }

    return NextResponse.json({
      year, month,
      mode: isRange ? 'range' : 'month',
      start: isRange ? startParam : null,
      end: isRange ? endParam : null,
      periodLabel: isRange ? `${startParam} ~ ${endParam}` : `${year}년 ${month}월`,
      regionOrder: REGION_ORDER,
      regionNames: REGION_NAMES,
      drivers: list,
      totals,
    })
  } catch (error) {
    console.error('Monthly summary error:', error)
    return NextResponse.json({ error: '월별 집계 조회 중 오류가 발생했습니다' }, { status: 500 })
  }
}
