import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculateWeightedScore, calculateCircularBonus } from '@/lib/scoreEngine'
import { calculateDispatchPriority } from '@/lib/dispatchEngine'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0]
    const route = searchParams.get('route') // "0601" | "0602" | null for all

    const targetDate = new Date(date)
    const thirtyDaysAgo = new Date(targetDate)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const sevenDaysAgo = new Date(targetDate)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    // Get all active drivers
    const drivers = await prisma.driver.findMany({
      where: {
        status: { in: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'CONTRACT_ENDED'] },
        ...(route ? { route } : {}),
      },
      include: {
        performances: {
          where: {
            perfDate: { gte: thirtyDaysAgo, lt: targetDate }
          },
          orderBy: { perfDate: 'desc' }
        },
        dispatches: {
          where: {
            dispatchDate: { gte: thirtyDaysAgo, lt: targetDate }
          },
          orderBy: { dispatchDate: 'desc' },
          take: 10
        },
        leaveRequests: {
          where: {
            requestDate: {
              gte: new Date(new Date(date).setHours(0, 0, 0, 0)),
              lte: new Date(new Date(date).setHours(23, 59, 59, 999)),
            },
            status: 'APPROVED'
          }
        },
        safetyViolations: {
          where: { resolved: false }
        }
      }
    })

    const dispatchInfo = drivers.map(driver => {
      // Check eligibility
      const isOnLeave = driver.leaveRequests.length > 0
      const hasActiveViolation = driver.safetyViolations.length > 0
      const isSuspended = driver.status === 'SUSPENDED'
      const isContractEnded = driver.status === 'CONTRACT_ENDED'

      let isEligible = true
      let ineligibleReason: string | undefined

      if (isContractEnded) {
        isEligible = false
        ineligibleReason = '계약종료'
      } else if (isSuspended) {
        isEligible = false
        ineligibleReason = '배차정지'
      } else if (hasActiveViolation) {
        isEligible = false
        ineligibleReason = '안전위반'
      } else if (isOnLeave) {
        isEligible = false
        ineligibleReason = '휴무'
      }

      // Calculate consecutive days without dispatch
      let consecutiveDays = 0
      const dispatchDates = driver.dispatches
        .map(d => d.dispatchDate.toISOString().split('T')[0])
        .sort((a, b) => b.localeCompare(a))

      const checkDate = new Date(targetDate)
      checkDate.setDate(checkDate.getDate() - 1)

      while (consecutiveDays < 10) {
        const dateStr = checkDate.toISOString().split('T')[0]
        if (dispatchDates.includes(dateStr)) break
        consecutiveDays++
        checkDate.setDate(checkDate.getDate() - 1)
      }

      // Calculate performance scores
      const recent7 = driver.performances
        .filter(p => p.perfDate >= sevenDaysAgo)
        .map(p => ({
          completionRate: p.completionRate ?? undefined,
          deliveryConfirmRate: p.deliveryConfirmRate ?? undefined,
          deliveryMaintainRate: p.deliveryMaintainRate ?? undefined,
          op2Score: p.op2Score ?? undefined,
          npsScore: p.npsScore ?? undefined,
          defectRate: p.defectRate ?? undefined,
        }))

      const past30 = driver.performances
        .filter(p => p.perfDate < sevenDaysAgo)
        .map(p => ({
          completionRate: p.completionRate ?? undefined,
          deliveryConfirmRate: p.deliveryConfirmRate ?? undefined,
          deliveryMaintainRate: p.deliveryMaintainRate ?? undefined,
          op2Score: p.op2Score ?? undefined,
          npsScore: p.npsScore ?? undefined,
          defectRate: p.defectRate ?? undefined,
        }))

      const baseScore = calculateWeightedScore(recent7, past30)
      const circularBonus = calculateCircularBonus(consecutiveDays)

      return {
        driverId: driver.id,
        teamCode: driver.teamCode,
        teamName: driver.teamName,
        route: driver.route,
        baseScore,
        circularBonus,
        totalScore: baseScore + circularBonus,
        consecutiveDaysWithoutDispatch: consecutiveDays,
        isEligible,
        ineligibleReason,
      }
    })

    const prioritized = calculateDispatchPriority(dispatchInfo)
    const ineligible = dispatchInfo.filter(d => !d.isEligible)

    return NextResponse.json({
      date,
      eligible: prioritized,
      ineligible,
      summary: {
        total: dispatchInfo.length,
        eligible: prioritized.length,
        ineligible: ineligible.length,
        byArea: {
          '0601': prioritized.filter(d => d.route === '0601').length,
          '0602': prioritized.filter(d => d.route === '0602').length,
        }
      }
    })

  } catch (error) {
    console.error('Priority error:', error)
    return NextResponse.json({ error: '우선순위 계산 중 오류가 발생했습니다' }, { status: 500 })
  }
}
