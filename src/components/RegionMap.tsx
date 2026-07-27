'use client'
import { useEffect, useRef, useState } from 'react'
import { useKakaoMap } from '@/lib/useKakaoMap'

export type RegionCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'UNKNOWN'

export interface DeliveryDot {
  deliveryNo: string
  driverName: string
  vehicleNo: string
  customerName: string
  address: string
  zipcode: string
  region: RegionCode
}

export interface ZipcodePoint {
  zipcode: string
  region: RegionCode
  count: number
  sampleAddress: string
  deliveries?: DeliveryDot[]
}

const REGION_COLOR: Record<RegionCode, string> = {
  A: '#10b981', // emerald
  B: '#0ea5e9', // sky
  C: '#8b5cf6', // violet
  D: '#f59e0b', // amber
  E: '#ef4444', // rose-red
  UNKNOWN: '#9ca3af', // gray
}

const JEJU_CENTER = { lat: 33.4, lng: 126.55 } // 제주 중심부 근사

interface Props {
  points: ZipcodePoint[]
  height?: number
  showLegend?: boolean
  driverFilter?: string  // 특정 기사만 강조 (다른 마커는 회색)
}

export default function RegionMap({ points, height = 480, showLegend = true, driverFilter }: Props) {
  const { ready, error } = useKakaoMap()
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [stats, setStats] = useState<{ geocoded: number; failed: number; total: number }>({ geocoded: 0, failed: 0, total: 0 })

  useEffect(() => {
    if (!ready || !mapRef.current) return
    const kakao = window.kakao
    const map = new kakao.maps.Map(mapRef.current, {
      center: new kakao.maps.LatLng(JEJU_CENTER.lat, JEJU_CENTER.lng),
      level: 9, // 제주 전체가 보이는 줌
    })

    const geocoder = new kakao.maps.services.Geocoder()
    const bounds = new kakao.maps.LatLngBounds()
    const markers: { lat: number; lng: number; point: ZipcodePoint }[] = []
    let done = 0
    let failed = 0
    const target = points.filter(p => p.sampleAddress)

    if (target.length === 0) {
      setStats({ geocoded: 0, failed: points.length, total: points.length })
      return
    }

    // 순차 geocoding (rate limit 회피)
    let cancelled = false
    const overlays: { close: () => void }[] = []
    const customMarkers: { remove: () => void }[] = []

    const processNext = (i: number) => {
      if (cancelled || i >= target.length) {
        setStats({ geocoded: done, failed, total: points.length })
        if (markers.length > 0) map.setBounds(bounds)
        return
      }
      const p = target[i]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      geocoder.addressSearch(p.sampleAddress, (result: any[], status: string) => {
        if (cancelled) return
        if (status === kakao.maps.services.Status.OK && result[0]) {
          const lat = parseFloat(result[0].y)
          const lng = parseFloat(result[0].x)
          markers.push({ lat, lng, point: p })
          bounds.extend(new kakao.maps.LatLng(lat, lng))

          // 기사 필터 적용 시 색상 결정
          const matchesFilter = !driverFilter ||
            (p.deliveries && p.deliveries.some(d => d.driverName === driverFilter))
          const baseColor = matchesFilter ? REGION_COLOR[p.region] : '#d1d5db'
          const fillOp = matchesFilter ? 0.45 : 0.15

          // 카운트에 비례한 마커 (원)
          const radius = 6 + Math.min(20, Math.sqrt(p.count) * 2)
          const circle = new kakao.maps.Circle({
            map,
            center: new kakao.maps.LatLng(lat, lng),
            radius: radius * 100,
            strokeWeight: 1.5,
            strokeColor: baseColor,
            strokeOpacity: matchesFilter ? 0.9 : 0.3,
            fillColor: baseColor,
            fillOpacity: fillOp,
          })
          customMarkers.push({ remove: () => circle.setMap(null) })

          // 호버 인포윈도우 — 기사·차량·고객 정보 포함
          let deliveryList = ''
          if (p.deliveries && p.deliveries.length > 0) {
            const items = p.deliveries.slice(0, 8).map(d => {
              const hi = driverFilter && d.driverName === driverFilter ? 'background:#fef08a;' : ''
              return `<li style="${hi}padding:1px 3px;margin:1px 0;border-radius:2px;">
                <b>${d.driverName}</b>
                ${d.vehicleNo ? ` <span style="color:#888;">(${d.vehicleNo})</span>` : ''}
                ${d.customerName && d.customerName !== d.driverName ? ` · ${d.customerName}` : ''}
              </li>`
            }).join('')
            const more = p.deliveries.length > 8 ? `<li style="color:#888;font-size:9px;">+ ${p.deliveries.length - 8}건 더</li>` : ''
            deliveryList = `<ul style="margin:4px 0 0 0;padding-left:14px;font-size:10px;color:#444;">${items}${more}</ul>`
          }
          const iw = new kakao.maps.InfoWindow({
            content: `<div style="padding:6px 10px;font-size:11px;line-height:1.4;max-width:280px;">
              <b>${p.zipcode}</b>
              <span style="background:${REGION_COLOR[p.region]};color:white;padding:1px 5px;border-radius:3px;font-size:10px;margin-left:4px;">${p.region}</span>
              <span style="color:#555;margin-left:6px;">${p.count}건</span>
              <div style="color:#888;font-size:10px;margin-top:2px;">${p.sampleAddress.slice(0, 50)}${p.sampleAddress.length > 50 ? '...' : ''}</div>
              ${deliveryList}
            </div>`,
            removable: false,
          })
          kakao.maps.event.addListener(circle, 'mouseover', () => {
            iw.open(map, new kakao.maps.LatLng(lat, lng))
          })
          kakao.maps.event.addListener(circle, 'mouseout', () => {
            iw.close()
          })
          overlays.push({ close: () => iw.close() })

          done++
        } else {
          failed++
        }
        // 다음 단계 (50ms 간격으로 부하 분산)
        setTimeout(() => processNext(i + 1), 50)
      })
    }

    processNext(0)

    return () => {
      cancelled = true
      overlays.forEach(o => o.close())
      customMarkers.forEach(m => m.remove())
    }
  }, [ready, points, driverFilter])

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-700">
        지도 로드 실패: {error}
        <p className="text-xs text-red-500 mt-1">
          (Kakao Developers에서 도메인 등록 확인: http://localhost:3000)
        </p>
      </div>
    )
  }

  return (
    <div>
      <div ref={mapRef} style={{ width: '100%', height: `${height}px` }} className="rounded border bg-gray-100" />
      {showLegend && (
        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          {(Object.keys(REGION_COLOR) as RegionCode[]).map(r => (
            <span key={r} className="inline-flex items-center gap-1">
              <span className="w-3 h-3 rounded-full" style={{ background: REGION_COLOR[r] }} />
              {r}구역
            </span>
          ))}
          <span className="ml-auto text-gray-500">
            {ready ? `${stats.geocoded}/${stats.total} 위치 표시` : '지도 로드 중...'}
            {stats.failed > 0 && ` · 주소 변환 실패 ${stats.failed}건`}
          </span>
        </div>
      )}
    </div>
  )
}
