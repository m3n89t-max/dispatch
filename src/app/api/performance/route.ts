import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculateDailyScore, calculateDeliveryMaintainRate, calculateCompletionRate } from '@/lib/scoreEngine'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { driverId, perfDate, completionRate, op2Score, npsScore, defectRate, deliveryConfirmRate, deliveryMaintainRate } = body

    if (!driverId || !perfDate) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다' }, { status: 400 })
    }

    // Validate ranges (0-100)
    const validate = (val: number | undefined, name: string) => {
      if (val !== undefined && (val < 0 || val > 100)) {
        throw new Error(`${name}은(는) 0-100 사이여야 합니다`)
      }
    }

    validate(completionRate, '완료율')
    validate(op2Score, 'OP2')
    validate(npsScore, 'NPS')
    validate(defectRate, '불량률')
    validate(deliveryConfirmRate, '납기확정률')
    validate(deliveryMaintainRate, '납기유지율')

    const totalScore = calculateDailyScore({
      completionRate,
      deliveryConfirmRate,
      deliveryMaintainRate,
      op2Score,
      npsScore,
      defectRate,
    })

    const perf = await prisma.dailyPerformance.upsert({
      where: {
        driverId_perfDate: {
          driverId,
          perfDate: new Date(perfDate),
        }
      },
      update: {
        completionRate,
        op2Score,
        npsScore,
        defectRate,
        deliveryConfirmRate,
        deliveryMaintainRate,
        totalScore,
        updatedAt: new Date(),
      },
      create: {
        driverId,
        perfDate: new Date(perfDate),
        completionRate,
        op2Score,
        npsScore,
        defectRate,
        deliveryConfirmRate,
        deliveryMaintainRate,
        totalScore,
      }
    })

    return NextResponse.json({ success: true, performance: perf })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '저장 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get('driverId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const performances = await prisma.dailyPerformance.findMany({
      where: {
        ...(driverId ? { driverId } : {}),
        ...(startDate && endDate ? {
          perfDate: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          }
        } : {}),
      },
      include: { driver: true },
      orderBy: { perfDate: 'desc' },
    })

    return NextResponse.json(performances)
  } catch (error) {
    console.error('Performance GET error:', error)
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다' }, { status: 500 })
  }
}

// Utility export for use in other routes
export { calculateDeliveryMaintainRate, calculateCompletionRate }
