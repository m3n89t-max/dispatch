export type ModelType = 'WALL_MOUNT' | 'STAND' | 'HOME_MULTI' | 'SYSTEM_AC' | 'COMMERCIAL' | 'PRE_VISIT' | 'MOVE_INSTALL' | 'UNKNOWN'

/**
 * 모델 유형 판단 로직
 * - AUGRU = ZL4 → 사전방문 (PRE_VISIT) → 설치대수 0
 * - MATNR starts with AC → 시스템에어컨/천정형 (SYSTEM_AC) → 설치대수 1, [시스템] 별도 표기
 * - MATNR starts with AP → 업소용 (COMMERCIAL) → 설치대수 1
 * - MATNR starts with AR → 벽걸이 (WALL_MOUNT) → 설치대수 1
 *   - ARR 접두사 → UNKNOWN (리모컨)
 *   - WXKO/HXKO 접미사 → UNKNOWN (실외기), WNKO → WALL_MOUNT (한국 실내기)
 *   - HNKO 접미사 → UNKNOWN (실외기 한국형, KO 앞이 WN이 아닌 N)
 *   - 끝 2자리에 숫자 포함 → UNKNOWN (실외기)
 *   - trailing 영문이 N으로 끝남 → UNKNOWN (부품)
 *   - trailing 영문이 X로 끝남 → UNKNOWN (실외기)
 *   - full 품번(digit group ≥2)에서 T로 끝남 → UNKNOWN (실외기 대체형: WT)
 * - MATNR starts with AF → 스탠드 또는 홈멀티
 *   - AFR 접두사 → UNKNOWN (리모컨)
 *   - 끝 2자리에 숫자 포함 → UNKNOWN (실외기)
 *   - 짧은 세트 코드(digit group ≤1)에서 W-suffix → HOME_MULTI (AFWRS, AF18BSWRS)
 *   - trailing 영문이 N으로 끝남 → UNKNOWN (실외기: WN, GN 등)
 *   - trailing 영문이 X로 끝남 → UNKNOWN (실외기: BX, QBX, PBX)
 *   - 그 외 → STAND (GRS, BRT, BRZ, GRT, GZ, GS, GT 등 스탠드 실내기)
 * - MATNR starts with L- → 이전설치 (MOVE_INSTALL) → 설치대수 1
 *
 * ※ 홈멀티는 실내기 2개(WRS형+WN형)가 1세트 → 각 행 1대씩, Delivery 합산으로 2대
 */
export function judgeModelType(matnr: string, augru?: string): ModelType {
  if (augru === 'ZL4') return 'PRE_VISIT'

  const code = matnr.toUpperCase().trim()

  if (code.startsWith('AC')) return 'SYSTEM_AC'
  if (code.startsWith('AP')) return 'COMMERCIAL'

  if (code.startsWith('AR')) {
    if (code.startsWith('ARR')) return 'UNKNOWN'
    // 끝 2자리가 모두 숫자 → 실외기. 단, 숫자+문자 (A0Q, B1Z 등)는 실내기 후보로 통과
    if (/^\d{2}$/.test(code.slice(-2))) return 'UNKNOWN'
    if (code.endsWith('KO')) {
      const preKO = code.slice(0, -2)
      if (preKO.endsWith('X')) return 'UNKNOWN'                          // WXKO, HXKO = 실외기
      if (preKO.endsWith('N') && !preKO.endsWith('WN')) return 'UNKNOWN' // HNKO = 실외기, WNKO = 실내기
    }
    const trailingAlpha = code.match(/[A-Z]+$/)
    if (trailingAlpha && trailingAlpha[0].endsWith('N')) return 'UNKNOWN'
    if (trailingAlpha && trailingAlpha[0].endsWith('X')) return 'UNKNOWN'
    // AR full code의 W-suffix (WT, WRT 등) → 실내기 (벽걸이)
    // 예: AR60F07D12WT, AR60F11D11WT
    return 'WALL_MOUNT'
  }

  if (code.startsWith('AF')) {
    if (code.startsWith('AFR')) return 'UNKNOWN'
    // 끝 2자리가 모두 숫자 → 실외기. 단, 숫자+문자는 실내기 후보로 통과
    if (/^\d{2}$/.test(code.slice(-2))) return 'UNKNOWN'
    // 홈멀티: 짧은 세트 코드(digit group ≤1개)에서만 W-suffix 적용 (AFWRS, AF18BSWRS 등)
    // 전체 품번(AF70F17D11WN)은 자릿수 그룹이 2개 이상 → 여기서 걸리지 않음
    const digitGroups = code.slice(2).match(/\d+/g) || []
    if (digitGroups.length <= 1 && /W[A-Z]{1,4}$/.test(code)) return 'HOME_MULTI'
    const trailingAlpha = code.match(/[A-Z]+$/)
    if (trailingAlpha && trailingAlpha[0].endsWith('N')) return 'UNKNOWN'
    if (trailingAlpha && trailingAlpha[0].endsWith('X')) return 'UNKNOWN'
    return 'STAND'
  }

  if (code.startsWith('L-')) return 'MOVE_INSTALL'

  return 'UNKNOWN'
}

export function getInstallCount(modelType: ModelType): number {
  switch (modelType) {
    case 'WALL_MOUNT': return 1
    case 'STAND': return 1
    case 'HOME_MULTI': return 1   // 행당 1대, Delivery 합산으로 홈멀티 2대
    case 'SYSTEM_AC': return 1    // 설치대수 포함, [시스템] 별도 표기
    case 'COMMERCIAL': return 1
    case 'PRE_VISIT': return 0
    case 'MOVE_INSTALL': return 1
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
    case 'COMMERCIAL': return '[업소용]'
    case 'PRE_VISIT': return '사전방문'
    case 'MOVE_INSTALL': return '이전설치'
    case 'UNKNOWN': return '미분류'
  }
}
