// 카카오 Local REST API로 주소 → 우편번호 변환
// 환경변수: KAKAO_REST_API_KEY
// 캐시: 프로세스 메모리 (서버 재시작 시 초기화)
// 호출 제한: 1일 무료 100,000건 (개인 앱 기본 한도)

interface KakaoAddressDoc {
  road_address?: { zone_no?: string; address_name?: string }
  address?: { zip_code?: string; address_name?: string; region_3depth_name?: string; region_3depth_h_name?: string }
}

interface KakaoAddressResp {
  documents?: KakaoAddressDoc[]
}

export interface GeocodeResult {
  zipcode: string
  dongName: string // 행정동/법정동 (예: "연동", "노형동")
  normalizedAddress: string
}

const cache = new Map<string, GeocodeResult>()

const EMPTY: GeocodeResult = { zipcode: '', dongName: '', normalizedAddress: '' }

/**
 * 주소(도로명 또는 지번) → 우편번호 + 행정동 변환
 * 캐시 사용 — 같은 주소 반복 조회 시 API 호출 없음
 */
export async function addressToZipcode(address: string): Promise<GeocodeResult> {
  const q = (address ?? '').trim()
  if (!q) return EMPTY
  if (cache.has(q)) return cache.get(q)!

  const key = process.env.KAKAO_REST_API_KEY
  if (!key) {
    // 키 미설정 시 캐시에 빈값 저장하지 않음 (다음 업로드에서 키 설정되면 재시도)
    return EMPTY
  }

  try {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}`
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${key}` },
    })
    if (!res.ok) {
      console.warn(`[kakao-geocoder] ${res.status} ${q}`)
      return EMPTY
    }
    const data: KakaoAddressResp = await res.json()
    const doc = data.documents?.[0]
    if (!doc) {
      const empty = { ...EMPTY }
      cache.set(q, empty) // 빈 결과도 캐시 (재시도 방지)
      return empty
    }
    const result: GeocodeResult = {
      zipcode: doc.road_address?.zone_no ?? doc.address?.zip_code ?? '',
      dongName: doc.address?.region_3depth_h_name ?? doc.address?.region_3depth_name ?? '',
      normalizedAddress: doc.road_address?.address_name ?? doc.address?.address_name ?? q,
    }
    cache.set(q, result)
    return result
  } catch (e) {
    console.warn(`[kakao-geocoder] fetch 실패: ${e instanceof Error ? e.message : e}`)
    return EMPTY
  }
}

/**
 * 여러 주소를 병렬 변환 (rate limit 고려: 동시 5개 제한)
 */
export async function batchAddressToZipcode(addresses: string[]): Promise<Map<string, GeocodeResult>> {
  const out = new Map<string, GeocodeResult>()
  const uniqueAddrs = [...new Set(addresses.filter(a => a && a.trim()))]
  const CONCURRENCY = 5
  for (let i = 0; i < uniqueAddrs.length; i += CONCURRENCY) {
    const batch = uniqueAddrs.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(addr => addressToZipcode(addr)))
    batch.forEach((addr, idx) => out.set(addr, results[idx]))
  }
  return out
}

export function getGeocoderCacheSize(): number {
  return cache.size
}
