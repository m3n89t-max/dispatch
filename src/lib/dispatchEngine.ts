/**
 * 배차 우선순위 엔진
 *
 * 규칙:
 * - 최소 배차: 팀당 2~3대
 * - 순환 배차: 미배차 팀 우선
 * - 고실적 팀 보너스 배차
 * - 제외: 계약종료, 안전위반, 배차정지, 공휴일, 승인된 휴무
 * - 권역 편향 없음 (서귀포/제주시)
 */

export interface DriverDispatchInfo {
  driverId: string
  teamCode: string
  teamName: string
  route: string         // "0601" | "0602"
  baseScore: number
  circularBonus: number
  totalScore: number
  consecutiveDaysWithoutDispatch: number
  isEligible: boolean
  ineligibleReason?: string
}

/**
 * 배차 우선순위 계산 - 총점 기준 내림차순 정렬
 */
export function calculateDispatchPriority(
  drivers: DriverDispatchInfo[]
): DriverDispatchInfo[] {
  return drivers
    .filter(d => d.isEligible)
    .map(d => ({
      ...d,
      totalScore: d.baseScore + d.circularBonus
    }))
    .sort((a, b) => b.totalScore - a.totalScore)
}

/**
 * 권역별 배차 분리
 */
export function distributeByArea(
  drivers: DriverDispatchInfo[],
): Record<string, DriverDispatchInfo[]> {
  const byArea: Record<string, DriverDispatchInfo[]> = {}

  for (const driver of drivers) {
    if (!byArea[driver.route]) byArea[driver.route] = []
    byArea[driver.route].push(driver)
  }

  return byArea
}

/**
 * 최소 배차 보장 (팀당 최소 2대)
 */
export function assignMinimumDispatch(
  drivers: DriverDispatchInfo[],
  minPerTeam: number = 2
): Map<string, number> {
  const assignments = new Map<string, number>()

  for (const driver of drivers) {
    if (driver.isEligible) {
      assignments.set(driver.driverId, minPerTeam)
    }
  }

  return assignments
}

/**
 * 권역별 배차 균형 체크 (서귀포 vs 제주시)
 * 편향 없이 배분되어야 함
 */
export function checkAreaBalance(
  assignments: Map<string, number>,
  drivers: DriverDispatchInfo[]
): { route0601: number; route0602: number; balanced: boolean } {
  let route0601 = 0
  let route0602 = 0

  for (const driver of drivers) {
    const count = assignments.get(driver.driverId) || 0
    if (driver.route === '0601') route0601 += count
    else if (driver.route === '0602') route0602 += count
  }

  const total = route0601 + route0602
  const balanced = total === 0 || Math.abs(route0601 / total - route0602 / total) < 0.3

  return { route0601, route0602, balanced }
}

/**
 * 연속 근무일 체크 (7일 이상 시 경고)
 */
export function checkConsecutiveWorkDays(workDates: Date[]): {
  consecutiveDays: number
  needsWarning: boolean
} {
  if (workDates.length === 0) return { consecutiveDays: 0, needsWarning: false }

  const sorted = workDates
    .map(d => d.toISOString().split('T')[0])
    .sort((a, b) => b.localeCompare(a))

  let consecutiveDays = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diffDays = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays === 1) {
      consecutiveDays++
    } else {
      break
    }
  }

  return {
    consecutiveDays,
    needsWarning: consecutiveDays >= 7,
  }
}
