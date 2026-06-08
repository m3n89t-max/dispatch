import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function parseCustomerName(cn: string): { driverName: string; vehicleNo: string; sapCustomer: string } {
  // customerName format: "기사명 (차량번호)|SAP고객"
  const parts = cn.split('|')
  const baseLabel = parts[0]
  const sapCustomer = parts[1] || ''
  const m = baseLabel.match(/^(.+) \((.+)\)$/)
  if (m) return { driverName: m[1], vehicleNo: m[2], sapCustomer }
  return { driverName: baseLabel, vehicleNo: '', sapCustomer }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const driverName = searchParams.get('driverName')
  const uploadType = searchParams.get('uploadType') // PREV_DELIVERY | SAME_DAY_DELIVERY

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: '날짜 형식 오류 (YYYY-MM-DD)' }, { status: 400 })
  }
  if (!driverName) {
    return NextResponse.json({ error: 'driverName 필수' }, { status: 400 })
  }
  if (!uploadType || !['PREV_DELIVERY', 'SAME_DAY_DELIVERY'].includes(uploadType)) {
    return NextResponse.json({ error: 'uploadType 필수 (PREV_DELIVERY | SAME_DAY_DELIVERY)' }, { status: 400 })
  }

  const workDate = await prisma.workDate.findUnique({
    where: { date },
    include: {
      sessions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: { uploadType: uploadType as any },
        include: { records: true },
        orderBy: { uploadedAt: 'desc' },
      },
    },
  })

  if (!workDate || workDate.sessions.length === 0) {
    return NextResponse.json({ records: [], deliveries: [] })
  }

  const session = workDate.sessions[0]

  // 해당 기사의 레코드만 필터
  const filtered = session.records.filter(r => {
    const { driverName: dn } = parseCustomerName(r.customerName)
    return dn === driverName
  })

  // Delivery 번호 단위로 그룹핑
  const deliveryMap = new Map<string, {
    deliveryNo: string
    customerName: string
    totalInstall: number
    items: { matnr: string; modelType: string; installCount: number }[]
  }>()

  for (const r of filtered) {
    if (!deliveryMap.has(r.deliveryNo)) {
      const { sapCustomer } = parseCustomerName(r.customerName)
      deliveryMap.set(r.deliveryNo, {
        deliveryNo: r.deliveryNo,
        customerName: sapCustomer || r.customerName,
        totalInstall: 0,
        items: [],
      })
    }
    const d = deliveryMap.get(r.deliveryNo)!
    d.totalInstall += r.installCount
    d.items.push({
      matnr: r.matnr,
      modelType: r.modelType,
      installCount: r.installCount,
    })
  }

  const deliveries = [...deliveryMap.values()].sort((a, b) => a.deliveryNo.localeCompare(b.deliveryNo))

  return NextResponse.json({
    date,
    driverName,
    uploadType,
    deliveries,
    totalDeliveries: deliveries.length,
    totalInstall: deliveries.reduce((s, d) => s + d.totalInstall, 0),
  })
}
