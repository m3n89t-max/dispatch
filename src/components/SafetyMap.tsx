'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useKakaoMap } from '@/lib/useKakaoMap'
import { addrKeyFromKakao, normalizeAddr } from '@/lib/addrKey'
import { modelColor } from '@/lib/modelColors'

export interface SafetyMapItem {
  key: string
  deliveryNo: string
  address: string
  floor: number | null
  isHigh: boolean
  model?: string   // 대표모델 (마커 클릭 정보창에 표시)
  modelName?: string   // 실제 자재코드 (마커 라벨에 상시 표시)
}

export interface GeocodedRow { deliveryNo: string; addrKey: string; address: string; region3: string; lat?: number; lng?: number }

interface Props {
  items: SafetyMapItem[]
  height?: number
  // 리스트에서 행을 클릭하면 이 값이 바뀜 → 해당 마커로 이동 + (2층이상) 로드뷰
  focus?: { key: string; n: number } | null
  // 로드뷰 패널 표시 여부 (저층 지도는 false → 지도 전체폭)
  roadview?: boolean
  // 지오코딩 완료 시 (납품번호 → 카카오 정규화 주소키) 전달 → 실내실외기실 누적/매칭용
  onGeocoded?: (rows: GeocodedRow[]) => void
  // 실내 실외기실로 표시된 주소키 집합 → 해당 마커 강조
  indoorKeys?: Set<string>
  // 배차 결과 (납품번호 → 차량번호) → 마커에 차량번호 라벨 표시
  assignments?: Record<string, string>
  // 배차용 기사 목록 + 콜백 → 마커 클릭 정보창에서 직접 차량 배차
  drivers?: { teamName: string; vehicleNumber: string }[]
  onAssign?: (deliveryNo: string, vehicleNo: string) => void
  // 특정 차량번호만 지도에 표시 ('' = 전체) — 재지오코딩 없이 마커 표시/숨김
  visibleVehicle?: string
  // 드래그 배차 모드(VADS): 마커를 기사 목록([data-drop-vehicle])으로 끌어 배차. 배차된 마커는 지도에서 사라짐.
  dragAssign?: boolean
  // 전체 마커 보기: 배차된 마커도 지도에 표시(차량번호 라벨 포함). 배차 완료 후 검토용.
  showAssigned?: boolean
  // 동선 경로선 — 선택 차량의 설치 순서(최근접순) 좌표열. 지도에 폴리라인으로 표시.
  routePath?: { lat: number; lng: number }[]
  // 실시간 날씨 배지 (제주시·서귀포시) — 지도 좌상단 표시
  weather?: { name: string; temp: number | null; emoji: string; desc: string; rain: boolean }[]
}

function esc(s: string) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

const JEJU_CENTER = { lat: 33.4, lng: 126.55 }
const COLOR_HIGH = '#ef4444' // 빨강 = 2층이상
const COLOR_LOW = '#10b981'  // 초록 = 저층
const COLOR_INDOOR = '#0284c7' // 파랑 링 = 실내 실외기실

// 실내 실외기실 마커 강조(파란 링) / 해제 시 원상복구
function applyIndoorStyle(el: HTMLElement, on: boolean) {
  if (on) {
    el.style.position = 'relative'
    el.style.border = `2px solid ${COLOR_INDOOR}`
    el.style.boxShadow = `0 0 0 3px ${COLOR_INDOOR}, 0 1px 3px rgba(0,0,0,.5)`
  } else {
    // 모델색 테두리 복원 (없으면 흰색). 흰 링 + 그림자 유지.
    const mColor = el.dataset.mcolor || '#fff'
    el.style.border = `3px solid ${mColor}`
    el.style.boxShadow = '0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,.5)'
    const h = el.querySelector('.rv-house'); if (h) h.remove()
  }
}

// 배차된 차량번호를 마커 아래 라벨로 표시 / 해제 시 제거
function applyVehicleLabel(el: HTMLElement, vehicleNo: string) {
  const cur = el.querySelector('.rv-veh') as HTMLElement | null
  if (vehicleNo) {
    el.style.position = 'relative'
    if (cur) { cur.textContent = vehicleNo; return }
    const v = document.createElement('span')
    v.className = 'rv-veh'
    v.textContent = vehicleNo
    v.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);white-space:nowrap;'
      + 'background:#111;color:#fff;font-size:10px;font-weight:700;line-height:1;padding:2px 4px;border-radius:3px;'
      + 'box-shadow:0 1px 2px rgba(0,0,0,.4);pointer-events:none;'
    el.appendChild(v)
  } else if (cur) {
    cur.remove()
  }
}

// 다중선택 마커 강조 (파란 외곽선). indoor 의 box-shadow 와 겹치지 않게 outline 사용.
function applySelectStyle(el: HTMLElement, on: boolean) {
  if (on) { el.style.outline = '3px solid #2563eb'; el.style.outlineOffset = '2px'; el.style.zIndex = '10' }
  else { el.style.outline = ''; el.style.outlineOffset = ''; el.style.zIndex = '' }
}

