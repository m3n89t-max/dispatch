export type ModelType = 'WALL_MOUNT' | 'STAND' | 'HOME_MULTI' | 'SYSTEM_AC' | 'PRE_VISIT' | 'UNKNOWN'

/**
 * 모델 유형 판단 로직
 * - AUGRU = ZL4 → 사전방문 (PRE_VISIT) → 설치대수 0
 * - MATNR starts with AC → 시스템에어컨 (SYSTEM_AC) → 설치대수 1, 별도 표기
 * - MATNR starts with AR → 벽걸이 (WALL_MOUNT) → 설치대수 1
 * - MATNR starts with AF + ends with 3 English letters → 홈멀티 (HOME_MULTI) → 설치대수 2
 * - MATNR starts with AF → 스탠드 (STAND) → 설치대수 1
 */
export function judgeModelType(matnr: string, augru?: string): ModelType {
  if (augru === 'ZL4') return 'PRE_VISIT'

  const code = matnr.toUpperCase().trim()

  if (code.startsWith('AC')) return 'SYSTEM_AC'

  if (code.startsWith('AR')) {
    // 리모컨/부속품: ARR 접두사 (예: ARR-WK8F) → 제외
    if (code.startsWith('ARR')) return 'UNKNOWN'
    // 실외기: XKO 또는 NKO 접미사 (예: AR60F07D11WXKO, AR60F07D11WNKO) → 제외
    if (code.endsWith('XKO') || code.endsWith('NKO')) return 'UNKNOWN'
    // 실내기는 끝 2자리가 순수 영문 (예: WT, WS) → 끝에 숫자 포함 시 실외기 (예: A0Q)
    if (/\d/.test(code.slice(-2))) return 'UNKNOWN'
    return 'WALL_MOUNT'
  }

  if (code.startsWith('AF')) {
    // 리모컨/부속품: AFR 접두사 (예: AFR-QC3F) → 제외
    if (code.startsWith('AFR')) return 'UNKNOWN'
    // 끝 영문 3자리 → 홈멀티 실내기 (예: AF60F17D12WRS)
    const suffix = code.slice(-3)
    if (/^[A-Z]{3}$/.test(suffix)) return 'HOME_MULTI'
    return 'STAND'
  }

  return 'UNKNOWN'
}

export function getInstallCount(modelType: ModelType): number {
  switch (modelType) {
    case 'WALL_MOUNT': return 1
    case 'STAND': return 1
    case 'HOME_MULTI': return 2
    case 'SYSTEM_AC': return 1  // 설치대수 포함, 별도 표기
    case 'PRE_VISIT': return 0
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
    case 'UNKNOWN': return '미분류'
  }
}
