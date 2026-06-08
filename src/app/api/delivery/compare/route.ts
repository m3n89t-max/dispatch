import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function parseCustomerName(cn: string): { driverName: string; vehicleNo: string; sapCustomer: string } {
  // customerName format: "기사명 (차량번호)|SAP고객" 또는 "기사명 (차량번호)"
  const parts = cn.split('|')
  const baseLabel = parts[0]
  const sapCustomer = parts[1] || ''
  const m = baseLabel.match(/^(.+) \((.+)\)$/)
  if (m) return { driverName: m[1], vehicleNo: m[2], sapCustomer }
  return { driverName: baseLabel, vehicleNo: '', sapCustomer }
}

type DbRecord = { deliveryNo: string; customerName: string; modelType: string; installCount: number }

function buildDriverSummary(records: DbRecord[]) {
  // Delivery 단위 집계
  const deliveryMap: Record<string, {
    driverName: string; vehicleNo: string
    totalInstall: number; wallMount: number; stand: number
    homeMulti: number; systemAc: number; preVisit: number; moveInstall: number
  }> = {}

  for (const r of records) {
    if (!deliveryMap[r.deliveryNo]) {
      const { driverName, vehicleNo } = parseCustomerName(r.customerName)
      deliveryMap[r.deliveryNo] = {
        driverName, vehicleNo, totalInstall: 0,
        wallMount: 0, stand: 0, homeMulti: 0, systemAc: 0, preVisit: 0, moveInstall: 0,
      }
    }
    const d = deliveryMap[r.deliveryNo]
    d.totalInstall += r.installCount
    // installCount 기반 (family dedup으로 0인 row는 카운트 안 함)
    if (r.modelType === 'WALL_MOUNT') d.wallMount += r.installCount
    else if (r.modelType === 'STAND') d.stand += r.installCount
    else if (r.modelType === 'HOME_MULTI') d.homeMulti += r.installCount
    else if (r.modelType === 'SYSTEM_AC') d.systemAc += r.installCount
    else if (r.modelType === 'PRE_VISIT') d.preVisit += r.installCount
    else if (r.modelType === 'MOVE_INSTALL') d.moveInstall += r.installCount
  }

  // 기사 단위 집계
  const driverMap: Record<string, {
    driverName: string; vehicleNo: string; deliveryNos: string[]
    deliveryCount: number; totalInstall: number
    wallMount: number; stand: number; homeMulti: number
    systemAc: number; preVisit: number; moveInstall: number
  }> = {}

  for (const [deliveryNo, d] of Object.entries(deliveryMap)) {
    const key = d.driverName || 'UNKNOWN'
    if (!driverMap[key]) {
      driverMap[key] = {
        driverName: d.driverName, vehicleNo: d.vehicleNo,
        deliveryNos: [], deliveryCount: 0, totalInstall: 0,
        wallMount: 0, stand: 0, homeMulti: 0, systemAc: 0, preVisit: 0, moveInstall: 0,
      }
    }
    const c = driverMap[key]
    c.deliveryNos.push(deliveryNo)
    c.deliveryCount++
    c.totalInstall += d.totalInstall
    c.wallMount += d.wallMount
    c.stand += d.stand
    c.homeMulti += d.homeMulti
    c.systemAc += d.systemAc
    c.preVisit += d.preVisit
    c.moveInstall += d.moveInstall
  }

  return Object.values(driverMap).sort((a, b) => b.totalInstall - a.totalInstall)
}

