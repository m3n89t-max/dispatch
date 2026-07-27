// 주소 문자열로 층수 판별 (안전관리: 2층이상 vs 1층 저층)
//  규칙(안전관리/claude.md 2-2):
//   - 호수 앞자리 = 층 (202호→2, 1201호→12, 1502호→15). 호수<100 이면 판별 불가.
//   - 명시 "N층" 텍스트(지하 제외)도 사용.
//   - 층 >= 2 이면 2층이상, 그 외(판별 불가 포함)는 전부 1층(저층).
//   - 동(棟) 번호와 호수 혼동 금지: "101동 1502호" → 1502호 기준 15층.

export interface FloorInfo {
  floor: number | null   // 추정 층 (없으면 null)
  isHigh: boolean        // 2층 이상 여부
}

export function parseFloor(address: string | null | undefined): FloorInfo {
  if (!address) return { floor: null, isHigh: false }
  const addr = String(address).replace(/\s+/g, ' ')

  let floor: number | null = null

  // 1) 호수 기반: "...호" 중 마지막(가장 구체적인) 호수의 앞자리 = 층
  //    동 번호("101동")는 '호'가 아니므로 자동 배제됨.
  const hoMatches = [...addr.matchAll(/(\d{1,5})\s*호/g)]
  if (hoMatches.length > 0) {
    const ho = parseInt(hoMatches[hoMatches.length - 1][1], 10)
    if (Number.isFinite(ho) && ho >= 100) floor = Math.floor(ho / 100)
  }

  // 1-b) 동/호 슬래시 표기: "102/402" = 102동 402호 → 슬래시 뒤 숫자가 호수.
  const slashMatches = [...addr.matchAll(/(\d{1,4})\s*\/\s*(\d{2,5})/g)]
  if (slashMatches.length > 0) {
    const ho = parseInt(slashMatches[slashMatches.length - 1][2], 10)
    if (Number.isFinite(ho) && ho >= 100) {
      const f = Math.floor(ho / 100)
      floor = floor === null ? f : Math.max(floor, f)
    }
  }

  // 2) 명시 층 표기: 한글 "N층" + 영문 "NF/Nf" (예: 2F, 10F). 지하/B 접두는 제외.
  const cheungMatches = [...addr.matchAll(/(지하|B)?\s*(\d{1,3})\s*(층|F)/gi)]
  for (const m of cheungMatches) {
    if (m[1]) continue // 지하층(지하N층 / B1F 등) → 제외
    const f = parseInt(m[2], 10)
    if (Number.isFinite(f) && f >= 1) floor = floor === null ? f : Math.max(floor, f)
  }

  return { floor, isHigh: floor !== null && floor >= 2 }
}

// 붙여넣기 텍스트 → 조회 번호(Sales Order) 추출 + 중복 제거 (순서 보존)
//  Sales Order 번호는 7~10자리. (더 긴 숫자열은 다른 값으로 보고 제외)
export function extractDeliveryNumbers(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of String(text ?? '').matchAll(/\d+/g)) {
    const n = m[0]
    if (n.length >= 7 && n.length <= 10 && !seen.has(n)) { seen.add(n); out.push(n) }
  }
  return out
}
