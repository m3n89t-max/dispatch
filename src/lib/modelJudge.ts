// 모델 유형 판정 — ZRLEJ56700 리포트의 UNCOB(모델군) 컬럼 기반
//
// 기존 MATNR(품번) 접두/접미 패턴 파싱 방식은 폐기.
// UNCOB 모델군 값으로 직접 판정하며, 고객(=Delivery 단위)을 우선으로 본다.
//
// ── 판정 규칙 (UNCOB 접두) ─────────────────────────────────────────
//  RAC*      → 벽걸이 (Room AC, 실내기)            설치대수 1
//  PAC*      → 업소용                               설치대수 1
//  HMRAC*    → 홈멀티 실내기 마커                   설치대수 1
//  HMPAC(S)* → 같은 고객에 HMRAC 있으면 홈멀티,
//              없으면 스탠드                         설치대수 1
//  SYSS4W*   → 4웨이 시스템                         설치대수 1
//  SYSS2W*   → 원웨이 시스템                        설치대수 1
//  그 외     → 실외기/부속/리모컨 (ACO*, ACDAE,
//              TACOPTI 등) → 제외                   설치대수 0
//
//  ※ SO Reason = ZL4 → 사전방문(PRE_VISIT) → 설치대수 0 (UNCOB보다 우선)
//
//  실내기 1대당 카운팅 마커 UNCOB는 1개뿐이라(WS/WNKO 등 동일 실내기의
//  다른 SKU는 ACDAE 등 '제외'로 떨어짐) 기존 중복 카운트 문제가 자동 해소된다.

export type ModelType =
  | 'WALL_MOUNT'   // 벽걸이 (RAC)
  | 'STAND'        // 스탠드 (HMPAC 단독)
  | 'HOME_MULTI'   // 홈멀티 (HMRAC, 또는 HMPAC+HMRAC 동반)
  | 'SYSTEM_4WAY'  // 4웨이 시스템 (SYSS4W)
  | 'SYSTEM_1WAY'  // 원웨이 시스템 (SYSS2W)
  | 'COMMERCIAL'   // 업소용 (PAC)
  | 'PRE_VISIT'    // 사전방문 (SO Reason = ZL4)
  | 'SYSTEM_AC'    // (legacy 호환 — 과거 저장 데이터)
  | 'MOVE_INSTALL' // (legacy 호환 — 과거 저장 데이터)
  | 'UNKNOWN'      // 실외기/부속/미분류 (제외)

// UNCOB → 실내기 카운팅 마커 분류
export type UncobKind = 'HMRAC' | 'HMPAC' | 'RAC' | 'PAC' | 'SYS4' | 'SYS1' | 'MOVE' | 'EXCLUDE'

/**
 * UNCOB(모델군) 값을 카운팅 마커 종류로 분류.
 * 접두사 검사 순서가 중요: HMRAC/HMPAC을 RAC/PAC보다 먼저 봐야 한다.
 */
export function classifyUncob(uncob: string | null | undefined): UncobKind {
  const u = (uncob ?? '').toString().toUpperCase().trim()
  if (!u) return 'EXCLUDE'
  if (u.startsWith('HMRAC')) return 'HMRAC'   // 홈멀티 실내기 마커
  if (u.startsWith('HMPAC')) return 'HMPAC'   // HMPACS18: 스탠드 또는 홈멀티
  if (u.startsWith('SYSS4W')) return 'SYS4'   // 4웨이 시스템
  if (u.startsWith('SYSS2W')) return 'SYS1'   // 원웨이 시스템
  if (u.startsWith('SYS')) return 'SYS4'      // 기타 시스템 → 보수적으로 4웨이 취급
  if (u.startsWith('RAC')) return 'RAC'       // RAC10/RAC6: 벽걸이
  if (u.startsWith('PAC')) return 'PAC'       // 업소용
  if (u.startsWith('LAIR')) return 'MOVE'     // L-MAIR: 이전설치(이사)
  return 'EXCLUDE'                            // ACO*, ACDAE, TACOPTI 등 = 실외기/부속
}

/**
 * UNCOB 분류 + 고객(Delivery) 컨텍스트로 최종 모델 유형 결정.
 * @param kind classifyUncob 결과
 * @param ctx.hasHmrac 같은 Delivery(고객)에 HMRAC 마커가 존재하는지
 * @param ctx.isPreVisit SO Reason = ZL4 (사전방문)
 */
export function resolveModelType(
  kind: UncobKind,
  ctx: { hasHmrac: boolean; isPreVisit: boolean }
): ModelType {
  if (ctx.isPreVisit) return 'PRE_VISIT'
  switch (kind) {
    case 'HMRAC': return 'HOME_MULTI'
    case 'HMPAC': return ctx.hasHmrac ? 'HOME_MULTI' : 'STAND'
    case 'RAC':   return 'WALL_MOUNT'
    case 'PAC':   return 'COMMERCIAL'
    case 'SYS4':  return 'SYSTEM_4WAY'
    case 'SYS1':  return 'SYSTEM_1WAY'
    case 'MOVE':  return 'MOVE_INSTALL'
    case 'EXCLUDE':
    default:      return 'UNKNOWN'
  }
}

export function getInstallCount(modelType: ModelType): number {
  switch (modelType) {
    case 'WALL_MOUNT':
    case 'STAND':
    case 'HOME_MULTI':   // 행당 1대, Delivery 합산으로 홈멀티 2대(스탠드+벽걸이)
    case 'SYSTEM_4WAY':
    case 'SYSTEM_1WAY':
    case 'SYSTEM_AC':
    case 'COMMERCIAL':
    case 'MOVE_INSTALL':
      return 1
    case 'PRE_VISIT':
    case 'UNKNOWN':
    default:
      return 0
  }
}

export function getModelTypeName(modelType: ModelType): string {
  switch (modelType) {
    case 'WALL_MOUNT':   return '벽걸이'
    case 'STAND':        return '스탠드'
    case 'HOME_MULTI':   return '홈멀티'
    case 'SYSTEM_4WAY':  return '[시스템4]'
    case 'SYSTEM_1WAY':  return '[시스템1]'
    case 'SYSTEM_AC':    return '[시스템]'
    case 'COMMERCIAL':   return '[업소용]'
    case 'PRE_VISIT':    return '사전방문'
    case 'MOVE_INSTALL': return '이전설치'
    case 'UNKNOWN':      return '미분류'
    default:             return '미분류'
  }
}
