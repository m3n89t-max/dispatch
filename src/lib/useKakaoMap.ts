'use client'
import { useEffect, useState } from 'react'

// 전역 카카오 SDK 타입 (최소 정의)
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kakao: any
  }
}

let scriptPromise: Promise<void> | null = null

function loadKakaoSdk(appkey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (window.kakao?.maps) {
    return new Promise(resolve => window.kakao.maps.load(() => resolve()))
  }
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('kakao-map-sdk') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => window.kakao.maps.load(() => resolve()))
      existing.addEventListener('error', reject)
      return
    }
    const script = document.createElement('script')
    script.id = 'kakao-map-sdk'
    script.async = true
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appkey}&libraries=services,clusterer&autoload=false`
    script.onload = () => window.kakao.maps.load(() => resolve())
    script.onerror = () => reject(new Error('카카오맵 SDK 로드 실패 — 도메인 허용 확인 필요'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * 카카오맵 SDK를 동적 로드하고 준비 상태를 반환
 * 환경변수 NEXT_PUBLIC_KAKAO_MAP_KEY 필요
 */
export function useKakaoMap(): { ready: boolean; error: string | null } {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY
    if (!key) { setError('NEXT_PUBLIC_KAKAO_MAP_KEY 미설정'); return }
    loadKakaoSdk(key)
      .then(() => setReady(true))
      .catch(e => setError(e instanceof Error ? e.message : '카카오맵 SDK 로드 실패'))
  }, [])

  return { ready, error }
}