function buildComparison(prevRecords: DbRecord[], sameDayRecords: DbRecord[]) {
  const prevMap: Record<string, { driverName: string; vehicleNo: string; installCount: number }> = {}
  for (const r of prevRecords) {
    if (!prevMap[r.deliveryNo]) {
      const { driverName, vehicleNo } = parseCustomerName(r.customerName)
      prevMap[r.deliveryNo] = { driverName, vehicleNo, installCount: 0 }
    }
    prevMap[r.deliveryNo].installCount += r.installCount
  }

  const sameDayMap: Record<string, { driverName: string; vehicleNo: string; installCount: number }> = {}
  for (const r of sameDayRecords) {
    if (!sameDayMap[r.deliveryNo]) {
      const { driverName, vehicleNo } = parseCustomerName(r.customerName)
      sameDayMap[r.deliveryNo] = { driverName, vehicleNo, installCount: 0 }
    }
    sameDayMap[r.deliveryNo].installCount += r.installCount
  }

  const allDrivers = new Set([
    ...Object.values(prevMap).map(d => d.driverName),
    ...Object.values(sameDayMap).map(d => d.driverName),
  ])

  return [...allDrivers].map(driverName => {
    const prevEntries = Object.entries(prevMap).filter(([, d]) => d.driverName === driverName)
    const sameDayEntries = Object.entries(sameDayMap).filter(([, d]) => d.driverName === driverName)
    const prevNos = new Set(prevEntries.map(([no]) => no))
    const sameDayNos = new Set(sameDayEntries.map(([no]) => no))

    return {
      driverName,
      vehicleNo: prevEntries[0]?.[1].vehicleNo || sameDayEntries[0]?.[1].vehicleNo || '',
      prevDeliveryCount: prevNos.size,
      prevInstallCount: prevEntries.reduce((s, [, d]) => s + d.installCount, 0),
      sameDayDeliveryCount: sameDayNos.size,
      sameDayInstallCount: sameDayEntries.reduce((s, [, d]) => s + d.installCount, 0),
      maintained: [...prevNos].filter(no => sameDayNos.has(no)).length,
      postponed: [...prevNos].filter(no => !sameDayNos.has(no)).length,
      added: [...sameDayNos].filter(no => !prevNos.has(no)).length,
    }
  }).sort((a, b) => (b.postponed + b.added) - (a.postponed + a.added) || a.driverName.localeCompare(b.driverName))
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: '날짜 형식 오류 (YYYY-MM-DD)' }, { status: 400 })
  }

  const workDate = await prisma.workDate.findUnique({
    where: { date },
    include: {
      sessions: {
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          uploadType: { in: ['PREV_DELIVERY', 'SAME_DAY_DELIVERY'] as any },
        },
        include: { records: true },
        orderBy: { uploadedAt: 'desc' },
      },
    },
  })

  if (!workDate || workDate.sessions.length === 0) {
    return NextResponse.json({
      installDate: date,
      prevSession: null,
      sameDaySession: null,
      comparison: null,
    })
  }

  const prevSession = workDate.sessions.find(s => s.uploadType === 'PREV_DELIVERY')
  const sameDaySession = workDate.sessions.find(s => s.uploadType === 'SAME_DAY_DELIVERY')

  const prevSummary = prevSession ? buildDriverSummary(prevSession.records) : null
  const sameDaySummary = sameDaySession ? buildDriverSummary(sameDaySession.records) : null
  const comparison = (prevSession && sameDaySession)
    ? buildComparison(prevSession.records, sameDaySession.records)
    : null

  return NextResponse.json({
    installDate: date,
    prevSession: prevSession ? {
      id: prevSession.id,
      fileName: prevSession.fileName,
      uploadedAt: prevSession.uploadedAt,
      driverSummary: prevSummary,
      deliveryCount: prevSummary?.reduce((s, d) => s + d.deliveryCount, 0) ?? 0,
      totalInstall: prevSummary?.reduce((s, d) => s + d.totalInstall, 0) ?? 0,
    } : null,
    sameDaySession: sameDaySession ? {
      id: sameDaySession.id,
      fileName: sameDaySession.fileName,
      uploadedAt: sameDaySession.uploadedAt,
      driverSummary: sameDaySummary,
      deliveryCount: sameDaySummary?.reduce((s, d) => s + d.deliveryCount, 0) ?? 0,
      totalInstall: sameDaySummary?.reduce((s, d) => s + d.totalInstall, 0) ?? 0,
    } : null,
    comparison,
  })
}
