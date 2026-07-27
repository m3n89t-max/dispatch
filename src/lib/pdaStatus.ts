// PDA Step Status — SAP ZRLEJ56700 리포트의 W열(코드)을 상태로 변환.
// 마스터 코드표(사진 기준):
//   A/1/4 → 설치          B/6 → 당일연기후 설치     C/8 → 익일연기후 설치
//   J/2/5 → 당일연기       L/7 → 익일연기            N/9 → 통불
//   P → 취소              3 → 반품
//
// 카테고리(집계/비율용):
//   INSTALLED           설치            (설치)
//   POSTPONED_INSTALLED 연기후설치      (당일/익일연기 후 결국 설치)
//   POSTPONED           연기            (당일/익일연기, 미설치)
//   CANCELLED           취소
//   RETURNED            반품
//   FAILED              통불
//   UNKNOWN             미분류/공란

export type PdaCategory =
  | 'INSTALLED' | 'POSTPONED_INSTALLED' | 'POSTPONED'
  | 'CANCELLED' | 'RETURNED' | 'FAILED' | 'UNKNOWN'

const CODE_TO_STATUS: Record<string, string> = {
  A: '설치', '1': '설치', '4': '설치',
  B: '당일연기후 설치', '6': '당일연기후 설치',
  C: '익일연기후 설치', '8': '익일연기후 설치',
  J: '당일연기', '2': '당일연기', '5': '당일연기',
  L: '익일연기', '7': '익일연기',
  N: '통불', '9': '통불',
  P: '취소',
  '3': '반품',
}

const STATUS_TO_CATEGORY: Record<string, PdaCategory> = {
  '설치': 'INSTALLED',
  '당일연기후 설치': 'POSTPONED_INSTALLED',
  '익일연기후 설치': 'POSTPONED_INSTALLED',
  '당일연기': 'POSTPONED',
  '익일연기': 'POSTPONED',
  '통불': 'FAILED',
  '취소': 'CANCELLED',
  '반품': 'RETURNED',
}

export interface PdaStatus { code: string; status: string; category: PdaCategory }

// 원본 코드(W열 값) → { 코드, 상태명, 카테고리 }
export function parsePdaStatus(raw: string | null | undefined): PdaStatus {
  const code = String(raw ?? '').trim().toUpperCase()
  const status = CODE_TO_STATUS[code] ?? ''
  const category: PdaCategory = status ? (STATUS_TO_CATEGORY[status] ?? 'UNKNOWN') : 'UNKNOWN'
  return { code, status, category }
}

export const PDA_CATEGORY_NAME: Record<PdaCategory, string> = {
  INSTALLED: '설치',
  POSTPONED_INSTALLED: '연기후설치',
  POSTPONED: '연기',
  CANCELLED: '취소',
  RETURNED: '반품',
  FAILED: '통불',
  UNKNOWN: '미분류',
}

// 대시보드 표기 순서 (미분류는 뒤)
export const PDA_CATEGORY_ORDER: PdaCategory[] =
  ['INSTALLED', 'POSTPONED_INSTALLED', 'POSTPONED', 'CANCELLED', 'RETURNED', 'FAILED', 'UNKNOWN']

export type PdaCounts = Record<PdaCategory, number>
export function emptyPdaCounts(): PdaCounts {
  return { INSTALLED: 0, POSTPONED_INSTALLED: 0, POSTPONED: 0, CANCELLED: 0, RETURNED: 0, FAILED: 0, UNKNOWN: 0 }
}
