import { NextResponse } from 'next/server'

// 제주시·서귀포시 현재 날씨 — wttr.in(무료·키 불필요). 지도 배지 표시용.
// 강수(비/눈)를 강조해 VADS 비 오는 날 배차에 참고.

type Spot = { name: string; lat: number; lng: number }
const SPOTS: Spot[] = [
  { name: '제주시', lat: 33.4996, lng: 126.5312 },
  { name: '서귀포시', lat: 33.2541, lng: 126.5601 },
]

// WWO(weatherCode) → 한글 + 이모지 + 강수여부
function decode(code: string, precipMM: number): { emoji: string; desc: string; rain: boolean } {
  const c = Number(code)
  const rain = precipMM > 0
  if ([200, 386, 389, 392, 395].includes(c)) return { emoji: '⛈️', desc: '뇌우', rain: true }
  if ([179, 182, 185, 227, 230, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(c)) return { emoji: '❄️', desc: '눈', rain: true }
  if ([176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 353, 356, 359].includes(c)) return { emoji: '🌧️', desc: '비', rain: true }
  if ([143, 248, 260].includes(c)) return { emoji: '🌫️', desc: '안개', rain }
  if ([119, 122].includes(c)) return { emoji: '☁️', desc: '흐림', rain }
  if ([116].includes(c)) return { emoji: '⛅', desc: '구름조금', rain }
  if ([113].includes(c)) return { emoji: '☀️', desc: '맑음', rain }
  return { emoji: rain ? '🌧️' : '⛅', desc: rain ? '비' : '대체로 흐림', rain }
}

type Cur = { name: string; temp: number | null; emoji: string; desc: string; rain: boolean; precipMM: number }

async function fetchSpot(s: Spot): Promise<Cur> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(`https://wttr.in/~${s.lat},${s.lng}?format=j1`, {
      signal: ctrl.signal, headers: { 'User-Agent': 'curl/8', 'Accept-Language': 'ko' }, cache: 'no-store',
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    const cc = j?.current_condition?.[0] || {}
    const temp = cc.temp_C != null ? Number(cc.temp_C) : null
    const precipMM = Number(cc.precipMM ?? 0)
    const { emoji, desc, rain } = decode(String(cc.weatherCode ?? ''), precipMM)
    return { name: s.name, temp, emoji, desc, rain, precipMM }
  } catch {
    return { name: s.name, temp: null, emoji: '', desc: '조회 실패', rain: false, precipMM: 0 }
  } finally { clearTimeout(timer) }
}

// 서버 캐시 10분 — wttr.in 과도 호출 방지
let cache: { at: number; data: Cur[] } | null = null
const TTL = 10 * 60 * 1000

export async function GET() {
  try {
    if (cache && Date.now() - cache.at < TTL) return NextResponse.json({ spots: cache.data, cached: true })
    const data = await Promise.all(SPOTS.map(fetchSpot))
    // 전부 실패면 캐시하지 않음(다음 요청에서 재시도)
    if (data.some(d => d.temp != null)) cache = { at: Date.now(), data }
    return NextResponse.json({ spots: data, cached: false })
  } catch (e) {
    return NextResponse.json({ spots: [], error: e instanceof Error ? e.message : 'weather 조회 실패' })
  }
}
