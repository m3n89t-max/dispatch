import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()))
    const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1))
    const route = searchParams.get('route')

    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0, 23, 59, 59)

    const performances = await prisma.dailyPerformance.findMany({
      where: {
        perfDate: { gte: startDate, lte: endDate },
        ...(route ? { driver: { route } } : {}),
      },
      include: { driver: true },
      orderBy: [{ driver: { teamCode: 'asc' } }, { perfDate: 'asc' }],
    })

    // Group by driver
    const driverMap: Record<string, {
      driver: { id: string; teamCode: string; teamName: string; route: string };
      perfCount: number;
      avgCompletionRate: number;
      avgOp2Score: number;
      avgNpsScore: number;
      avgDefectRate: number;
      avgDeliveryConfirmRate: number;
      avgDeliveryMaintainRate: number;
      avgTotalScore: number;
    }> = {}

    for (const perf of performances) {
      const key = perf.driverId
      if (!driverMap[key]) {
        driverMap[key] = {
          driver: {
            id: perf.driver.id,
            teamCode: perf.driver.teamCode,
            teamName: perf.driver.teamName,
            route: perf.driver.route,
          },
          perfCount: 0,
          avgCompletionRate: 0,
          avgOp2Score: 0,
          avgNpsScore: 0,
          avgDefectRate: 0,
          avgDeliveryConfirmRate: 0,
          avgDeliveryMaintainRate: 0,
          avgTotalScore: 0,
        }
      }

      const d = driverMap[key]
      d.perfCount++
      d.avgCompletionRate += perf.completionRate || 0
      d.avgOp2Score += perf.op2Score || 0
      d.avgNpsScore += perf.npsScore || 0
      d.avgDefectRate += perf.defectRate || 0
      d.avgDeliveryConfirmRate += perf.deliveryConfirmRate || 0
      d.avgDeliveryMaintainRate += perf.deliveryMaintainRate || 0
      d.avgTotalScore += perf.totalScore || 0
    }

    // Calculate averages
    const monthlyStats = Object.values(driverMap).map(d => ({
      ...d,
      avgCompletionRate: d.perfCount > 0 ? d.avgCompletionRate / d.perfCount : 0,
      avgOp2Score: d.perfCount > 0 ? d.avgOp2Score / d.perfCount : 0,
      avgNpsScore: d.perfCount > 0 ? d.avgNpsScore / d.perfCount : 0,
      avgDefectRate: d.perfCount > 0 ? d.avgDefectRate / d.perfCount : 0,
      avgDeliveryConfirmRate: d.perfCount > 0 ? d.avgDeliveryConfirmRate / d.perfCount : 0,
      avgDeliveryMaintainRate: d.perfCount > 0 ? d.avgDeliveryMaintainRate / d.perfCount : 0,
      avgTotalScore: d.perfCount > 0 ? d.avgTotalScore / d.perfCount : 0,
    })).sort((a, b) => b.avgTotalScore - a.avgTotalScore)

    return NextResponse.json({
      year,
      month,
      driverCount: monthlyStats.length,
      stats: monthlyStats,
    })
  } catch (error) {
    console.error('Monthly GET error:', error)
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다' }, { status: 500 })
  }
}
