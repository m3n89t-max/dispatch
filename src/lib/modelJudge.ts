export type ModelType = 'WALL_MOUNT' | 'STAND' | 'HOME_MULTI' | 'SYSTEM_AC' | 'PRE_VISIT' | 'MOVE_INSTALL' | 'UNKNOWN'

/**
 * 모델 유형 판단 로직
 * - AUGRU = ZL4 → 사전방문 (PRE_VISIT) → 설치대수 0
 * - MATNR starts with AC → 시스템에어컨 (SYSTEM_AC) → 설치대수 1, [시스템] 별도 표기
 * - MATNR starts with AR → 벽걸이 (WALL_MOUNT) → 설치대수 1
 *   - ARR 접두사 → UNKNOWN (리모컨)
 *   - XKO/NKO 접미사 → UNKNOWN (실외기)
 *   - 끝 2자리에 숫자 포함 → UNKNOWN (실외기, 예: A0Q)
 * - MATNR starts with AF + 끝 영문 3자리 → 홈멀티 실내기 (HOME_MULTI) → 설치대수 1 (행당)
 * - MATNR starts with AF → 스탠드 (STAND) → 설치대수 1
 *   - AFR 접두사 → UNKNOWN (리모컨)
 *   - 끝 2자리에 숫자 포함 → UNKNOWN (실외기, 예: Q8X)
 * - MATNR starts with L- → 이전설치 (MOVE_INSTALL) → 설치대수 1
 *
 * ※ 홈멀티는 실내기 2개(WRS형+WN형)가 1세트 → 각 행 1대씩, Delivery 합산으로 2대
 */
export function judgeModelType(matnr: string, augru?: string): ModelType {
  if (augru === 'ZL4') return 'PRE_VISIT'

  const code = matnr.toUpperCase().trim()

  if (code.startsWith('AC')) return 'SYSTEM_AC'

  if (code.startsWith('AR')) {
    // 리모컨/부속품: ARR 접두사 (예: ARR-WK8F) → 제외
    if (code.startsWith('ARR')) return 'UNKNOWN'
    // 실외기: 끝 2자리에 숫자 포함 (예: A0Q → 0Q에 숫자) → 제외
    if (/\d/.test(code.slice(-2))) return 'UNKNOWN'
    // 실내기/실외기 컴포넌트: 끝 3자리 이상 영문 (WNKO, WXKO, HNQ 등) → 제외
    // 세트모델명은 끝 2자리 영문 (예: WT)
    if (/[A-Z]{3,}$/.test(code)) return 'UNKNOWN'
    return 'WALL_MOUNT'
  }

  if (code.startsWith('AF')) {
    // 리모컨/부속품: AFR 접두사 (예: AFR-QC3F) → 제외
    if (code.startsWith('AFR')) return 'UNKNOWN'
    // 실외기: 끝 2자리에 숫자 포함 (예: Q8X → 8X에 숫자) → 제외
    if (/\d/.test(code.slice(-2))) return 'UNKNOWN'
    // 홈멀티/스탠드 실내기: W로 시작하는 영문 suffix (WN, WRS, WZN, WZRS 등)
    // 실외기(GN, DCX 등)는 W가 없으므로 제외
    if (/W[A-Z]{1,3}$/.test(code)) return 'HOME_MULTI'
    return 'UNKNOWN'
  }

  // 이전설치: L-MAIR 등 L- 접두사
  if (code.startsWith('L-')) return 'MOVE_INSTALL'

  return 'UNKNOWN'
}

export function getInstallCount(modelType: ModelType): number {
  switch (modelType) {
    case 'WALL_MOUNT': return 1
    case 'STAND': return 1
    case 'HOME_MULTI': return 1   // 행당 1대, Delivery 합산으로 홈멀티 2대
    case 'SYSTEM_AC': return 1    // 설치대수 포함, [시스템] 별도 표기
    case 'PRE_VISIT': return 0
    case 'MOVE_INSTALL': return 1 // 이전설치 1대
    case 'UNKNOWN': return 0
    default: return 0
  }
}

export function getModelTypeName(modelType: ModelType): string {
  switch (modelType) {
    case 'WALL_MOUNT': return '벽걸이'
    case 'STAND': return '스탠드'
    case 'HOME_MULTI': return '홈멀티'
    case 'SYSTEM_AC': return '[시스템]'
    case 'PRE_VISIT': return '사전방문'
    case 'MOVE_INSTALL': return '이전설치'
    case 'UNKNOWN': return '미분류'
  }
}