export default function SafetyMap({ items, height = 460, focus, roadview = true, onGeocoded, indoorKeys, assignments, onAssign, visibleVehicle, dragAssign, showAssigned, routePath, weather }: Props) {
  const { ready, error } = useKakaoMap()
  const mapRef = useRef<HTMLDivElement | null>(null)
  // 실내실외기실 강조: 주소키 → 마커 엘리먼트들 (토글 시 재스타일)
  const markerElsByKey = useRef<Map<string, HTMLElement[]>>(new Map())
  const indoorKeyRef = useRef<Set<string>>(indoorKeys ?? new Set())
  // 배차 차량번호 라벨: 납품번호 → 마커 엘리먼트들
  const markerElsByDelivery = useRef<Map<string, HTMLElement[]>>(new Map())
  // 차량 필터용: 납품번호 → 좌표 (표시된 마커만 지도 맞춤)
  const coordsByDelivery = useRef<Map<string, { lat: number; lng: number }>>(new Map())
  const visibleVehicleRef = useRef<string>(visibleVehicle ?? '')
  const dragAssignRef = useRef<boolean>(!!dragAssign)
  useEffect(() => { dragAssignRef.current = !!dragAssign }, [dragAssign])
  const showAssignedRef = useRef<boolean>(!!showAssigned)
  // 다중선택: 선택된 납품번호 집합(리렌더로 마커 재생성되지 않게 ref 유지) + 개수 뱃지용 state
  const selectedRef = useRef<Set<string>>(new Set())
  const [selCount, setSelCount] = useState(0)
  const assignmentsRef = useRef<Record<string, string>>(assignments ?? {})
  // 배차 콜백 (드롭 핸들러가 최신 값을 참조하도록 ref)
  const onAssignRef = useRef(onAssign)
  useEffect(() => { onAssignRef.current = onAssign }, [onAssign])
  const onGeocodedRef = useRef(onGeocoded)
  useEffect(() => { onGeocodedRef.current = onGeocoded }, [onGeocoded])
  // 동선 경로선(폴리라인) — routePath 가 바뀔 때만 다시 그림
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routeLine = useRef<any>(null)
  const routeSig = (routePath || []).map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')
  useEffect(() => {
    if (!ready || !mapObj.current) return
    const kakao = window.kakao
    try { routeLine.current?.setMap(null) } catch { /* noop */ }
    routeLine.current = null
    const path = (routePath || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    if (path.length < 2) return
    routeLine.current = new kakao.maps.Polyline({
      path: path.map(p => new kakao.maps.LatLng(p.lat, p.lng)),
      strokeWeight: 4, strokeColor: '#4f46e5', strokeOpacity: 0.85, strokeStyle: 'solid',
    })
    routeLine.current.setMap(mapObj.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routeSig])
  // 마커 재생성(전체 재지오코딩)은 "지도에 찍는 데 필요한 값"이 바뀔 때만. 구역 재분류(regionByDelivery)
  // 처럼 좌표/주소와 무관한 변경으로 items 참조만 바뀌면 재생성하지 않는다(마커 깜빡임/원복 방지).
  const itemsRef = useRef(items)
  itemsRef.current = items
  const itemsSig = useMemo(
    () => items.map(i => `${i.key}|${i.address}|${i.isHigh ? 1 : 0}|${i.model || ''}|${i.modelName || ''}`).join(';'),
    [items],
  )
  const rvRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapObj = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rvObj = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rvClient = useRef<any>(null)
  // 로드뷰 시청 방향 화살표 (지도 위)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vpOverlay = useRef<any>(null)
  const vpArrow = useRef<SVGGElement | null>(null)
  const rvBound = useRef(false)
  const coords = useRef<Map<string, { lat: number; lng: number; isHigh: boolean }>>(new Map())
  const [stats, setStats] = useState({ geocoded: 0, failed: 0, total: 0 })
  const [rvActive, setRvActive] = useState(false)
  const [rvMsg, setRvMsg] = useState<string>('')
  // 마커 더블클릭 로드뷰 팝업 (VADS)
  const [rvPopup, setRvPopup] = useState<{ lat: number; lng: number; title: string } | null>(null)
  const [rvPopupMsg, setRvPopupMsg] = useState('')
  const rvPopupRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rvPopupObj = useRef<any>(null)
  // 로드뷰 팝업 위치/크기 — 드래그로 이동, 우하단 핸들로 확대/축소
  const RV_HEADER = 40
  const [rvBox, setRvBox] = useState({ x: 20, y: 80, w: 480, h: 420 })
  const rvDrag = useRef<{ dx: number; dy: number } | null>(null)
  // 팝업 열릴 때 기본 위치 = 좌측 하단
  useEffect(() => {
    if (rvPopup) setRvBox(b => ({ ...b, x: 20, y: Math.max(12, window.innerHeight - b.h - 20) }))
  }, [rvPopup])
  // 크기 변경 시 로드뷰 relayout (안 하면 빈 화면/찌그러짐)
  useEffect(() => {
    if (rvPopup && rvPopupObj.current) { const t = setTimeout(() => { try { rvPopupObj.current.relayout() } catch { /* noop */ } }, 30); return () => clearTimeout(t) }
  }, [rvBox.w, rvBox.h, rvPopup])
  function startRvDrag(e: React.MouseEvent) {
    e.preventDefault()
    rvDrag.current = { dx: e.clientX - rvBox.x, dy: e.clientY - rvBox.y }
    const move = (ev: MouseEvent) => {
      if (!rvDrag.current) return
      const nx = Math.min(Math.max(0, ev.clientX - rvDrag.current.dx), window.innerWidth - 140)
      const ny = Math.min(Math.max(0, ev.clientY - rvDrag.current.dy), window.innerHeight - 40)
      setRvBox(b => ({ ...b, x: nx, y: ny }))
    }
    const up = () => { rvDrag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  function startRvResize(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sy = e.clientY, sw = rvBox.w, sh = rvBox.h
    const move = (ev: MouseEvent) => setRvBox(b => ({
      ...b,
      w: Math.min(Math.max(300, sw + (ev.clientX - sx)), window.innerWidth - b.x - 8),
      h: Math.min(Math.max(260, sh + (ev.clientY - sy)), window.innerHeight - b.y - 8),
    }))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  function toggleRvMax() {
    setRvBox(b => {
      const big = b.w >= window.innerWidth * 0.7
      if (big) return { ...b, w: 480, h: 420, x: 20, y: Math.max(12, window.innerHeight - 420 - 20) }
      const w = Math.round(window.innerWidth * 0.8), h = Math.round(window.innerHeight * 0.82)
      return { w, h, x: Math.round((window.innerWidth - w) / 2), y: Math.round((window.innerHeight - h) / 2) }
    })
  }

  // 지도 위 시청방향 화살표를 좌표에 배치/생성
  function ensureViewpointArrow(lat: number, lng: number) {
    const kakao = window.kakao
    if (!kakao || !mapObj.current) return
    const pos = new kakao.maps.LatLng(lat, lng)
    if (!vpOverlay.current) {
      const el = document.createElement('div')
      el.style.cssText = 'width:52px;height:52px;'
      el.innerHTML =
        '<svg width="52" height="52" viewBox="0 0 52 52">' +
        '<g id="vp" style="transform-origin:26px 26px;transition:transform .12s ease-out">' +
        '<polygon points="26,1 37,22 26,17 15,22" fill="rgba(239,68,68,0.55)" stroke="#ef4444" stroke-width="1"/>' +
        '<circle cx="26" cy="26" r="6.5" fill="#ef4444" stroke="#fff" stroke-width="2"/>' +
        '</g></svg>'
      vpArrow.current = el.querySelector('#vp') as unknown as SVGGElement
      vpOverlay.current = new kakao.maps.CustomOverlay({ position: pos, content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: 5 })
    }
    vpOverlay.current.setPosition(pos)
    vpOverlay.current.setMap(mapObj.current)
  }
  // 로드뷰 시점(pan)만큼 화살표 회전 (0=북, 시계방향)
  function updateViewpointArrow() {
    if (!rvObj.current || !vpArrow.current) return
    try {
      const vp = rvObj.current.getViewpoint()
      vpArrow.current.style.transform = `rotate(${vp.pan}deg)`
    } catch { /* noop */ }
  }

  // 로드뷰 표시 (해당 좌표 근처 파노라마)
  function showRoadview(lat: number, lng: number) {
    const kakao = window.kakao
    if (!kakao) return
    setRvActive(true)   // 패널을 먼저 보이게 (숨김 상태에서 생성돼 빈 화면 나는 것 방지)
    setRvMsg('')
    // 다음 틱: 컨테이너가 화면에 그려진 뒤 로드뷰 생성/갱신
    setTimeout(() => {
      try {
        if (!rvRef.current) return
        if (!rvObj.current) rvObj.current = new kakao.maps.Roadview(rvRef.current)
        if (!rvClient.current) rvClient.current = new kakao.maps.RoadviewClient()
      } catch { setRvMsg('로드뷰 초기화 실패'); return }
      const pos = new kakao.maps.LatLng(lat, lng)

      const apply = (panoId: number) => {
        try { rvObj.current.setPanoId(panoId, pos) } catch { /* noop */ }
        // 컨테이너 레이아웃 확정 후 재적용(빈 화면 방지)
        setTimeout(() => { try { rvObj.current.relayout(); rvObj.current.setPanoId(panoId, pos) } catch { /* noop */ } }, 150)
        // 시청방향 화살표 (실패해도 로드뷰 자체엔 영향 없게 격리)
        try {
          ensureViewpointArrow(lat, lng)
          if (!rvBound.current) {
            kakao.maps.event.addListener(rvObj.current, 'viewpoint_changed', updateViewpointArrow)
            kakao.maps.event.addListener(rvObj.current, 'position_changed', () => {
              try { const p = rvObj.current.getPosition(); if (vpOverlay.current && p) vpOverlay.current.setPosition(p) } catch { /* noop */ }
              updateViewpointArrow()
            })
            rvBound.current = true
          }
          setTimeout(updateViewpointArrow, 400)
        } catch { /* 화살표 실패해도 로드뷰는 표시 */ }
      }

      // 근처 파노라마 검색 (200m → 없으면 1km 재시도)
      try {
        rvClient.current.getNearestPanoId(pos, 200, (panoId: number | null) => {
          if (panoId != null) { apply(panoId); return }
          rvClient.current.getNearestPanoId(pos, 1000, (panoId2: number | null) => {
            if (panoId2 != null) apply(panoId2)
            else setRvMsg('이 위치는 로드뷰가 제공되지 않습니다.')
          })
        })
      } catch { setRvMsg('로드뷰 조회 실패') }
    }, 0)
  }

  // 마커 표시 여부: 드래그 배차 모드면 "미배차만"(선택차량 있으면 그 차량만), 아니면 기존 차량필터
  function isMarkerVisible(deliveryNo: string) {
    const veh = assignmentsRef.current[deliveryNo] || ''
    const only = visibleVehicleRef.current
    if (only) return veh === only                                    // 특정 차량만 보기
    if (dragAssignRef.current && !showAssignedRef.current) return !veh // 배차모드 기본: 미배차만
    return true                                                       // 전체 보기(배차 포함)
  }
  // 모든 마커 표시/숨김 재계산 (배차되면 사라지고, 해제되면 다시 나타남)
  function refreshVisibility(fit: boolean) {
    const kakao = window.kakao
    const only = visibleVehicleRef.current
    const bounds = kakao && only ? new kakao.maps.LatLngBounds() : null
    let shown = 0
    markerElsByDelivery.current.forEach((els, dn) => {
      const on = isMarkerVisible(dn)
      els.forEach(el => { el.style.display = on ? '' : 'none' })
      if (on && bounds) { const c = coordsByDelivery.current.get(dn); if (c) { bounds.extend(new kakao.maps.LatLng(c.lat, c.lng)); shown++ } }
    })
    if (fit && only && bounds && shown > 0 && mapObj.current) {
      try { mapObj.current.setBounds(bounds); if (shown === 1) mapObj.current.setLevel(5) } catch { /* noop */ }
    }
  }

  // 마커 호버 툴팁 (클릭·드래그 전에 커서만 올려도 내용 표시)
  const hoverTip = useRef<HTMLDivElement | null>(null)
  function showHoverTip(html: string, x: number, y: number) {
    if (!hoverTip.current) {
      const t = document.createElement('div')
      t.style.cssText = 'position:fixed;z-index:9998;pointer-events:none;max-width:280px;padding:6px 10px;'
        + 'font-size:12px;line-height:1.5;background:#fff;color:#111;border:1px solid #d1d5db;border-radius:6px;'
        + 'box-shadow:0 4px 12px rgba(0,0,0,.18);transform:translate(-50%,calc(-100% - 12px));white-space:normal;'
      document.body.appendChild(t)
      hoverTip.current = t
    }
    hoverTip.current.innerHTML = html
    hoverTip.current.style.left = x + 'px'
    hoverTip.current.style.top = y + 'px'
    hoverTip.current.style.display = 'block'
  }
  function hideHoverTip() { if (hoverTip.current) hoverTip.current.style.display = 'none' }
  useEffect(() => () => { hoverTip.current?.remove() }, [])

  // 다중선택 토글 (마커 클릭 = 선택/해제)
  function toggleSelect(deliveryNo: string) {
    if (!deliveryNo) return
    const sel = selectedRef.current
    if (sel.has(deliveryNo)) sel.delete(deliveryNo); else sel.add(deliveryNo)
    const on = sel.has(deliveryNo)
    markerElsByDelivery.current.get(deliveryNo)?.forEach(el => applySelectStyle(el, on))
    setSelCount(sel.size)
  }
  // 선택 해제 (모두)
  function clearSelection() {
    selectedRef.current.forEach(dn => markerElsByDelivery.current.get(dn)?.forEach(el => applySelectStyle(el, false)))
    selectedRef.current.clear()
    setSelCount(0)
  }

  // 드롭 타깃(기사 박스) 찾기 — [data-drop-vehicle] 속성 요소
  function dropTargetAt(x: number, y: number): HTMLElement | null {
    const e = document.elementFromPoint(x, y) as HTMLElement | null
    return (e?.closest('[data-drop-vehicle]') as HTMLElement | null) ?? null
  }
  // 마커 드래그 → 기사 목록으로 끌어 배차. 선택된 마커면 선택 전체를 한꺼번에, 아니면 이 마커만.
  // 움직이지 않고 놓으면 클릭 = 선택 토글.
  function startMarkerDrag(e: MouseEvent, deliveryNo: string, el: HTMLElement, color: string) {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    hideHoverTip()
    const startX = e.clientX, startY = e.clientY
    let dragging = false
    let ghost: HTMLElement | null = null
    let over: HTMLElement | null = null
    // 드래그 대상: 이 마커가 선택돼 있으면 선택 전체, 아니면 이 마커만
    const dragIds = () => (selectedRef.current.has(deliveryNo) && selectedRef.current.size > 0)
      ? [...selectedRef.current] : [deliveryNo]
    const fade = (v: string) => dragIds().forEach(dn => markerElsByDelivery.current.get(dn)?.forEach(m => { m.style.opacity = v }))
    const setOver = (t: HTMLElement | null) => {
      if (t === over) return
      if (over) over.style.boxShadow = ''
      if (t) t.style.boxShadow = '0 0 0 3px #f59e0b inset'
      over = t
    }
    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return
        dragging = true
        const n = dragIds().length
        fade('0.3')
        ghost = document.createElement('div')
        ghost.textContent = n > 1 ? `${n}건 배차` : (deliveryNo || '배차')
        ghost.style.cssText = `position:fixed;z-index:9999;pointer-events:none;padding:3px 8px;border-radius:12px;`
          + `background:${color};color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.4);`
          + `transform:translate(-50%,-150%);white-space:nowrap;`
        document.body.appendChild(ghost)
      }
      if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px' }
      setOver(dropTargetAt(ev.clientX, ev.clientY))
    }
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      fade('')
      ghost?.remove()
      setOver(null)
      if (!dragging) { toggleSelect(deliveryNo); return }
      const t = dropTargetAt(ev.clientX, ev.clientY)
      const veh = t?.getAttribute('data-drop-vehicle')
      if (veh) { dragIds().forEach(dn => { if (dn) onAssignRef.current?.(dn, veh) }); clearSelection() }
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
  }

  // 지도 + 마커 초기화 (items 변경 시)
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const kakao = window.kakao
    const map = new kakao.maps.Map(mapRef.current, {
      center: new kakao.maps.LatLng(JEJU_CENTER.lat, JEJU_CENTER.lng),
      level: 9,
    })
    mapObj.current = map
    // 지도 재생성 → 이전 시청방향 화살표는 버리고 새 지도에 다시 생성되게 리셋
    vpOverlay.current = null
    vpArrow.current = null

    const geocoder = new kakao.maps.services.Geocoder()
    const bounds = new kakao.maps.LatLngBounds()
    coords.current = new Map()
    markerElsByKey.current = new Map()
    markerElsByDelivery.current = new Map()
    coordsByDelivery.current = new Map()
    const geoResults: GeocodedRow[] = []
    let done = 0, failed = 0, cancelled = false
    const overlays: { remove: () => void }[] = []
    const curItems = itemsRef.current
    const target = curItems.filter(it => it.address && it.address.trim().length > 0)

    if (target.length === 0) {
      setStats({ geocoded: 0, failed: curItems.length, total: curItems.length })
      return
    }

    const info = new kakao.maps.InfoWindow({ removable: true })

    // 상시 표시 모델 라벨 — 지도 축소 시 화면을 덮지 않도록 줌 레벨에 맞춰 크기/표시를 조절
    const labelEls: HTMLElement[] = []
    const updateModelLabels = () => {
      let lv = 6
      try { lv = map.getLevel() } catch { /* noop */ }
      // 카카오 레벨: 작을수록 확대. 확대(≤5)=코드까지, 6=한글+작은코드, 7=한글만, ≥8=숨김
      const showCode = lv <= 6
      const scale = lv <= 4 ? 1 : lv === 5 ? 0.9 : lv === 6 ? 0.82 : 0.72
      const hideAll = lv >= 8
      for (const lab of labelEls) {
        lab.style.display = hideAll ? 'none' : 'block'
        lab.style.transform = `translateX(-50%) scale(${scale})`
        const codeEl = lab.querySelector('.rv-mc') as HTMLElement | null
        if (codeEl) codeEl.style.display = showCode ? 'block' : 'none'
      }
    }
    kakao.maps.event.addListener(map, 'zoom_changed', updateModelLabels)

    const processNext = (i: number) => {
      if (cancelled || i >= target.length) {
        setStats({ geocoded: done, failed, total: curItems.length })
        if (done > 0) map.setBounds(bounds)
        setTimeout(updateModelLabels, 0)   // setBounds 후 최종 줌 레벨 반영
        if (!cancelled) onGeocodedRef.current?.(geoResults)   // 납품번호→주소키 전달
        return
      }
      const it = target[i]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      geocoder.addressSearch(it.address, (result: any[], status: string) => {
        if (cancelled) return
        const ok = status === kakao.maps.services.Status.OK && result[0]
        const addrKey = ok ? addrKeyFromKakao(result[0]) : normalizeAddr(it.address)
        // 행정동(구역 재분류용): 지번주소 우선, 없으면 도로명주소의 region_3depth
        const region3 = ok ? (result[0].address?.region_3depth_name || result[0].road_address?.region_3depth_name || '') : ''
        const gLat = ok ? parseFloat(result[0].y) : undefined
        const gLng = ok ? parseFloat(result[0].x) : undefined
        geoResults.push({ deliveryNo: it.deliveryNo, addrKey, address: it.address, region3, lat: gLat, lng: gLng })
        if (ok) {
          const lat = gLat as number
          const lng = gLng as number
          coords.current.set(it.key, { lat, lng, isHigh: it.isHigh })
          bounds.extend(new kakao.maps.LatLng(lat, lng))

          const color = it.isHigh ? COLOR_HIGH : COLOR_LOW
          const mColor = modelColor(it.model)   // 테두리 = 모델색 (탭 색과 동일)
          const el = document.createElement('div')
          // 채움=난이도(2층 빨강/저층 초록), 테두리=모델색. 흰 링으로 지도 위에서도 또렷하게.
          el.style.cssText = `width:24px;height:24px;border-radius:50%;border:3px solid ${mColor};`
            + `box-shadow:0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,.5);cursor:pointer;background:${color};box-sizing:border-box;`
          el.dataset.color = color
          el.dataset.mcolor = mColor
          // 실내실외기실 마커 강조 등록
          if (!markerElsByKey.current.has(addrKey)) markerElsByKey.current.set(addrKey, [])
          markerElsByKey.current.get(addrKey)!.push(el)
          applyIndoorStyle(el, indoorKeyRef.current.has(addrKey))
          // 배차 차량번호 라벨 등록 (납품번호 기준)
          if (it.deliveryNo) {
            if (!markerElsByDelivery.current.has(it.deliveryNo)) markerElsByDelivery.current.set(it.deliveryNo, [])
            markerElsByDelivery.current.get(it.deliveryNo)!.push(el)
            coordsByDelivery.current.set(it.deliveryNo, { lat, lng })
            applyVehicleLabel(el, assignmentsRef.current[it.deliveryNo] || '')
            // 배차 상태/차량필터에 따른 표시·숨김 (배차되면 지도에서 사라짐)
            if (!isMarkerVisible(it.deliveryNo)) el.style.display = 'none'
          }

          // 상시 표시 라벨 — 대표모델(한글)만. 실제 코드는 호버 툴팁에만. 축소 시 줌 레벨로 크기/표시 조절.
          if (it.model) {
            el.style.position = 'relative'
            const lab = document.createElement('div')
            lab.className = 'rv-model'
            lab.style.cssText = 'position:absolute;bottom:26px;left:50%;transform:translateX(-50%);transform-origin:bottom center;'
              + 'white-space:nowrap;pointer-events:none;text-align:center;z-index:2;'
            lab.innerHTML = `<span class="rv-mk" style="display:block;background:${mColor};color:#fff;font-size:11px;font-weight:700;line-height:1.2;padding:1px 5px;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.4);">${esc(it.model)}</span>`
            el.appendChild(lab)
            labelEls.push(lab)
          }

          // 커서만 올려도 내용 표시 (클릭·드래그 전 미리보기)
          const tipHtml =
            `<b>${esc(it.deliveryNo || '-')}</b>` +
            `<span style="background:${color};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px;">` +
            `${it.isHigh ? `${it.floor ?? ''}층(2층이상)` : '저층'}</span>` +
            `<div style="color:#111;margin-top:3px;font-weight:600;">대표모델: ${esc(it.model || '-')}</div>` +
            `${it.modelName ? `<div style="color:#1d4ed8;margin-top:1px;font-weight:700;font-family:monospace;">${esc(it.modelName)}</div>` : ''}` +
            `<div style="color:#555;margin-top:2px;">${esc(it.address)}</div>`
          el.addEventListener('mouseenter', e => showHoverTip(tipHtml, e.clientX, e.clientY))
          el.addEventListener('mousemove', e => showHoverTip(tipHtml, e.clientX, e.clientY))
          el.addEventListener('mouseleave', hideHoverTip)

          // 마커 클릭 → 정보창 + 로드뷰 (비 드래그 지도: 2층이상/저층). 배차 드롭다운은 제거됨.
          const openInfo = () => {
            hideHoverTip()
            try {
              const box = document.createElement('div')
              box.style.cssText = 'padding:6px 10px;font-size:12px;line-height:1.5;max-width:280px;'
              box.innerHTML = tipHtml
              info.setContent(box)
              info.setPosition(new kakao.maps.LatLng(lat, lng))
              info.open(map)
              map.panTo(new kakao.maps.LatLng(lat, lng))
            } catch { /* 인포윈도우 실패 무시 */ }
            if (roadview) showRoadview(lat, lng)   // 로드뷰 패널이 켜진 지도(2층이상·저층 모두)에서 표시
          }
          if (dragAssignRef.current && it.deliveryNo) {
            // VADS: 1클릭=선택, 드래그=배차, 더블클릭=로드뷰 팝업
            el.style.cursor = 'grab'
            el.addEventListener('mousedown', e => startMarkerDrag(e, it.deliveryNo, el, color))
            el.addEventListener('dblclick', e => {
              e.preventDefault(); e.stopPropagation()
              hideHoverTip()
              setRvPopup({ lat, lng, title: `${it.deliveryNo || ''} · ${it.address || ''}` })
            })
          } else {
            el.addEventListener('click', openInfo)
          }
          const ov = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(lat, lng), content: el, yAnchor: 0.5, xAnchor: 0.5, clickable: true,
          })
          ov.setMap(map)
          overlays.push({ remove: () => ov.setMap(null) })
          done++
          updateModelLabels()   // 방금 추가된 라벨을 현재 줌 레벨에 맞게
        } else {
          failed++
        }
        setTimeout(() => processNext(i + 1), 50)
      })
    }
    processNext(0)

    return () => {
      cancelled = true
      overlays.forEach(o => o.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, itemsSig])

  // 로드뷰 패널이 보이게 될 때 relayout (숨김 상태에서 생성돼 빈 화면 나는 것 방지)
  useEffect(() => {
    if (rvActive && rvObj.current) setTimeout(() => { try { rvObj.current.relayout() } catch { /* noop */ } }, 60)
  }, [rvActive])

  // 마커 더블클릭 로드뷰 팝업: 열릴 때 해당 좌표의 로드뷰 생성/표시
  useEffect(() => {
    if (!rvPopup) return
    const kakao = window.kakao
    if (!kakao) return
    setRvPopupMsg('')
    const t = setTimeout(() => {
      if (!rvPopupRef.current) return
      try {
        // 팝업 컨테이너는 열 때마다 새로 마운트되므로 로드뷰도 새로 생성
        rvPopupObj.current = new kakao.maps.Roadview(rvPopupRef.current)
        const rv = rvPopupObj.current
        const client = new kakao.maps.RoadviewClient()
        const pos = new kakao.maps.LatLng(rvPopup.lat, rvPopup.lng)
        // 마커를 지도 중앙으로 이동(팝업이 마커를 가리지 않게) + 시청방향 화살표 표시
        try { mapObj.current?.panTo(pos) } catch { /* noop */ }
        const updateArrow = () => { try { const vp = rv.getViewpoint(); if (vpArrow.current) vpArrow.current.style.transform = `rotate(${vp.pan}deg)` } catch { /* noop */ } }
        const apply = (panoId: number) => {
          try { rv.setPanoId(panoId, pos) } catch { /* noop */ }
          setTimeout(() => { try { rv.relayout(); rv.setPanoId(panoId, pos) } catch { /* noop */ } }, 150)
          // 2층/저층 로드뷰와 동일한 방향 화살표 (지도 위)
          try {
            ensureViewpointArrow(rvPopup.lat, rvPopup.lng)
            kakao.maps.event.addListener(rv, 'viewpoint_changed', updateArrow)
            kakao.maps.event.addListener(rv, 'position_changed', () => {
              try { const p = rv.getPosition(); if (vpOverlay.current && p) vpOverlay.current.setPosition(p) } catch { /* noop */ }
              updateArrow()
            })
            setTimeout(updateArrow, 500)
          } catch { /* 화살표 실패해도 로드뷰는 표시 */ }
        }
        client.getNearestPanoId(pos, 200, (panoId: number | null) => {
          if (panoId != null) { apply(panoId); return }
          client.getNearestPanoId(pos, 1000, (p2: number | null) => {
            if (p2 != null) apply(p2)
            else setRvPopupMsg('이 위치는 로드뷰가 제공되지 않습니다.')
          })
        })
      } catch { setRvPopupMsg('로드뷰 초기화 실패') }
    }, 40)
    // 팝업 닫힐 때 방향 화살표 제거
    return () => { clearTimeout(t); try { vpOverlay.current?.setMap(null) } catch { /* noop */ } }
  }, [rvPopup])

  // 실내실외기실 표시 변경 시 마커 강조 갱신 (지도 재생성 없이 스타일만)
  useEffect(() => {
    indoorKeyRef.current = indoorKeys ?? new Set()
    markerElsByKey.current.forEach((els, key) => {
      const on = indoorKeyRef.current.has(key)
      els.forEach(el => applyIndoorStyle(el, on))
    })
  }, [indoorKeys])

  // 배차 변경 시: 마커 차량번호 라벨 갱신 + 표시/숨김 재계산 (배차되면 사라짐)
  useEffect(() => {
    assignmentsRef.current = assignments ?? {}
    markerElsByDelivery.current.forEach((els, deliveryNo) => {
      const veh = assignmentsRef.current[deliveryNo] || ''
      els.forEach(el => applyVehicleLabel(el, veh))
    })
    // 배차된 건은 선택에서 제거 (마커가 사라지므로)
    const drop: string[] = []
    selectedRef.current.forEach(dn => { if (assignmentsRef.current[dn]) drop.push(dn) })
    if (drop.length) { drop.forEach(dn => selectedRef.current.delete(dn)); setSelCount(selectedRef.current.size) }
    refreshVisibility(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments])

  // 차량 필터/드래그모드: 마커 표시·숨김 재계산 + (선택 차량) 지도 맞춤
  useEffect(() => {
    visibleVehicleRef.current = visibleVehicle || ''
    refreshVisibility(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleVehicle, assignments, items])

  // 전체 마커 보기 토글: 배차된 마커 표시/숨김 재계산
  useEffect(() => {
    showAssignedRef.current = !!showAssigned
    refreshVisibility(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAssigned])

  // 리스트 행 클릭(focus) → 해당 마커로 이동 + (2층이상) 로드뷰
  useEffect(() => {
    if (!focus || !mapObj.current) return
    const c = coords.current.get(focus.key)
    if (!c) return
    const kakao = window.kakao
    mapObj.current.setLevel(4)
    mapObj.current.panTo(new kakao.maps.LatLng(c.lat, c.lng))
    if (roadview) showRoadview(c.lat, c.lng)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  // Esc → 다중선택 해제
  useEffect(() => {
    if (!dragAssign) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearSelection() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dragAssign])

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-700">
        지도 로드 실패: {error}
        <p className="text-xs text-red-500 mt-1">(Kakao Developers에서 도메인 등록 확인 필요)</p>
      </div>
    )
  }

    const weatherBadge = weather && weather.length > 0 ? (
      <div className="absolute bottom-8 left-2 z-10 flex flex-col gap-1">
        {weather.map(w => (
          <div key={w.name}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg shadow-md text-xs font-semibold border ${w.rain ? 'bg-sky-600 text-white border-sky-600' : 'bg-white/95 text-slate-700 border-slate-200'}`}>
            <span className="text-sm leading-none">{w.emoji}</span>
            <span>{w.name}</span>
            <span className="tabular-nums">{w.temp != null ? `${w.temp}°` : '-'}</span>
            <span className={w.rain ? 'text-sky-100' : 'text-slate-400'}>{w.desc}</span>
          </div>
        ))}
      </div>
    ) : null

  return (
    <div>
      {roadview ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="relative">
            <div ref={mapRef} style={{ height: `${height}px` }} className="rounded border bg-gray-100 w-full" />
            {weatherBadge}
          </div>
          <div className={rvActive ? 'block' : 'hidden lg:block'}>
            <div ref={rvRef} style={{ height: `${height}px` }} className="rounded border bg-gray-100 w-full" />
            {!rvActive && <p className="text-xs text-gray-400 mt-1">마커 또는 리스트 항목을 클릭하면 로드뷰가 표시됩니다.</p>}
            {rvMsg && <p className="text-xs text-amber-600 mt-1">{rvMsg}</p>}
          </div>
        </div>
      ) : (
        <div className="relative">
          <div ref={mapRef} style={{ height: `${height}px` }} className="rounded border bg-gray-100 w-full" />
          {weatherBadge}
          {dragAssign && selCount > 0 && (
            <div className="absolute top-2 left-2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-lg">
              선택 {selCount}건 — 기사에게 끌어 한꺼번에 배차
              <button onClick={clearSelection} className="ml-1 px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30 text-xs">취소(Esc)</button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ background: COLOR_HIGH }} />2층이상</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ background: COLOR_LOW }} />저층</span>
        {dragAssign && <span className="text-gray-400">· 마커 1클릭=선택, 더블클릭=로드뷰</span>}
        <span className="ml-auto text-gray-500">
          {ready ? `${stats.geocoded}/${stats.total} 위치 표시` : '지도 로드 중…'}
          {stats.failed > 0 && ` · 주소변환 실패 ${stats.failed}`}
        </span>
      </div>

      {/* 더블클릭 로드뷰 팝업 — 드래그로 이동, 우하단 핸들로 확대/축소, 배경 없이 플로팅 */}
      {rvPopup && (
        <div className="fixed z-[100] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
          style={{ left: rvBox.x, top: rvBox.y, width: rvBox.w, height: rvBox.h }}>
          <div onMouseDown={startRvDrag}
            className="flex items-center gap-2 px-3 border-b border-slate-200 bg-slate-50 cursor-move select-none shrink-0"
            style={{ height: RV_HEADER }}>
            <span className="font-semibold text-slate-700 text-sm">로드뷰</span>
            <span className="text-xs text-slate-400 truncate">{rvPopup.title}</span>
            <button onClick={toggleRvMax} onMouseDown={e => e.stopPropagation()}
              title="확대/축소"
              className="ml-auto px-2 py-1 rounded-lg text-xs text-slate-600 border border-slate-200 bg-white hover:bg-slate-50">확대</button>
            <button onClick={() => setRvPopup(null)} onMouseDown={e => e.stopPropagation()}
              className="px-2.5 py-1 rounded-lg text-sm text-slate-600 border border-slate-200 bg-white hover:bg-slate-50">닫기</button>
          </div>
          <div ref={rvPopupRef} className="w-full bg-gray-100 flex-1 min-h-0" />
          {rvPopupMsg && <p className="px-3 py-1 text-xs text-amber-600 shrink-0">{rvPopupMsg}</p>}
          {/* 우하단 리사이즈 핸들 */}
          <div onMouseDown={startRvResize}
            title="드래그하여 크기 조절"
            className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize"
            style={{ background: 'linear-gradient(135deg, transparent 50%, #94a3b8 50%)' }} />
        </div>
      )}
    </div>
  )
}
