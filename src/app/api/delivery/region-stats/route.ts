import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { REGION_ORDER, REGION_NAMES, emptyRegionCounter, type RegionCode } from '@/lib/zipcodeRegion'

/**
 * 기간/기사 필터링된 구역별 누적 집계
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&driverName=옵션&uploadType=PREV_DELIVERY|SAME_DAY_DELIVERY
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const driverName = searchParams.get('driverName')
  const uploadType = searchParams.get('uploadType') ?? 'PREV_DELIVERY'

  if (!from || !to) {
    return NextResponse.json({ error: 'from, to (YYYY-MM-DD) 필수' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: '날짜 형식 오류 (YYYY-MM-DD)' }, { status: 400 })
  }

  try {
    // 기간 내 WorkDate → DeliverySession → DeliveryRecord
    const records = await prisma.deliveryRecord.findMany({
      where: {
        session: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          uploadType: uploadType as any,
          workDate: {
            date: { gte: from, lte: to },
          },
        },
      },
      select: {
        deliveryNo: true,
        customerName: true,
        zipcode: true,
        address: true,
        region: true,
        session: {
          select: { workDate: { select: { date: true } } },
        },
      },
    })

    // customerName에서 driverName 추출 ("기사명 (차량번호)|SAP고객" → "기사명")
    const parseDriverName = (cn: string): string => {
      const m = cn.split('|')[0].match(/^(.+) \(/)
      return m ? m[1] : cn.split('|')[0]
    }

    interface DeliveryDot {
      deliveryNo: string
      driverName: string
      vehicleNo: string
      customerName: string
      address: string
      zipcode: string
      region: RegionCode
    }
    const seenByDate = new Map<string, Set<string>>() // 날짜+deliveryNo dedup
    const regionTotal = emptyRegionCounter()
    const byDriver = new Map<string, Record<RegionCode, number>>()
    const byZipcode = new Map<string, {
      region: RegionCode
      count: number
      sampleAddress: string
      deliveries: DeliveryDot[]
    }>()

    for (const r of records) {
      const date = r.session.workDate.date
      const dn = parseDriverName(r.customerName)

      if (driverName && dn !== driverName) continue

      // 같은 날짜 + deliveryNo는 중복 카운팅 방지
      if (!seenByDate.has(date)) seenByDate.set(date, new Set())
      const dateSet = seenByDate.get(date)!
      const key = `${dn}::${r.deliveryNo}`
      if (dateSet.has(key)) continue
      dateSet.add(key)

      const region = (r.region as RegionCode | null) ?? 'UNKNOWN'
      regionTotal[region] = (regionTotal[region] ?? 0) + 1

      if (!byDriver.has(dn)) byDriver.set(dn, emptyRegionCounter())
      byDriver.get(dn)![region] = (byDriver.get(dn)![region] ?? 0) + 1

      if (r.zipcode) {
        // customerName format: "기사명 (차량번호)|SAP고객"
        const baseLabel = r.customerName.split('|')[0]
        const m = baseLabel.match(/^(.+) \((.+)\)$/)
        const vehicleNo = m ? m[2] : ''
        const sapCustomer = r.customerName.split('|')[1] || ''
        const dot: DeliveryDot = {
          deliveryNo: r.deliveryNo,
          driverName: dn,
          vehicleNo,
          customerName: sapCustomer || dn,
          address: r.address ?? '',
          zipcode: r.zipcode,
          region,
        }
        const existing = byZipcode.get(r.zipcode)
        if (existing) {
          existing.count += 1
          if (!existing.sampleAddress && r.address) existing.sampleAddress = r.address
          existing.deliveries.push(dot)
        } else {
          byZipcode.set(r.zipcode, {
            region, count: 1, sampleAddress: r.address ?? '',
            deliveries: [dot],
          })
        }
      }
    }

    return NextResponse.json({
      from, to, uploadType,
      driverName: driverName || null,
      total: regionTotal,
      byDriver: Array.from(byDriver.entries())
        .map(([driverName, counts]) => ({
          driverName,
          counts,
          sum: REGION_ORDER.reduce((s, r) => s + (counts[r] ?? 0), 0),
        }))
        .sort((a, b) => b.sum - a.sum),
      byZipcode: Array.from(byZipcode.entries()).map(([zipcode, info]) => ({ zipcode, ...info })),
      regionOrder: REGION_ORDER,
      regionNames: REGION_NAMES,
    })
  } catch (e) {
    console.error('region-stats error:', e)
    return NextResponse.json({ error: '집계 중 오류' }, { status: 500 })
  }
}
