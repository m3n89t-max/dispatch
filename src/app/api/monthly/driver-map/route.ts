import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { type RegionCode } from '@/lib/zipcodeRegion'

function parseCustomerName(cn: string): { driverName: string; vehicleNo: string; sapCustomer: string } {
  const parts = cn.split('|')
  const baseLabel = parts[0]
  const sapCustomer = parts[1] || ''
  const m = baseLabel.match(/^(.+) \((.+)\)$/)
  if (m) return { driverName: m[1], vehicleNo: m[2], sapCustomer }
  return { driverName: baseLabel, vehicleNo: '', sapCustomer }
}

// 특정 기사의 한 달치 배송 지도 좌표(byZipcode) — 클릭 시 lazy 로드
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()))
    const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1))
    const driverName = searchParams.get('driverName')
    if (!driverName) return NextResponse.json({ error: 'driverName 필수' }, { status: 400 })
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`

    const workDates = await prisma.workDate.findMany({
      where: { date: { startsWith: monthPrefix } },
      include: { sessions: { include: { records: true } } },
      orderBy: { date: 'asc' },
    })

    interface Dot {
      deliveryNo: string; driverName: string; vehicleNo: string
      customerName: string; address: string; zipcode: string; region: RegionCode
    }
    const byZipcode = new Map<string, {
      zipcode: string; region: RegionCode; count: number; sampleAddress: string; deliveries: Dot[]
    }>()
    const seen = new Set<string>() // date|deliveryNo 1회

    for (const wd of workDates) {
      const session =
        wd.sessions.find(s => s.uploadType === 'SAME_DAY_DELIVERY') ??
        wd.sessions.find(s => s.uploadType === 'PREV_DELIVERY') ??
        wd.sessions[0]
      if (!session) continue

      for (const r of session.records) {
        const { driverName: dn, vehicleNo, sapCustomer } = parseCustomerName(r.customerName)
        if (dn !== driverName) continue
        const dkey = `${wd.date}|${r.deliveryNo}`
        if (seen.has(dkey)) continue
        seen.add(dkey)
        if (!r.zipcode) continue
        const region = (r.region as RegionCode) || 'UNKNOWN'
        const dot: Dot = {
          deliveryNo: r.deliveryNo, driverName: dn, vehicleNo,
          customerName: sapCustomer || dn, address: r.address || '', zipcode: r.zipcode, region,
        }
        const ex = byZipcode.get(r.zipcode)
        if (ex) {
          ex.count++
          if (!ex.sampleAddress && r.address) ex.sampleAddress = r.address
          ex.deliveries.push(dot)
        } else {
          byZipcode.set(r.zipcode, {
            zipcode: r.zipcode, region, count: 1, sampleAddress: r.address || '', deliveries: [dot],
          })
        }
      }
    }

    return NextResponse.json({
      year, month, driverName,
      points: [...byZipcode.values()],
    })
  } catch (error) {
    console.error('Monthly driver-map error:', error)
    return NextResponse.json({ error: '기사 지도 조회 중 오류' }, { status: 500 })
  }
}
