/**
 * 배차 점수 계산 엔진
 *
 * 점수 가중치 (6.1):
 * - 완료율: 30%
 * - 납기확정률: 15%
 * - 납기유지율: 15%
 * - OP2: 15%
 * - NPS: 10%
 * - 불량률: 10% (낮을수록 좋음 → 역산)
 * - 추세: 5% (최근 7일 50% + 과거 30일 50%)
 */

interface PerformanceData {
  completionRate?: number       // 완료율 (0-100)
  deliveryConfirmRate?: number  // 납기확정률 (0-100)
  deliveryMaintainRate?: number // 납기유지율 (0-100)
  op2Score?: number             // OP2 (0-100)
  npsScore?: number             // NPS (0-100)
  defectRate?: number           // 불량률 (0-100, lower is better)
}

const WEIGHTS = {
  completionRate: 0.30,
  deliveryConfirmRate: 0.15,
  deliveryMaintainRate: 0.15,
  op2Score: 0.15,
  npsScore: 0.10,
  defectRate: 0.10,
  trend: 0.05,
}

export function calculateDailyScore(data: PerformanceData): number {
  let score = 0
  let totalWeight = 0

  if (data.completionRate !== undefined) {
    score += data.completionRate * WEIGHTS.completionRate
    totalWeight += WEIGHTS.completionRate
  }
  if (data.deliveryConfirmRate !== undefined) {
    score += data.deliveryConfirmRate * WEIGHTS.deliveryConfirmRate
    totalWeight += WEIGHTS.deliveryConfirmRate
  }
  if (data.deliveryMaintainRate !== undefined) {
    score += data.deliveryMaintainRate * WEIGHTS.deliveryMaintainRate
    totalWeight += WEIGHTS.deliveryMaintainRate
  }
  if (data.op2Score !== undefined) {
    score += data.op2Score * WEIGHTS.op2Score
    totalWeight += WEIGHTS.op2Score
  }
  if (data.npsScore !== undefined) {
    score += data.npsScore * WEIGHTS.npsScore
    totalWeight += WEIGHTS.npsScore
  }
  if (data.defectRate !== undefined) {
    // 불량률: 낮을수록 좋으므로 역산 (100 - defectRate)
    score += (100 - data.defectRate) * WEIGHTS.defectRate
    totalWeight += WEIGHTS.defectRate
  }

  if (totalWeight === 0) return 50 // default middle score when no data
  // Normalize to account for missing fields
  return (score / totalWeight) * 100 / 100
}

/**
 * 가중 평균 점수 계산
 * 최근 7일: 50%, 과거 30일: 50%
 */
export function calculateWeightedScore(
  recent7Days: PerformanceData[],
  past30Days: PerformanceData[]
): number {
  const recentAvg = averageScore(recent7Days)
  const pastAvg = averageScore(past30Days)

  return recentAvg * 0.5 + pastAvg * 0.5
}

function averageScore(data: PerformanceData[]): number {
  if (data.length === 0) return 50 // default middle score
  const scores = data.map(d => calculateDailyScore(d))
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

/**
 * 순환 배차 보정 점수
 * 미배차 1일: +5, 2일: +10, 3일 이상: +15
 */
export function calculateCircularBonus(consecutiveDaysWithoutDispatch: number): number {
  if (consecutiveDaysWithoutDispatch >= 3) return 15
  if (consecutiveDaysWithoutDispatch === 2) return 10
  if (consecutiveDaysWithoutDispatch === 1) return 5
  return 0
}

/**
 * 납기유지율 = 익일확정 / 전일배차 × 100
 */
export function calculateDeliveryMaintainRate(confirmed: number, prev: number): number {
  if (prev === 0) return 0
  return (confirmed / prev) * 100
}

/**
 * 완료율 = 실제완료 / 기준배차 × 100
 */
export function calculateCompletionRate(completed: number, basePrev: number): number {
  if (basePrev === 0) return 0
  return (completed / basePrev) * 100
}

/**
 * 납기확정률 = 익일확정 / 전일배차 × 100
 */
export function calculateDeliveryConfirmRate(nextDayConfirmed: number, prevDispatch: number): number {
  if (prevDispatch === 0) return 0
  return (nextDayConfirmed / prevDispatch) * 100
}
