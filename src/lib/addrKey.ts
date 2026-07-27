// 실내 실외기실 데이터를 "같은 주소(건물)"끼리 누적하기 위한 주소 정규화 키.
//
// 판매처에서 사람마다 주소를 미세하게 다르게 입력하므로(띄어쓰기/괄호/동·호 표기 차이),
// 카카오맵 지오코딩 결과의 표준 주소(road_address 우선 = 건물 단위, 동·호 미포함)를 키로 쓴다.
// 아파트는 모든 세대가 같은 도로명주소로 수렴 → 건물 단위로 누적된다.
// 지오코딩 실패 시엔 입력 주소를 문자열 정규화한 값으로 폴백(완전일치만 누적).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addrKeyFromKakao(result: any): string {
  const road = result?.road_address?.address_name
  const jibun = result?.address?.address_name
  return normalizeAddr(road || jibun || result?.address_name || '')
}

// 문자열만으로 정규화(폴백/서버측). 괄호 내용·동/호·공백·구두점 제거 후 소문자화.
export function normalizeAddr(s: string | null | undefined): string {
  let t = String(s ?? '')
  t = t.replace(/\([^)]*\)/g, ' ')                 // (동이름, 건물명) 제거
  t = t.replace(/\d+\s*동/g, ' ')                   // 101동 제거 (건물 단위 누적)
  t = t.replace(/\d+\s*호/g, ' ')                   // 502호 제거
  t = t.replace(/[.,]/g, ' ')
  t = t.replace(/\s+/g, '')                         // 모든 공백 제거
  return t.toLowerCase()
}

// 주소가 아파트인지(별도 카운팅용). 아파트/APT/@ 표기 또는 "동+호" 구조.
export function isApartment(address: string | null | undefined): boolean {
  const a = String(address ?? '')
  if (/아파트|APT|@/i.test(a)) return true
  return /\d+\s*동/.test(a) && /\d+\s*호/.test(a)
}
