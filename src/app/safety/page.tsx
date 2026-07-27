'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SafetyMap, { SafetyMapItem, GeocodedRow } from '@/components/SafetyMap'
import { extractDeliveryNumbers } from '@/lib/floorJudge'
import { getRegionByAddress, getRegionByCity, getRegionByDong, REGION_NAMES, REGION_ORDER, RegionCode } from '@/lib/zipcodeRegion'
import { isApartment } from '@/lib/addrKey'
import { modelColor } from '@/lib/modelColors'

interface SafetyItem {
  deliveryNo: string
  address: string
  floor: number | null
  isHigh: boolean
  vehicle: string
  model: string
  modelName?: string   // 실제 자재코드 (예: AF60F17D11WT+AR06D1150HZN)
  promiseTime: string
  remark?: string
}
interface SafetyResult { requested: number; fetched: number; addrCol: number; items: SafetyItem[] }
interface KeyedItem extends SafetyItem { key: string; region: RegionCode }

// 주소 기준 플래그(체크박스) 정의 — 실내실외기실 / 2점고정. 같은 방식으로 서버 저장·자동체크.
type FlagType = 'indoor' | 'twopoint'
type FlagMap = Record<FlagType, Record<string, boolean>>
const FLAG_DEFS: { type: FlagType; label: string; emoji: string }[] = [
  { type: 'indoor', label: '실내실외기실', emoji: '' },
  { type: 'twopoint', label: '2점고정', emoji: '' },
]
const emptyFlags = (): FlagMap => ({ indoor: {}, twopoint: {} })

// fetch 자체가 실패("Failed to fetch")하면 원인이 안 보이므로 실제 확인할 것들을 알려준다.
// (요청이 끝나기 전에 서버가 끊긴 경우 — SAP VBS가 팝업에서 멈춰 응답이 안 오는 상황이 대표적)
function netMsg(e: unknown, what: string): string {
  const m = e instanceof Error ? e.message : String(e ?? '')
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return `${what} 요청이 서버에 닿지 못했습니다 (${m}).\n\n확인사항:\n① 서버 창(start.bat)이 켜져 있는지 — 꺼졌거나 오류로 종료되지 않았는지\n② SAP 화면에 팝업/대화상자가 떠 있으면 닫기 (VBS가 멈춰 응답이 안 옴)\n③ SAP Logon 로그인 유지 확인\n④ 그래도 반복되면 서버 창을 닫고 start.bat 다시 실행`
  }
  return m || `${what} 중 오류가 발생했습니다`
}

// 안전관리 / VADS 공용 화면. withDispatch=true 면 전체지도+배차 섹션 포함(VADS), false 면 제외(안전관리).
// inputMode: 'order'=주문번호(안전관리) / 'delivery'=납품번호(VADS) — SAP 조회 키가 달라짐
export function SafetyView({ withDispatch, title, subtitle, inputMode = 'order' }: { withDispatch: boolean; title: string; subtitle: string; inputMode?: 'order' | 'delivery' }) {
  const inputLabel = inputMode === 'delivery' ? '납품번호' : '주문번호'
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [res, setRes] = useState<SafetyResult | null>(null)
  const [pullToken, setPullToken] = useState(0)   // SAP 끌고오기 시 ResultView 배차/지도 갱신 트리거
  // 주소 플래그(실내실외기실·2점고정) — 카카오 정규화 "주소키" 기준, 공유 DB 저장. 같은 주소면 자동 체크/누적.
  const [flags, setFlags] = useState<FlagMap>(emptyFlags)
  // 저장 상태 표시 (체크 즉시 23.20.121.23 자동 저장 → 별도 저장 버튼 불필요)
  const [saveState, setSaveState] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ status: 'idle' })

  // 탭별 저장 키 — 안전관리(order)와 VADS(delivery)는 완전 별개 (스냅샷·붙여넣기 텍스트 모두 분리)
  const storeKey = inputMode === 'delivery' ? 'vads_text' : 'safety_text'
  // 공유 DB(23.20.121.23)에서 "이 탭의" 최신 결과 + 주소 플래그 불러오기 → 여러 PC 동일 데이터
  useEffect(() => {
    fetch(`/api/safety/import?mode=${inputMode}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d && Array.isArray(d.items) && d.items.length > 0) setRes(d) })
      .catch(() => { /* noop */ })
    fetch('/api/safety/flag', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d && d.flags) setFlags({ indoor: d.flags.indoor ?? {}, twopoint: d.flags.twopoint ?? {} }) })
      .catch(() => { /* noop */ })
    try { const t = sessionStorage.getItem(storeKey); if (t) setText(t) } catch { /* noop */ }
  }, [inputMode, storeKey])

  // 플래그 토글 (주소키 기준) → 낙관적 반영 + 23.20.121.23 자동 저장 (sample=대표 주소)
  const setFlag = useCallback((type: FlagType, key: string, on: boolean, sample: string) => {
    if (!key) return
    setFlags(f => ({ ...f, [type]: { ...f[type], [key]: on } }))
    setSaveState({ status: 'saving' })
    fetch('/api/safety/flag', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, flag: type, on, sample }),
    }).then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      setSaveState({ status: 'saved' })
      setTimeout(() => setSaveState(s => (s.status === 'saved' ? { status: 'idle' } : s)), 2500)
    }).catch(err => {
      // 저장 실패 → 낙관적 변경 되돌림 + 경고 (데이터 유실 방지)
      setFlags(f => ({ ...f, [type]: { ...f[type], [key]: !on } }))
      setSaveState({ status: 'error', msg: err instanceof Error ? err.message : '저장 실패' })
    })
  }, [])
  useEffect(() => { try { sessionStorage.setItem(storeKey, text) } catch { /* noop */ } }, [text, storeKey])

  const prev = extractDeliveryNumbers(text).length

  // SAP(zllek52060)에서 납품번호별 배차 차량을 가져와, 해당 납품번호에 배차 상태로 반영(미배차는 그대로).
  async function enrichVehiclesFromSap(deliveryNos: Set<string>) {
    if (deliveryNos.size === 0) return
    try {
      const r = await fetch('/api/safety/pull-deliveries', { method: 'POST' })
      const data = await r.json()
      if (!r.ok || !Array.isArray(data.items)) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pairs = data.items.filter((p: any) => p.vehicle && deliveryNos.has(String(p.deliveryNo)))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => ({ deliveryNo: String(p.deliveryNo), vehicleNo: String(p.vehicle), source: 'sap' }))
      if (pairs.length) {
        await fetch('/api/safety/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: pairs }) }).catch(() => {})
        setPullToken(t => t + 1)   // ResultView가 배차/지도 갱신
      }
    } catch { /* 차량 보강 실패해도 주소/지도는 유지 */ }
  }

  async function handleFetch() {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/safety/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveries: text, mode: inputMode }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setRes(data)
      // VADS(납품번호): SAP 기존 배차 차량도 함께 가져와 지도에 배차분으로 표기
      if (inputMode === 'delivery' && Array.isArray(data.items)) {
        await enrichVehiclesFromSap(new Set(data.items.map((i: { deliveryNo: string }) => String(i.deliveryNo))))
      }
    } catch (e) {
      setError(netMsg(e, '조회'))
    } finally { setLoading(false) }
  }

  // VADS: SAP(zllek52060)에서 익일 물량 납품번호+배차차량을 끌어와 주소 조회 + 기존 배차 반영
  async function handlePull() {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/safety/pull-deliveries', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pulled: { deliveryNo: string; vehicle: string; remark?: string }[] = data.items || (data.deliveries || []).map((d: string) => ({ deliveryNo: d, vehicle: '', remark: '' }))
      const txt = pulled.map(p => p.deliveryNo).join('\n')
      setText(txt)
      if (pulled.length === 0) { setError('SAP에서 익일 물량 납품번호가 조회되지 않았습니다.'); return }
      const r2 = await fetch('/api/safety/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveries: txt, mode: inputMode }),
      })
      const d2 = await r2.json()
      if (!r2.ok) throw new Error(d2.error || `HTTP ${r2.status}`)
      // 지도·복사·전송이 SAP 끌고오기의 '납품번호(delivery)'를 기준 키로 쓰도록 아이템을 pull 기준으로 재구성
      // (주소/모델/층은 주소조회 결과에서 납품번호로 조인)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const addrByDel = new Map<string, any>((d2.items || []).map((it: { deliveryNo: string }) => [String(it.deliveryNo), it]))
      const mergedItems = pulled.map(p => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a: any = addrByDel.get(p.deliveryNo) || {}
        return {
          deliveryNo: p.deliveryNo,
          address: a.address || '', floor: a.floor ?? null, isHigh: !!a.isHigh,
          vehicle: p.vehicle || a.vehicle || '', model: a.model || '', modelName: a.modelName || '', promiseTime: a.promiseTime || '',
          remark: p.remark || a.remark || '',
        }
      })
      setRes({ ...d2, items: mergedItems, fetched: mergedItems.length })
      // SAP에 이미 배차된(차량번호 있는) 건은 그대로 배차 상태로 반영 (미배차는 그대로 미배차)
      const sapPairs = pulled.filter(p => p.vehicle).map(p => ({ deliveryNo: p.deliveryNo, vehicleNo: p.vehicle, source: 'sap' }))
      if (sapPairs.length) {
        await fetch('/api/safety/dispatch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: sapPairs }),
        }).catch(() => { /* noop */ })
      }
      setPullToken(t => t + 1)   // ResultView가 배차/지도 갱신하도록
    } catch (e) {
      setError(netMsg(e, 'SAP 끌고오기'))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-indigo-50/40">
      <div className="bg-white border-b border-slate-200">
        <div className="w-full lg:w-[90%] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <span className="w-1 h-9 rounded-full bg-gradient-to-b from-indigo-500 to-violet-600" />
          <div>
            <h1 className="text-lg font-bold text-slate-800 leading-tight tracking-tight">{title}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>

      <main className="w-full lg:w-[90%] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="max-w-2xl">
          {inputMode === 'delivery' && (
            <button onClick={handlePull} disabled={loading}
              className="mb-2 w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-semibold shadow-sm shadow-indigo-200 hover:opacity-95 disabled:opacity-50 transition-opacity">
              {loading ? 'SAP 조회 중…' : 'SAP 익일 물량 끌고오기 (zllek52060)'}
            </button>
          )}
          <PasteCard title={inputLabel} text={text} setText={setText} preview={prev}
            loading={loading} onFetch={handleFetch}
            onClear={() => { setText(''); setRes(null); setError(null) }} />
          <p className="text-xs text-gray-400 mt-2">※ SAP Logon 로그인 상태 필요. 7~10자리 숫자를 {inputLabel}로 인식, 중복 자동 제거. 주소 층으로 2층이상/저층 자동 분류됩니다.{inputMode === 'delivery' ? ' (VADS = 익일 물량 납품번호 붙여넣기)' : ''}</p>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded p-4 text-sm whitespace-pre-wrap">{error}</div>}

        {res && <ResultView label="" res={res} flags={flags} setFlag={setFlag} withDispatch={withDispatch} pullToken={pullToken} />}
      </main>

      {/* 실내실외기실 저장 상태 (체크 즉시 23.20.121.23 자동 저장) */}
      {saveState.status !== 'idle' && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${
          saveState.status === 'saving' ? 'bg-gray-800 text-white'
            : saveState.status === 'saved' ? 'bg-emerald-600 text-white'
              : 'bg-red-600 text-white'}`}>
          {saveState.status === 'saving' && '저장 중…'}
          {saveState.status === 'saved' && '✓ 23.20.121.23에 저장됨'}
          {saveState.status === 'error' && `저장 실패 — 되돌림 (${saveState.msg ?? ''})`}
        </div>
      )}
    </div>
  )
}

// 한 박스의 결과 = 2층/저층 자동분류 + 지도 + 로드뷰 + 차량드롭다운 + PDF (독립)
function ResultView({ label, res, flags, setFlag, withDispatch, pullToken = 0 }: {
  label: string; res: SafetyResult; flags: FlagMap
  setFlag: (type: FlagType, key: string, on: boolean, sample: string) => void
  withDispatch: boolean
  pullToken?: number
}) {
  const [focus, setFocus] = useState<{ key: string; n: number } | null>(null)
  const [vehicleFilter, setVehicleFilter] = useState('')
  // 구역 필터 (ABCDE) — 지도/리스트를 해당 구역만 표시 (2층·저층 공통)
  // 구역 필터 — 다중선택(빈 배열 = 전체). 예: A+E 동시 선택 시 두 구역 물량이 함께 지도에 표시
  const [regionSel, setRegionSel] = useState<RegionCode[]>([])
  const toggleRegion = (r: RegionCode) =>
    setRegionSel(cur => (cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r]))
  // 모델 필터 — 다중선택(빈 배열 = 전체). 예: 홈멀티+스탠드만 지도에 표시. 사전방문은 기본모델로 매칭.
  const [modelSel, setModelSel] = useState<string[]>([])
  const toggleModel = (m: string) =>
    setModelSel(cur => (cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m]))
  const inModel = (model?: string) => modelSel.length === 0 || modelSel.includes(baseModel(model) || '단품')
  // 자동배차 가중치(동선·매출·난이도) — 담당자 성향별. 프리셋으로 빠르게 전환.
  const [autoW, setAutoW] = useState<{ route: number; rev: number; diff: number }>({ route: 70, rev: 20, diff: 10 })
  const AUTO_PRESETS: Record<string, { route: number; rev: number; diff: number }> = {
    '동선 우선': { route: 70, rev: 20, diff: 10 },
    '매출 우선': { route: 20, rev: 70, diff: 10 },
    '난이도 우선': { route: 20, rev: 20, diff: 60 },
    '균등': { route: 34, rev: 33, diff: 33 },
  }
  // #5 배차 잠금 — 켜면 드래그/드롭다운/자동배차/초기화 비활성 (확정 후 실수 방지)
  const [locked, setLocked] = useState(false)
  // #6 KPI 리포트 표시
  const [showKpi, setShowKpi] = useState(false)
  // #5 변경 이력 (세션) — 누가/언제는 생략, 무엇이 바뀌었는지만 최근 50건
  const [history, setHistory] = useState<{ t: string; msg: string }[]>([])
  const logHistory = useCallback((msg: string) => {
    setHistory(h => [{ t: new Date().toLocaleTimeString('ko-KR', { hour12: false }), msg }, ...h].slice(0, 50))
  }, [])
  // 플래그별 "만 보기" 필터 (실내실외기실만 / 2점고정만)
  const [flagOnly, setFlagOnly] = useState<Record<FlagType, boolean>>({ indoor: false, twopoint: false })
  // 카카오 지오코딩으로 얻은 (납품번호 → 정규화 주소키) — 지도에서 전달받음
  const [addrKeyByDelivery, setAddrKeyByDelivery] = useState<Record<string, string>>({})
  // 카카오 행정동으로 재분류한 구역 (도로명만 있는 주소의 미분류 보정)
  const [regionByDelivery, setRegionByDelivery] = useState<Record<string, RegionCode>>({})
  // 납품번호 → 위경도 (지도에서 지오코딩된 좌표) — 차량별 이동거리·동선 경로 계산용. 세션 동안 누적.
  const [coordByDelivery, setCoordByDelivery] = useState<Record<string, { lat: number; lng: number }>>({})
  // SAP 비고 — 공유 DB 보관분. 끌고오기 결과(res.items.remark)가 없어도(새로고침 등) 이걸로 보완.
  const [remarkByDelivery, setRemarkByDelivery] = useState<Record<string, string>>({})
  const loadRemarks = useCallback(() => {
    fetch('/api/safety/remark', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d?.remarks) setRemarkByDelivery(d.remarks) })
      .catch(() => { /* noop */ })
  }, [])
  useEffect(() => { if (withDispatch) loadRemarks() }, [withDispatch, loadRemarks])
  // 실시간 날씨(제주시·서귀포시) — 지도 배지. 10분마다 갱신(서버 캐시 10분).
  const [weather, setWeather] = useState<{ name: string; temp: number | null; emoji: string; desc: string; rain: boolean }[]>([])
  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/weather', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (alive && Array.isArray(d?.spots)) setWeather(d.spots.filter((s: { temp: number | null }) => s.temp != null)) })
      .catch(() => { /* noop */ })
    load()
    const id = setInterval(load, 10 * 60 * 1000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  const onGeocoded = useCallback((rows: GeocodedRow[]) => {
    setAddrKeyByDelivery(prev => {
      let changed = false
      const next = { ...prev }
      for (const r of rows) if (r.deliveryNo && r.addrKey && prev[r.deliveryNo] !== r.addrKey) { next[r.deliveryNo] = r.addrKey; changed = true }
      return changed ? next : prev   // 변경 없으면 같은 참조 반환 → 리렌더/재지오코딩 루프 방지
    })
    setRegionByDelivery(prev => {
      let changed = false
      const next = { ...prev }
      for (const r of rows) {
        const reg = getRegionByDong(r.region3)
        if (r.deliveryNo && reg !== 'UNKNOWN' && prev[r.deliveryNo] !== reg) { next[r.deliveryNo] = reg; changed = true }
      }
      return changed ? next : prev
    })
    setCoordByDelivery(prev => {
      let changed = false
      const next = { ...prev }
      for (const r of rows) {
        if (r.deliveryNo && typeof r.lat === 'number' && typeof r.lng === 'number' && !prev[r.deliveryNo]) {
          next[r.deliveryNo] = { lat: r.lat, lng: r.lng }; changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])
  // 플래그별 주소키 집합 + 행별 판정
  const keySets = useMemo(() => ({
    indoor: new Set(Object.keys(flags.indoor).filter(k => flags.indoor[k])),
    twopoint: new Set(Object.keys(flags.twopoint).filter(k => flags.twopoint[k])),
  }), [flags])
  const isFlagged = useCallback((type: FlagType, deliveryNo: string) => {
    const k = addrKeyByDelivery[deliveryNo]; return !!(k && keySets[type].has(k))
  }, [addrKeyByDelivery, keySets])
  const toggleFlag = (type: FlagType, deliveryNo: string, address: string) => {
    const key = addrKeyByDelivery[deliveryNo]
    if (!key) return   // 아직 지오코딩 전 → 잠시 후 다시
    setFlag(type, key, !flags[type][key], address)
  }
  // 실내실외기실 강조용(지도) 주소키 집합
  const indoorKeySet = keySets.indoor

  // ── 배차: 기사 리스트 + 납품번호별 차량 배정 (공유 DB) ──
  const [drivers, setDrivers] = useState<{ teamName: string; vehicleNumber: string }[]>([])
  const [assignments, setAssignments] = useState<Record<string, { vehicleNo: string; driverName: string; source?: string }>>({})
  // 차량별 능력치 설정 (가능대수 + 선호모델 + 저층전용 + 가동여부 + 담당구역) — 자동배차가 참조
  const [vehicleConfig, setVehicleConfig] = useState<Record<string, { maxCount: number; models: string[]; lowOnly: boolean; active: boolean; region: string; modelsOnly?: boolean }>>({})
  // 지도에 특정 차량만 보기 ('' = 전체)
  const [mapVehicle, setMapVehicle] = useState('')
  // 전체 마커 보기(배차 포함 + 차량번호 라벨) — 배차 완료 후 검토용
  const [showAllMarkers, setShowAllMarkers] = useState(false)
  // SAP 끌고오기 시: 배차(SAP 기존 배차 포함) 재조회 + 전체 마커 보기 ON → 배차분+미배차분 함께 표시
  useEffect(() => {
    if (!pullToken) return
    fetch('/api/safety/dispatch', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.assignments) setAssignments(d.assignments) }).catch(() => { /* noop */ })
    loadRemarks()          // 끌고오기로 새로 저장된 비고 반영
    setShowAllMarkers(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullToken])
  // 기사 리스트/배차를 항상 최신으로 (캐시 금지). 창 포커스 시에도 재조회 → 다른 탭·PC 업데이트 반영.
  const loadDrivers = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch('/api/drivers', { cache: 'no-store' }).then(r => r.json()).then((d: any) => {
      // 차량번호 있고 계약종료(CONTRACT_ENDED) 아닌 기사만 VADS로 가져옴
      if (Array.isArray(d)) setDrivers(d.filter((x: { vehicleNumber?: string; status?: string }) => x.vehicleNumber && x.status !== 'CONTRACT_ENDED')
        .map((x: { teamName: string; vehicleNumber: string }) => ({ teamName: x.teamName, vehicleNumber: x.vehicleNumber })))
    }).catch(() => { /* noop */ })
  }, [])
  useEffect(() => {
    if (!withDispatch) return   // 안전관리(배차 없음)에서는 기사/배차 로딩 생략
    loadDrivers()
    fetch('/api/safety/dispatch', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.assignments) setAssignments(d.assignments) }).catch(() => { /* noop */ })
    fetch('/api/safety/vehicle-config', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d?.configs) setVehicleConfig(d.configs) }).catch(() => { /* noop */ })
    const onFocus = () => loadDrivers()
    const onVisible = () => { if (!document.hidden) loadDrivers() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible) }
  }, [loadDrivers, withDispatch])
  // 배차 지정/해제 (드래그·표 드롭다운 = 수동) → 낙관적 반영 + 공유 DB 저장
  const assign = (deliveryNo: string, vehicleNo: string) => {
    if (!deliveryNo) return
    if (locked) { alert('배차가 잠겨 있습니다. 상단 [잠금 해제] 후 변경하세요.'); return }
    const driverName = drivers.find(d => d.vehicleNumber === vehicleNo)?.teamName || ''
    setAssignments(a => {
      const next = { ...a }
      if (vehicleNo) next[deliveryNo] = { vehicleNo, driverName, source: 'manual' }
      else delete next[deliveryNo]
      return next
    })
    logHistory(vehicleNo ? `${deliveryNo} → ${vehicleNo} 수동배차` : `${deliveryNo} 배차 해제`)
    fetch('/api/safety/dispatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryNo, vehicleNo, driverName, source: 'manual' }),
    }).catch(() => { /* noop */ })
  }

  // 차량 설정 저장 (가능대수/선호모델/저층전용/가동여부/담당구역) → 낙관적 반영 + 공유 DB
  const saveVehicleConfig = (vehicleNo: string, cfg: { maxCount: number; models: string[]; lowOnly: boolean; active: boolean; region: string; modelsOnly?: boolean }) => {
    setVehicleConfig(c => ({ ...c, [vehicleNo]: cfg }))
    fetch('/api/safety/vehicle-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleNo, maxCount: cfg.maxCount, models: cfg.models, lowOnly: cfg.lowOnly, active: cfg.active, region: cfg.region, modelsOnly: !!cfg.modelsOnly }),
    }).catch(() => { /* noop */ })
  }
  const DEFAULT_CFG = { maxCount: 0, models: [] as string[], lowOnly: false, active: true, region: '', modelsOnly: false }
  // 담당 구역 배정 (드래그드랍) — 기존 설정 유지하며 region 만 변경 (''=미배정=오늘 미사용)
  const setVehicleRegion = (vehicleNo: string, region: string) => {
    saveVehicleConfig(vehicleNo, { ...DEFAULT_CFG, ...vehicleConfig[vehicleNo], region })
  }
  // 차량의 담당 구역 ('' = 미배정). 구역 배정된 차량 = 오늘 가동(배차 대상)
  const regionOf = useCallback((v: string) => vehicleConfig[v]?.region || '', [vehicleConfig])
  // 지도에 넘길 (납품번호 → 차량번호)
  const assignVehMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const [dn, a] of Object.entries(assignments)) m[dn] = a.vehicleNo
    return m
  }, [assignments])

  const baseItems = useMemo(() => {
    const seen = new Set<string>(); const out: KeyedItem[] = []
    ;(res.items ?? []).forEach((it, i) => {
      const id = it.deliveryNo || `n${i}`
      if (seen.has(id)) return
      seen.add(id); out.push({ ...it, key: `${label}-${id}`, region: getRegionByAddress(it.address) })
    })
    return out
  }, [res, label])
  // 미분류(UNKNOWN) 보정 3단계: ① 주소 동·읍·면 키워드(baseItems) → ② 카카오 행정동 → ③ 시(市) 단위 최후 보정.
  // ③ 이 없으면 지오코딩 실패 주소(도로명+아파트 동호수 등)가 미분류로 남아 자동배차에서 누락됨.
  const items = useMemo(() => baseItems.map(base => {
    // 비고: 이번 조회 결과 우선, 없으면 공유 DB 보관분(새로고침 후에도 유지)
    const it = base.remark ? base : { ...base, remark: remarkByDelivery[base.deliveryNo] || '' }
    if (it.region !== 'UNKNOWN') return it
    const byDong = regionByDelivery[it.deliveryNo]
    if (byDong && byDong !== 'UNKNOWN') return { ...it, region: byDong }
    return { ...it, region: getRegionByCity(it.address) }
  }), [baseItems, regionByDelivery, remarkByDelivery])
  // SAP에 이미 배차된 차량 → 담당 구역 자동 배정: 그 차량이 맡은 건들의 다수 구역으로.
  // regionOf(veh)가 비어있는 차량만 설정 → 설정되면 vehicleConfig 갱신되어 재발화 안 함(멱등).
  useEffect(() => {
    if (!withDispatch) return
    const regionByDel = new Map(items.map(it => [it.deliveryNo, it.region]))
    const tally = new Map<string, Map<RegionCode, number>>()   // veh -> {region: count}
    for (const [dn, a] of Object.entries(assignments)) {
      const reg = regionByDel.get(dn)
      if (!reg || reg === 'UNKNOWN') continue
      if (!tally.has(a.vehicleNo)) tally.set(a.vehicleNo, new Map())
      const m = tally.get(a.vehicleNo)!
      m.set(reg as RegionCode, (m.get(reg as RegionCode) ?? 0) + 1)
    }
    for (const [veh, m] of tally) {
      if (regionOf(veh)) continue                              // 이미 구역 있으면 유지
      let best: RegionCode | '' = '', bestN = 0
      for (const [reg, n] of m) if (n > bestN) { bestN = n; best = reg }
      if (best) setVehicleRegion(veh, best)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, items, withDispatch])
  // 2층이상은 납기시간(promise time) 오름차순 정렬 (빈 값은 뒤로)
  const high = useMemo(() =>
    items.filter(i => i.isHigh).sort((a, b) => (a.promiseTime || '~').localeCompare(b.promiseTime || '~')), [items])
  const low = useMemo(() => items.filter(i => !i.isHigh), [items])
  const toMap = (arr: KeyedItem[]): SafetyMapItem[] =>
    arr.map(k => ({ key: k.key, deliveryNo: k.deliveryNo, address: k.address, floor: k.floor, isHigh: k.isHigh, model: k.model, modelName: k.modelName }))
  const vehicles = useMemo(() => [...new Set(high.map(h => h.vehicle).filter(Boolean))].sort(), [high])
  // 구역별 건수 (탭에 표시) — 전체 items 기준
  const regionCounts = useMemo(() => {
    const c = {} as Record<string, number>
    items.forEach(i => { c[i.region] = (c[i.region] ?? 0) + 1 })
    return c
  }, [items])
  // 구역별 설치 대수(홈멀티=2) — 구역 배정 시 차량당 평균 산출용
  const regionUnits = useMemo(() => {
    const c = {} as Record<string, number>
    items.forEach(i => { c[i.region] = (c[i.region] ?? 0) + modelUnits(i.model) })
    return c
  }, [items])
  const inRegion = (r: RegionCode) => regionSel.length === 0 || regionSel.includes(r)
  // 모델별 건수 — 구역 선택을 반영(그 구역들의 모델 분포). 사전방문은 기본모델에 합산.
  const modelCountsAll = useMemo(() => {
    const c = {} as Record<string, number>
    items.forEach(i => { if (inRegion(i.region)) { const m = baseModel(i.model) || '단품'; c[m] = (c[m] ?? 0) + 1 } })
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, regionSel])
  // 플래그별 건수 (전체 items 기준) + 실내실외기실 중 아파트 별도 카운팅
  const flagCounts = useMemo(() => {
    let indoor = 0, indoorApt = 0, twopoint = 0
    for (const it of items) {
      if (isFlagged('indoor', it.deliveryNo)) { indoor++; if (isApartment(it.address)) indoorApt++ }
      if (isFlagged('twopoint', it.deliveryNo)) twopoint++
    }
    return { indoor, indoorApt, twopoint }
  }, [items, isFlagged])
  // PDF용: 플래그별 (해당 납품번호 집합)
  const flagDeliverySets = useMemo(() => ({
    indoor: new Set(items.filter(i => isFlagged('indoor', i.deliveryNo)).map(i => i.deliveryNo)),
    twopoint: new Set(items.filter(i => isFlagged('twopoint', i.deliveryNo)).map(i => i.deliveryNo)),
  }), [items, isFlagged])
  // 지도용 2층 목록 = 구역 + 차량 필터만 (플래그와 분리) → 플래그 토글이 지도 재지오코딩을 유발하지 않게
  const highForMap = useMemo(() => high.filter(h => inRegion(h.region) && (!vehicleFilter || h.vehicle === vehicleFilter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [high, vehicleFilter, regionSel])
  // 표(리스트)용 2층 = 지도용 + (실내실외기실만 / 2점고정만) 필터
  const highFiltered = useMemo(() => {
    let arr = highForMap
    if (flagOnly.indoor) arr = arr.filter(h => isFlagged('indoor', h.deliveryNo))
    if (flagOnly.twopoint) arr = arr.filter(h => isFlagged('twopoint', h.deliveryNo))
    return arr
  }, [highForMap, flagOnly, isFlagged])
  const lowFiltered = useMemo(() => low.filter(l => inRegion(l.region)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [low, regionSel])
  // 전체(2층이상+저층) 합친 지도용 — 구역 필터 + 모델 필터 (배차 전체 물량 참고용)
  const allForMap = useMemo(() => items.filter(i => inRegion(i.region) && inModel(i.model)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, regionSel, modelSel])
  // 지도 items 는 참조 고정(useMemo) — 실내여부와 무관(highForMap)하게 유지해 지도 재생성/무한루프 방지
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const highMapItems = useMemo(() => toMap(highForMap), [highForMap])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lowMapItems = useMemo(() => toMap(lowFiltered), [lowFiltered])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allMapItems = useMemo(() => toMap(allForMap), [allForMap])
  // 배차 테이블용 정렬(구역 → 층 → 납기시간) — 동선 참고
  const dispatchList = useMemo(() => {
    // 지도에서 특정 차량만 보기(mapVehicle) → 배차표도 그 차량 건만
    const base = mapVehicle ? allForMap.filter(it => assignments[it.deliveryNo]?.vehicleNo === mapVehicle) : allForMap
    return [...base].sort((a, b) =>
      (a.region).localeCompare(b.region) || Number(b.isHigh) - Number(a.isHigh) ||
      (a.promiseTime || '~').localeCompare(b.promiseTime || '~'))
  }, [allForMap, mapVehicle, assignments])
  // 차량번호 → 배차된 건들 (기사 목록 드롭 타깃에서 요약·복사용)
  const assignedByVehicle = useMemo(() => {
    const m = new Map<string, KeyedItem[]>()
    for (const it of allForMap) {
      const a = assignments[it.deliveryNo]; if (!a) continue
      if (!m.has(a.vehicleNo)) m.set(a.vehicleNo, [])
      m.get(a.vehicleNo)!.push(it)
    }
    return m
  }, [allForMap, assignments])
  const assignedCount = dispatchList.filter(i => assignments[i.deliveryNo]).length
  // 차량별 동선(최근접순) + 이동거리(km) — 좌표가 확보된 배차건 기준(구역/모델 필터와 무관, 전체)
  const vehicleRoutes = useMemo(() => {
    const byVeh = new Map<string, { deliveryNo: string; key: string; lat: number; lng: number }[]>()
    for (const it of items) {
      const a = assignments[it.deliveryNo]; const c = coordByDelivery[it.deliveryNo]
      if (!a || !c) continue
      if (!byVeh.has(a.vehicleNo)) byVeh.set(a.vehicleNo, [])
      byVeh.get(a.vehicleNo)!.push({ deliveryNo: it.deliveryNo, key: it.key, lat: c.lat, lng: c.lng })
    }
    const out = new Map<string, { km: number; order: { deliveryNo: string; lat: number; lng: number }[] }>()
    for (const [veh, pts] of byVeh) { const r = nnRoute(pts); out.set(veh, { km: r.km, order: r.order }) }
    return out
  }, [items, assignments, coordByDelivery])
  const totalRouteKm = useMemo(() => [...vehicleRoutes.values()].reduce((s, r) => s + r.km, 0), [vehicleRoutes])
  // #6 차량별 KPI — 건수/대수/매출가중/2층/이동거리
  const kpiRows = useMemo(() => {
    const m = new Map<string, { veh: string; region: string; cnt: number; units: number; rev: number; high: number; km: number }>()
    for (const it of items) {
      const a = assignments[it.deliveryNo]; if (!a) continue
      if (!m.has(a.vehicleNo)) m.set(a.vehicleNo, { veh: a.vehicleNo, region: regionOf(a.vehicleNo), cnt: 0, units: 0, rev: 0, high: 0, km: 0 })
      const row = m.get(a.vehicleNo)!
      row.cnt++; row.units += modelUnits(it.model); row.rev += modelWeight(it.model); row.high += it.isHigh ? 1 : 0
    }
    for (const [veh, r] of m) r.km = vehicleRoutes.get(veh)?.km ?? 0
    return [...m.values()].sort((a, b) => b.rev - a.rev)
  }, [items, assignments, vehicleRoutes, regionOf])
  // 선택 차량의 경로선 좌표열 (지도 폴리라인)
  const routePath = useMemo(() => (mapVehicle ? vehicleRoutes.get(mapVehicle)?.order.map(p => ({ lat: p.lat, lng: p.lng })) ?? [] : []), [mapVehicle, vehicleRoutes])
  // ── 배차 현황 대시보드 집계 (구역 필터와 무관하게 전체 기준) ──
  const dashboard = useMemo(() => {
    // 리모컨 배달은 물량 건수·대수에서 제외 (지도에는 표시되지만 집계 대상 아님)
    const cntItems = items.filter(i => isInstallCount(i.model))
    const total = cntItems.length                               // 건수(배송건, 리모컨 제외)
    const totalUnits = cntItems.reduce((s, it) => s + modelUnits(it.model), 0)  // 대수(홈멀티=2)
    const perVeh = new Map<string, number>()                    // 차량별 대수
    let assignedCnt = 0, assignedUnits = 0, autoCnt = 0, manualCnt = 0
    for (const it of cntItems) {
      const a = assignments[it.deliveryNo]
      if (a) {
        const u = modelUnits(it.model)
        assignedCnt++; assignedUnits += u
        perVeh.set(a.vehicleNo, (perVeh.get(a.vehicleNo) ?? 0) + u)
        if (a.source === 'auto') autoCnt++; else manualCnt++
      }
    }
    const counts = [...perVeh.values()]
    const usedVeh = perVeh.size
    const noAddr = cntItems.filter(i => !i.address || !i.address.trim())
    const idleDrivers = drivers.filter(d => !perVeh.has(d.vehicleNumber))
    const remoteCnt = items.length - cntItems.length            // 리모컨 배달 건수(참고 표시용)
    return {
      total, totalUnits, assignedCnt, assignedUnits,
      unassigned: total - assignedCnt, unassignedUnits: totalUnits - assignedUnits,
      autoCnt, manualCnt, remoteCnt,
      pct: totalUnits ? Math.round((assignedUnits / totalUnits) * 100) : 0,
      usedVeh, avg: usedVeh ? assignedUnits / usedVeh : 0,
      max: counts.length ? Math.max(...counts) : 0,
      min: counts.length ? Math.min(...counts) : 0,
      noAddr, idleDrivers,
    }
  }, [items, assignments, drivers])

  // 자동 균등배차 대상 = 이번 물량에 있는 차량번호(SAP vehicle)
  const batchVehicles = useMemo(() => [...new Set(items.map(i => i.vehicle).filter(Boolean))].sort(), [items])
  // 기사 목록 패널(드롭 타깃) = 이번 물량 차량 ∪ 등록 기사 (모든 배차 가능 차량이 보이도록)
  const panelVehicles = useMemo(() => {
    const seen = new Set<string>(); const out: { vehicleNumber: string; teamName: string }[] = []
    for (const v of batchVehicles) { if (v && !seen.has(v)) { seen.add(v); out.push({ vehicleNumber: v, teamName: drivers.find(d => d.vehicleNumber === v)?.teamName || '' }) } }
    for (const d of drivers) { if (d.vehicleNumber && !seen.has(d.vehicleNumber)) { seen.add(d.vehicleNumber); out.push({ vehicleNumber: d.vehicleNumber, teamName: d.teamName }) } }
    return out
  }, [batchVehicles, drivers])
  // 구역 배정된(=오늘 가동) 차량 수 — 대시보드용
  const assignedVehCount = useMemo(() => panelVehicles.filter(d => regionOf(d.vehicleNumber)).length, [panelVehicles, regionOf])
  // 지도 패널에 보일 차량 = 전체 or 선택 구역에 배정된 차량 (구역 탭 연동)
  const mapPanelVehicles = useMemo(() =>
    regionSel.length === 0 ? panelVehicles : panelVehicles.filter(d => regionSel.includes(regionOf(d.vehicleNumber) as RegionCode)),
    [panelVehicles, regionSel, regionOf])

  // 일괄 배차 저장 (낙관적 반영 + 서버 batch). source = 'auto' | 'manual'
  const assignMany = (pairs: { deliveryNo: string; vehicleNo: string }[], source: 'auto' | 'manual' = 'manual') => {
    if (pairs.length === 0) return
    const nameOf = (v: string) => drivers.find(d => d.vehicleNumber === v)?.teamName || ''
    setAssignments(a => {
      const next = { ...a }
      for (const p of pairs) {
        if (p.vehicleNo) next[p.deliveryNo] = { vehicleNo: p.vehicleNo, driverName: nameOf(p.vehicleNo), source }
        else delete next[p.deliveryNo]
      }
      return next
    })
    fetch('/api/safety/dispatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: pairs.map(p => ({ deliveryNo: p.deliveryNo, vehicleNo: p.vehicleNo, driverName: nameOf(p.vehicleNo), source })) }),
    }).catch(() => { /* noop */ })
  }

  // 자동 균등배차 — 구역에 배정된 차량만 사용(미배정=오늘 미사용, 제외).
  // 각 구역의 물량을 그 구역 배정 차량들에 매출(2순위)→난이도(3순위) 균등 분배. 캐파/저층전용/선호모델 반영.
  // 수동배차(드래그)한 건은 건드리지 않고 미배차 건만 자동으로 채움.
  const autoAssign = () => {
    if (locked) { alert('배차가 잠겨 있습니다. 상단 [잠금 해제] 후 실행하세요.'); return }
    // 구역에 배정된 차량 = 오늘 가동 (미배정은 제외)
    const working = panelVehicles.map(d => d.vehicleNumber).filter(v => regionOf(v))
    if (working.length === 0) { alert('구역에 배정된 차량이 없습니다. [구역 배정]에서 차량을 구역 박스로 끌어다 놓으세요.'); return }
    type Load = { rev: number; high: number; cnt: number; units: number; time: number }
    const load = new Map<string, Load>(working.map(v => [v, { rev: 0, high: 0, cnt: 0, units: 0, time: 0 }]))
    // 기존 배차(수동 포함)를 부하에 반영(그 위에서 보정)
    for (const it of items) {
      const a = assignments[it.deliveryNo]; const L = a && load.get(a.vehicleNo)
      if (L) { L.rev += modelWeight(it.model); L.high += it.isHigh ? 1 : 0; L.cnt++; L.units += modelUnits(it.model); L.time += modelTime(it.model) }
    }
    const cap = (v: string) => vehicleConfig[v]?.maxCount || 0            // 0 = 무제한 (가능 '대수')
    const hasCap = (v: string) => { const c = cap(v); return c <= 0 || load.get(v)!.units < c }   // 대수 기준
    const prefers = (v: string, model?: string) => (vehicleConfig[v]?.models || []).includes(baseModel(model))
    const lowOnly = (v: string) => !!vehicleConfig[v]?.lowOnly           // 저층 전용: 2층이상 배정 금지
    const modelsOnly = (v: string) => !!vehicleConfig[v]?.modelsOnly && (vehicleConfig[v]?.models?.length ?? 0) > 0  // 선호모델 전용
    const eligible = (v: string, it: KeyedItem) =>
      hasCap(v) && !(it.isHigh && lowOnly(v)) && !(modelsOnly(v) && !prefers(v, it.model))   // #4 모델 전용 하드 제약

    // 차량별 이미 배차된 좌표 (동선 거리 계산용) — 기존 배차 반영
    const vehPts = new Map<string, { lat: number; lng: number }[]>(working.map(v => [v, []]))
    for (const it of items) {
      const a = assignments[it.deliveryNo]; const c = coordByDelivery[it.deliveryNo]
      if (a && c && vehPts.has(a.vehicleNo)) vehPts.get(a.vehicleNo)!.push(c)
    }
    // 가중 비용: 동선(가까운 차 우선) + 매출(부하 균등) + 난이도(2층 균등). 낮을수록 좋음.
    const wR = autoW.route / 100, wV = autoW.rev / 100, wD = autoW.diff / 100
    const cost = (v: string, it: KeyedItem): number => {
      const L = load.get(v)!
      const c = coordByDelivery[it.deliveryNo]
      const pts = vehPts.get(v) || []
      let dTerm = 0
      if (c && pts.length) { let m = Infinity; for (const p of pts) { const d = haversineKm(c, p); if (d < m) m = d }; dTerm = Math.min(m, 30) / 6 }
      const revTerm = L.rev * 0.3          // 매출 부하 균등
      const diffTerm = L.high * 1.5        // 2층이상 균등
      const pref = prefers(v, it.model) ? 1.2 : 0
      return wR * dTerm + wV * revTerm + wD * diffTerm + 0.3 * L.time - pref
    }
    const pickIn = (cands: string[], it: KeyedItem): string | null => {
      let best: string | null = null, bestScore = Infinity
      for (const v of cands) { if (!eligible(v, it)) continue; const s = cost(v, it); if (s < bestScore) { bestScore = s; best = v } }
      return best
    }

    const pending = items.filter(it => it.deliveryNo && !assignments[it.deliveryNo] && it.address && it.address.trim())
    if (pending.length === 0) { alert('미배차 건이 없습니다.'); return }
    // 구역별 그룹
    const byRegion = new Map<string, KeyedItem[]>()
    for (const it of pending) { if (!byRegion.has(it.region)) byRegion.set(it.region, []); byRegion.get(it.region)!.push(it) }

    const pairs: { deliveryNo: string; vehicleNo: string }[] = []
    let overflow = 0
    const noVeh = new Set<string>()
    for (const [r, arr] of byRegion) {
      let cands = working.filter(v => regionOf(v) === r)                 // 그 구역에 배정된 차량만
      // 미분류(UNKNOWN)나 담당 차량이 없는 구역 → 전체 가동차량 대상으로 폴백(누락 방지)
      if (cands.length === 0) { noVeh.add(r); cands = working }
      if (cands.length === 0) { overflow += arr.length; continue }
      // 매출 높은 건부터 배정(고매출 우선 확보). 동선은 cost 의 거리항으로 반영.
      const sorted = arr.slice().sort((a, b) => modelWeight(b.model) - modelWeight(a.model))
      for (const it of sorted) {
        const v = pickIn(cands, it)
        if (!v) { overflow++; continue }
        const L = load.get(v)!; L.rev += modelWeight(it.model); L.high += it.isHigh ? 1 : 0; L.cnt++; L.units += modelUnits(it.model); L.time += modelTime(it.model)
        const c = coordByDelivery[it.deliveryNo]; if (c) vehPts.get(v)?.push(c)
        pairs.push({ deliveryNo: it.deliveryNo, vehicleNo: v })
      }
    }
    assignMany(pairs, 'auto')
    if (pairs.length) logHistory(`자동배차 ${pairs.length}건 (${autoW.route}·${autoW.rev}·${autoW.diff})`)
    const fbMsg = noVeh.size
      ? `\n※ ${[...noVeh].map(r => (r === 'UNKNOWN' ? '미분류' : r)).join(', ')} 구역은 담당 차량이 없어 전체 가동차량에 분산 배차했습니다.`
      : ''
    if (overflow > 0) {
      alert(`자동배차 완료. ${overflow}건은 미배차로 남았습니다. (가능대수/저층전용 설정을 확인하거나 수동 배차하세요)${fbMsg}`)
    } else if (fbMsg) {
      alert(`자동배차 완료.${fbMsg}`)
    }
  }

  // 현재 물량의 배차 전체 초기화 (자동/수동 모두)
  const clearAll = () => {
    const assigned = items.filter(it => assignments[it.deliveryNo])
    if (assigned.length === 0) return
    if (!confirm(`현재 물량의 배차 ${assigned.length}건을 모두 초기화할까요?`)) return
    assignMany(assigned.map(it => ({ deliveryNo: it.deliveryNo, vehicleNo: '' })))
    setMapVehicle('')
  }
  // 특정 차량의 배차만 초기화 → 지도 필터 해제해 풀려난 마커가 즉시 다시 보이게
  const clearVehicle = (vehicleNo: string) => {
    const its = items.filter(it => assignments[it.deliveryNo]?.vehicleNo === vehicleNo)
    if (its.length === 0) return
    if (!confirm(`${vehicleNo} 차량의 배차 ${its.length}건을 초기화할까요?`)) return
    assignMany(its.map(it => ({ deliveryNo: it.deliveryNo, vehicleNo: '' })))
    setMapVehicle('')   // '이 차량만 보기' 필터 해제 → 미배차로 돌아온 마커가 지도에 즉시 표시
  }
  // 자동배차분만 초기화 (수동배차는 유지)
  const clearAuto = () => {
    const autoItems = items.filter(it => assignments[it.deliveryNo]?.source === 'auto')
    if (autoItems.length === 0) { alert('자동배차된 건이 없습니다.'); return }
    if (!confirm(`자동배차 ${autoItems.length}건만 초기화할까요? (수동배차는 유지)`)) return
    assignMany(autoItems.map(it => ({ deliveryNo: it.deliveryNo, vehicleNo: '' })))
    setMapVehicle('')
  }
  // 납품번호(delivery) SAP 전송 — 배차일자 = 내일(일요일이면 월요일). 전체 일괄 / 차량별 개별 공용.
  const [sending, setSending] = useState('')   // '' = 대기, 'ALL' = 일괄, 그 외 = 그 차량번호 전송 중
  // 배차일자(내일, 일요일이면 월요일)
  const sendDate = () => {
    const d = new Date(); d.setDate(d.getDate() + 1)
    if (d.getDay() === 0) d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }
  // 배차된 건들을 SAP로 전송 (UI에 배정된 차량번호+납품번호를 그대로 자동 수집해 전송)
  const postSend = (list: KeyedItem[], token: string, label: string) => {
    if (list.length === 0) { alert(`${label} 배차된 건이 없습니다.`); return }
    const date = sendDate()
    if (!confirm(`${label} ${list.length}건(납품번호)을 SAP로 전송(전산 배차)할까요?\n배차일자: ${date}`)) return
    setSending(token)
    const payload = list.map(it => ({ deliveryNo: it.deliveryNo, vehicleNo: assignments[it.deliveryNo].vehicleNo }))
    fetch('/api/safety/dispatch-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, items: payload }) })
      .then(r => r.json()).then(d2 => { alert(d2?.message || (d2?.ok ? `전송 완료: ${d2.count}건` : `전송 실패: ${d2?.error ?? ''}`)) })
      .catch(() => alert('전송 실패'))
      .finally(() => setSending(''))
  }
  // 전체 일괄 전송 — 배정된 차량번호+납품번호 전부 자동 수집
  const sendToSap = () => postSend(items.filter(it => assignments[it.deliveryNo]), 'ALL', '전체 배차')
  // 차량별 개별 전송 — 그 차량에 배차된 건만
  const sendVehicleToSap = (vehicleNo: string) =>
    postSend(items.filter(it => assignments[it.deliveryNo]?.vehicleNo === vehicleNo), vehicleNo, `${vehicleNo} 차량`)
  // 긴급정지 — 진행 중인 SAP 전송(cscript) 즉시 종료
  const abortSend = () => {
    if (!confirm('SAP 전송을 긴급정지할까요?\n\n중단 시점까지 반영된 건이 있을 수 있어,\n정지 후 SAP 화면에서 실제 반영 상태를 확인해야 합니다.')) return
    fetch('/api/safety/dispatch-send', { method: 'DELETE' })
      .then(r => r.json()).then(d => alert(d?.message || (d?.ok ? '정지했습니다.' : '정지 실패')))
      .catch(() => alert('정지 요청 실패'))
  }
  const highMapRef = useRef<HTMLElement>(null)
  const lowMapRef = useRef<HTMLElement>(null)
  const allMapRef = useRef<HTMLElement>(null)
  // 리스트 행 클릭: 해당 위치로 지도 이동 + (2층이상)로드뷰 + 지도가 보이게 스크롤
  const focusOn = (key: string) => {
    setFocus(f => ({ key, n: (f?.n ?? 0) + 1 }))
    highMapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const focusLow = (key: string) => {
    setFocus(f => ({ key, n: (f?.n ?? 0) + 1 }))
    lowMapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // VADS 전체지도 리스트(배차표·비고)용 — 전체지도로 스크롤 + 전체 마커 ON(배차분도 보이게)
  const focusAll = (key: string) => {
    setFocus(f => ({ key, n: (f?.n ?? 0) + 1 }))
    setMapVehicle('')
    setShowAllMarkers(true)
    allMapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // 미배차 건 클릭 → 전체지도로 스크롤 + 미배차만 보이게(전체마커 OFF) + 첫 미배차 마커로 이동. 주소없으면 번호 안내.
  const showUnassigned = () => {
    const un = allForMap.filter(it => !assignments[it.deliveryNo])
    if (un.length === 0) return
    const withAddr = un.filter(it => it.address && it.address.trim())
    const noAddr = un.filter(it => !it.address || !it.address.trim())
    setShowAllMarkers(false); setMapVehicle('')
    if (withAddr.length > 0) {
      setFocus(f => ({ key: withAddr[0].key, n: (f?.n ?? 0) + 1 }))
      allMapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (noAddr.length > 0) alert(`미배차 ${un.length}건 중 주소없음 ${noAddr.length}건(지도 표시 불가): ${noAddr.map(i => i.deliveryNo).join(', ')}`)
    } else {
      alert(`미배차 ${un.length}건은 모두 주소없음(지도 표시 불가): ${noAddr.map(i => i.deliveryNo).join(', ')}`)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-gray-800">{label}</h2>
        <Badge label="2층이상" value={high.length} color="bg-red-100 text-red-700" />
        <Badge label="저층(1층)" value={low.length} color="bg-green-100 text-green-700" />
      </div>

      {/* 구역(ABCDE) 탭 — 다중선택 가능(A+E 등). 선택한 구역들만 2층·저층 지도/리스트에 표시 */}
      <div className="flex flex-wrap gap-1.5">
        <RegionTab active={regionSel.length === 0} onClick={() => setRegionSel([])} label="전체" count={items.length} />
        {REGION_ORDER.filter(r => r !== 'UNKNOWN' && (regionCounts[r] ?? 0) > 0).map(r => (
          <RegionTab key={r} active={regionSel.includes(r)} onClick={() => toggleRegion(r)}
            label={`${r} ${REGION_NAMES[r]}`} count={regionCounts[r] ?? 0} />
        ))}
        {/* 주소상 미분류(구역 판정 실패) — 별도 탭으로 노출해 누락 없이 배차 */}
        {(regionCounts['UNKNOWN'] ?? 0) > 0 && (
          <RegionTab active={regionSel.includes('UNKNOWN' as RegionCode)} onClick={() => toggleRegion('UNKNOWN' as RegionCode)}
            label="미분류" count={regionCounts['UNKNOWN'] ?? 0} />
        )}
      </div>

      {/* 배차 현황 대시보드 — VADS 전용 */}
      {withDispatch && (
      <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-slate-800 text-lg">배차 현황 대시보드</h3>
          {totalRouteKm > 0 && <span className="text-xs text-slate-500">총 이동 {totalRouteKm.toFixed(0)}km · 차량평균 {dashboard.usedVeh ? (totalRouteKm / dashboard.usedVeh).toFixed(1) : 0}km</span>}
          <span className="ml-auto flex gap-2 flex-wrap items-center">
            <button onClick={() => setShowKpi(v => !v)}
              className={`px-3 py-2 rounded-xl text-sm border transition-colors ${showKpi ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>KPI</button>
            <button onClick={() => setLocked(v => !v)}
              title={locked ? '배차 잠금 해제' : '배차 잠금(드래그·자동·초기화 차단)'}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${locked ? 'bg-rose-600 text-white border-rose-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {locked ? '🔒 잠금됨' : '잠금'}</button>
            <button onClick={autoAssign} disabled={locked}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-semibold shadow-sm shadow-indigo-200 hover:opacity-95 transition-opacity disabled:opacity-40">자동 균등배차</button>
            <button onClick={sendToSap} disabled={!!sending}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 disabled:opacity-50">{sending === 'ALL' ? '전송 중…' : '납품번호 일괄 SAP 전송'}</button>
            {/* 전송 중에만 노출 — SAP로 쓰는 중이라 즉시 멈출 수단이 필요 */}
            {!!sending && (
              <button onClick={abortSend}
                title="진행 중인 SAP 전송을 즉시 중단합니다"
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold shadow-sm hover:bg-red-700 animate-pulse">
                긴급정지
              </button>
            )}
            <button onClick={clearAuto} disabled={locked}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-500 text-sm hover:bg-slate-50 transition-colors disabled:opacity-40">자동분 초기화</button>
            <button onClick={clearAll} disabled={locked}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-500 text-sm hover:bg-slate-50 transition-colors disabled:opacity-40">전체 초기화</button>
          </span>
        </div>

        {/* #1 자동배차 가중치 — 담당자 성향별 프리셋 + 미세조정 */}
        <div className="flex items-center gap-2 flex-wrap text-xs bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
          <span className="font-semibold text-slate-600">자동배차 기준</span>
          {Object.keys(AUTO_PRESETS).map(name => {
            const p = AUTO_PRESETS[name]
            const on = autoW.route === p.route && autoW.rev === p.rev && autoW.diff === p.diff
            return (
              <button key={name} onClick={() => setAutoW(p)}
                className={`px-2.5 py-1 rounded-full border ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{name}</button>
            )
          })}
          <span className="ml-2 flex items-center gap-3 text-slate-500">
            {([['동선', 'route'], ['매출', 'rev'], ['난이도', 'diff']] as const).map(([label, k]) => (
              <label key={k} className="flex items-center gap-1">
                {label}
                <input type="range" min={0} max={100} value={autoW[k]}
                  onChange={e => setAutoW(w => ({ ...w, [k]: parseInt(e.target.value) }))}
                  className="w-20 accent-indigo-600" />
                <span className="w-6 text-right tabular-nums">{autoW[k]}</span>
              </label>
            ))}
          </span>
        </div>

        {/* 구역 배정 패널 (항상 표시) — 차량을 A~E 구역 박스로 드래그드랍 (미배정=오늘 미사용) */}
        <RegionAssignPanel vehicles={panelVehicles} config={vehicleConfig}
          regionUnits={regionUnits} onSetRegion={setVehicleRegion} />

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="전체 물량" value={`${dashboard.totalUnits}대`} sub={`${dashboard.total}건`} tone="blue" />
          <Stat label="배차완료" value={`${dashboard.assignedUnits}대`} sub={`${dashboard.pct}% · ${dashboard.assignedCnt}건 · 자동 ${dashboard.autoCnt}·수동 ${dashboard.manualCnt}`} tone="teal" />
          <Stat label="미배차" value={`${dashboard.unassignedUnits}대`} sub={`${dashboard.unassigned}건`} tone={dashboard.unassigned > 0 ? 'amber' : 'gray'} />
          <Stat label="배정 차량" value={`${dashboard.usedVeh}/${assignedVehCount}대`} sub="구역 배정된 차량" tone="blue" />
          <Stat label="차량당 평균" value={dashboard.avg ? `${dashboard.avg.toFixed(1)}대` : '0'} sub={`최대${dashboard.max}·최소${dashboard.min}대`} tone="gray" />
          <Stat label="주소없음(누락위험)" value={`${dashboard.noAddr.length}건`} tone={dashboard.noAddr.length > 0 ? 'red' : 'gray'} />
        </div>
        {/* 진행률 바 */}
        <div className="h-2.5 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full bg-teal-500 transition-all" style={{ width: `${dashboard.pct}%` }} />
        </div>
        {/* 경고/안내 */}
        <div className="flex flex-wrap gap-2 text-xs">
          {dashboard.unassigned > 0 && (
            <button onClick={showUnassigned}
              title="클릭 → 지도에서 미배차 위치 표시"
              className="px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 cursor-pointer">
              미배차 {dashboard.unassigned}건 — 클릭하면 지도에서 위치 표시
            </button>
          )}
          {dashboard.noAddr.length > 0 && (
            <span className="px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200"
              title={dashboard.noAddr.map(i => i.deliveryNo).join(', ')}>
              주소없음(지도 표시 불가) {dashboard.noAddr.length}건: {dashboard.noAddr.slice(0, 8).map(i => i.deliveryNo).join(', ')}{dashboard.noAddr.length > 8 ? ' …' : ''}
            </span>
          )}
          {dashboard.usedVeh > 0 && dashboard.max - dashboard.min >= 5 && (
            <span className="px-2 py-1 rounded bg-orange-50 text-orange-700 border border-orange-200">
              차량 간 물량 편차 큼(최대 {dashboard.max} · 최소 {dashboard.min}) — 균등 배분 권장
            </span>
          )}
          {dashboard.idleDrivers.length > 0 && (
            <span className="px-2 py-1 rounded bg-gray-50 text-gray-600 border border-gray-200">
              미투입 기사 {dashboard.idleDrivers.length}명: {dashboard.idleDrivers.slice(0, 6).map(d => d.vehicleNumber).join(', ')}{dashboard.idleDrivers.length > 6 ? ' …' : ''}
            </span>
          )}
          {dashboard.total > 0 && dashboard.unassigned === 0 && (
            <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">전량 배차 완료</span>
          )}
          {dashboard.remoteCnt > 0 && (
            <span className="px-2 py-1 rounded bg-slate-50 text-slate-500 border border-slate-200">리모컨 배달 {dashboard.remoteCnt}건 (건수·대수 제외, 지도 표시)</span>
          )}
        </div>

        {/* #6 KPI 리포트 + #5 변경 이력 */}
        {showKpi && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 pt-1">
            <div className="xl:col-span-2 border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">차량별 KPI</div>
              <div className="max-h-72 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-white sticky top-0 text-slate-400">
                    <tr>
                      <th className="px-2 py-1 text-left">차량</th><th className="px-2 py-1 text-left">구역</th>
                      <th className="px-2 py-1 text-right">건수</th><th className="px-2 py-1 text-right">대수</th>
                      <th className="px-2 py-1 text-right">매출가중</th><th className="px-2 py-1 text-right">2층</th>
                      <th className="px-2 py-1 text-right">이동km</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpiRows.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">배차된 차량이 없습니다.</td></tr>}
                    {kpiRows.map(k => (
                      <tr key={k.veh} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-mono font-semibold">{k.veh}</td>
                        <td className="px-2 py-1">{k.region || '-'}</td>
                        <td className="px-2 py-1 text-right">{k.cnt}</td>
                        <td className="px-2 py-1 text-right">{k.units}</td>
                        <td className="px-2 py-1 text-right">{k.rev.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{k.high || ''}</td>
                        <td className="px-2 py-1 text-right">{k.km > 0 ? k.km.toFixed(1) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">변경 이력 (세션)</div>
              <div className="max-h-72 overflow-auto p-2 space-y-1">
                {history.length === 0 && <p className="text-xs text-slate-400 px-1">변경 내역이 없습니다.</p>}
                {history.map((h, i) => (
                  <div key={i} className="text-[11px] text-slate-600"><span className="text-slate-400 tabular-nums mr-1.5">{h.t}</span>{h.msg}</div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
      )}

      {/* 전체 지도 + 배차 — VADS 전용 (안전관리 탭에서는 숨김) */}
      {withDispatch && (
      <section ref={allMapRef} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 flex-wrap">
          <span className="w-3 h-3 rounded-full bg-red-500" /><span className="w-3 h-3 rounded-full bg-green-500 -ml-1" />
          전체 지도 + 배차 · {allForMap.length}건 (배차 {assignedCount})
          <span className="text-sm font-normal text-gray-400">구역 탭 다중선택 가능 (A+E 등) — 선택한 구역들이 지도에 함께 표시</span>
        </h3>
        {/* 구역 탭 — 다중선택(토글). 선택 구역들의 마커 + 그 구역들에 배정된 차량만 표시 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <RegionTab active={regionSel.length === 0} onClick={() => setRegionSel([])} label="전체" count={items.length} />
          {REGION_ORDER.filter(r => r !== 'UNKNOWN' && (regionCounts[r] ?? 0) > 0).map(r => (
            <RegionTab key={r} active={regionSel.includes(r)} onClick={() => toggleRegion(r)} label={`${r} ${REGION_NAMES[r]}`} count={regionCounts[r] ?? 0} />
          ))}
          {(regionCounts['UNKNOWN'] ?? 0) > 0 && (
            <RegionTab active={regionSel.includes('UNKNOWN' as RegionCode)} onClick={() => toggleRegion('UNKNOWN' as RegionCode)} label="미분류" count={regionCounts['UNKNOWN'] ?? 0} />
          )}
          {regionSel.length > 0 && (
            <span className="ml-1 text-xs text-indigo-600 font-medium">
              {regionSel.join('+')} 선택 · {allForMap.length}건
            </span>
          )}
        </div>
        {/* 모델 탭 — 다중선택(토글). 홈멀티/스탠드 등 그 모델만 지도에 표시 (구역 필터와 함께 적용) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400 mr-0.5 self-center">모델</span>
          <ModelTab active={modelSel.length === 0} onClick={() => setModelSel([])} label="전체" count={Object.values(modelCountsAll).reduce((s, n) => s + n, 0)} />
          {MODEL_ORDER.filter(m => (modelCountsAll[m] ?? 0) > 0).map(m => (
            <ModelTab key={m} active={modelSel.includes(m)} onClick={() => toggleModel(m)} label={m} count={modelCountsAll[m] ?? 0} color={modelColor(m)} />
          ))}
          {(modelCountsAll[REMOTE] ?? 0) > 0 && (
            <ModelTab active={modelSel.includes(REMOTE)} onClick={() => toggleModel(REMOTE)} label={`${REMOTE}(제외)`} count={modelCountsAll[REMOTE] ?? 0} color={modelColor(REMOTE)} />
          )}
          {modelSel.length > 0 && (
            <span className="ml-1 text-xs text-emerald-600 font-medium">{modelSel.join('+')} 선택 · {allForMap.length}건</span>
          )}
        </div>
        {/* 지도(왼쪽) + 기사 목록(오른쪽 사이드 컬럼) */}
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 min-w-0 relative">
            <SafetyMap items={allMapItems} focus={focus} roadview={false} indoorKeys={indoorKeySet} onGeocoded={onGeocoded}
              assignments={assignVehMap} drivers={drivers} onAssign={assign} visibleVehicle={mapVehicle} height={820}
              dragAssign showAssigned={showAllMarkers} routePath={routePath} weather={weather} />
            {/* 지도 우측 상단 오버레이 버튼 */}
            <div className="absolute top-3 right-3 z-10 flex gap-1.5">
              <button onClick={() => setShowAllMarkers(v => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md border transition-colors ${showAllMarkers
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-white'}`}>
                {showAllMarkers ? '전체 마커 ON (차량번호)' : '전체 마커 보기'}
              </button>
              {mapVehicle && (
                <button onClick={() => setMapVehicle('')}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md border bg-white/95 text-slate-700 border-slate-200 hover:bg-white">
                  {mapVehicle} 해제
                </button>
              )}
            </div>
          </div>
          <div className="w-full lg:w-80 xl:w-96 shrink-0 border border-slate-200 rounded-xl p-2 overflow-auto" style={{ maxHeight: 820 }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-gray-700 text-sm">
                {regionSel.length === 0 ? '기사 목록' : `${regionSel.join('+')} 구역 차량`} ({mapPanelVehicles.length}) · 끌어서 배차
              </span>
              <button onClick={() => setMapVehicle('')}
                className={`ml-auto px-2 py-1 rounded text-xs font-medium border ${mapVehicle === ''
                  ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                전체 보기
              </button>
            </div>
            {mapPanelVehicles.length === 0 && (
              <p className="text-xs text-gray-400">{regionSel.length === 0 ? '차량 정보를 불러오는 중… (없으면 기사 관리에서 차량번호 등록)' : `${regionSel.join('+')} 구역에 배정된 차량이 없습니다. [구역 배정]에서 배정하세요.`}</p>
            )}
            <div className="space-y-1.5">
              {mapPanelVehicles.map(d => {
                const gItems = assignedByVehicle.get(d.vehicleNumber) ?? []
                const gUnits = gItems.reduce((s, i) => s + modelUnits(i.model), 0)   // 대수(홈멀티=2)
                const mc = modelCounts(gItems)
                const nHigh = gItems.filter(i => i.isHigh).length
                const nAuto = gItems.filter(i => assignments[i.deliveryNo]?.source === 'auto').length
                const nManual = gItems.length - nAuto
                const cfg = vehicleConfig[d.vehicleNumber]
                const cap = cfg?.maxCount || 0
                const over = cap > 0 && gUnits > cap
                const sel = mapVehicle === d.vehicleNumber
                return (
                  <div key={d.vehicleNumber}
                    data-drop-vehicle={d.vehicleNumber}
                    onClick={() => setMapVehicle(sel ? '' : d.vehicleNumber)}
                    title="마커를 여기로 끌면 이 차량에 배차 · 클릭 → 지도에 이 차량만 보기"
                    className={`border rounded p-2 cursor-pointer transition-colors ${sel
                      ? 'bg-blue-100 border-blue-400 ring-1 ring-blue-400'
                      : gItems.length ? 'bg-teal-50 border-teal-200 hover:bg-teal-100' : 'bg-gray-50 hover:bg-blue-50'}`}>
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-bold text-gray-800">{d.vehicleNumber}</span>
                      <span className="text-xs text-gray-500">{d.teamName}</span>
                      {regionOf(d.vehicleNumber) && <span className="text-[10px] px-1.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">{regionOf(d.vehicleNumber)}</span>}
                      {gItems.length > 0 && (
                        <span className={`ml-auto text-xs font-semibold ${over ? 'text-red-600' : 'text-teal-700'}`}
                          title={`${gItems.length}건 · ${gUnits}대`}>
                          {gUnits}{cap > 0 ? `/${cap}` : ''}대
                        </span>
                      )}
                    </div>
                    {(cfg?.lowOnly || (cfg?.models?.length ?? 0) > 0 || cap > 0) && (
                      <div className="text-[11px] text-indigo-600 mt-0.5">
                        {cfg?.lowOnly && <span className="text-green-700 font-medium">저층전용 </span>}
                        {(cfg?.models?.length ?? 0) > 0 && `선호: ${cfg!.models.join('·')} `}
                        {cap > 0 && `· 캐파 ${cap}`}
                      </div>
                    )}
                    {gItems.length > 0 && (
                      <>
                        <div className="text-xs text-gray-600 mt-1">
                          {summaryKeys(mc).map(m => `${m} ${mc[m]}`).join(' · ') || '-'}
                          {nHigh > 0 && <span className="text-red-600"> · 2층이상 {nHigh}</span>}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          {nAuto > 0 && <span className="text-indigo-600">자동 {nAuto}</span>}
                          {nAuto > 0 && nManual > 0 && ' · '}
                          {nManual > 0 && <span className="text-gray-700">수동 {nManual}</span>}
                          {(() => { const rt = vehicleRoutes.get(d.vehicleNumber); return rt && rt.km > 0 ? <span className="text-slate-500"> · 이동 {rt.km.toFixed(1)}km</span> : null })()}
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full ${over ? 'bg-rose-500' : 'bg-gradient-to-r from-indigo-500 to-violet-500'}`}
                            style={{ width: `${dashboard.max ? Math.min(100, Math.round(gUnits / dashboard.max * 100)) : 0}%` }} />
                        </div>
                        <div className="mt-1 flex gap-1">
                          <button onClick={e => { e.stopPropagation(); sendVehicleToSap(d.vehicleNumber) }}
                            disabled={!!sending}
                            title="이 차량의 배차분만 SAP로 전송(전산 배차)"
                            className="flex-1 px-2 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">
                            {sending === d.vehicleNumber ? '전송 중…' : 'SAP 전송'}
                          </button>
                          <button onClick={e => { e.stopPropagation(); copyText(gItems.map(i => i.deliveryNo).join('\n')) }}
                            className="px-2 py-1 rounded bg-teal-600 text-white text-xs font-medium hover:bg-teal-700">
                            복사
                          </button>
                          <button onClick={e => { e.stopPropagation(); clearVehicle(d.vehicleNumber) }}
                            title="이 차량 배차 초기화"
                            className="px-2 py-1 rounded border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50">
                            초기화
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 배차 테이블 — 구역·층·모델 참고하며 차량 배정 */}
        {mapVehicle && (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-blue-600 text-white font-semibold">{mapVehicle} 차량만 · {dispatchList.length}건</span>
            <button onClick={() => setMapVehicle('')} className="px-2 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50">전체 보기</button>
          </div>
        )}
        <div className="max-h-[26rem] overflow-auto border rounded">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-12" /><col className="w-14" /><col className="w-44" /><col className="w-28" />
              <col className="w-16" /><col /><col className="w-40" /><col className="w-52" />
            </colgroup>
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-left">구역</th><th className="px-2 py-1.5 text-center">층</th>
                <th className="px-2 py-1.5 text-left">대표모델</th><th className="px-2 py-1.5 text-left">납품번호</th>
                <th className="px-2 py-1.5 text-center">납기</th><th className="px-2 py-1.5 text-left">주소</th>
                <th className="px-2 py-1.5 text-left">비고</th><th className="px-2 py-1.5 text-left">차량배차</th>
              </tr>
            </thead>
            <tbody>
              {dispatchList.map(it => {
                const a = assignments[it.deliveryNo]
                return (
                  <tr key={it.key} onClick={() => focusAll(it.key)}
                    className={`border-t cursor-pointer align-top ${focus?.key === it.key ? 'bg-amber-100 ring-2 ring-inset ring-amber-400' : a ? 'bg-teal-50 hover:bg-teal-100' : 'hover:bg-gray-50'}`}>
                    <td className="px-2 py-1.5">{it.region}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${it.isHigh ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{it.isHigh ? `${it.floor ?? ''}층` : '저층'}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="font-medium">{it.model || '-'}</span>
                      {it.modelName && <span className="block text-[11px] font-mono text-blue-700 font-semibold break-all leading-tight">{it.modelName}</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{it.deliveryNo || '-'}</td>
                    <td className="px-2 py-1.5 text-center">{it.promiseTime || '-'}</td>
                    <td className="px-2 py-1.5 break-words">{it.address || '-'}</td>
                    <td className="px-2 py-1.5 text-amber-700 whitespace-pre-wrap break-words">{it.remark || ''}</td>
                    <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <select value={a?.vehicleNo || ''} onChange={e => assign(it.deliveryNo, e.target.value)}
                          className={`flex-1 min-w-0 border rounded px-1.5 py-1 text-xs ${a ? 'border-teal-400 bg-teal-50 font-semibold' : 'border-gray-300'}`}>
                          <option value="">미배차</option>
                          {panelVehicles.map(d => <option key={d.vehicleNumber} value={d.vehicleNumber}>{d.vehicleNumber}{d.teamName ? ` (${d.teamName})` : ''}{regionOf(d.vehicleNumber) ? ` · ${regionOf(d.vehicleNumber)}` : ''}</option>)}
                        </select>
                        {a && (
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ${a.source === 'auto'
                            ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-700'}`}>
                            {a.source === 'auto' ? '자동' : '수동'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">배차는 즉시 23.20.121.23에 저장·공유됩니다. 완료 후 차량별 <b>납품번호 복사</b>로 SAP에서 수동 배차하세요.</p>
      </section>
      )}

      {/* 2층이상 */}
      <section ref={highMapRef} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
        <h3 className="font-semibold text-red-700 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500" />2층이상 지도 (마커 클릭 → 로드뷰)
        </h3>
        <SafetyMap items={highMapItems} focus={focus} roadview onGeocoded={onGeocoded} indoorKeys={indoorKeySet} weather={weather} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="font-semibold text-gray-800">2층이상 (안전벨트 점검) {highFiltered.length}건</span>
          <button onClick={() => setFlagOnly(v => ({ ...v, indoor: !v.indoor }))}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${flagOnly.indoor
              ? 'bg-sky-600 text-white border-sky-600'
              : 'bg-white text-sky-700 border-sky-300 hover:bg-sky-50'}`}
            title="비 오는 날 배차 대상: 실내 실외기실만 보기 (같은 주소는 카카오맵 기준으로 누적)">
            실내실외기실만 ({flagCounts.indoor}{flagCounts.indoorApt > 0 ? ` · 아파트 ${flagCounts.indoorApt}` : ''})
          </button>
          <button onClick={() => setFlagOnly(v => ({ ...v, twopoint: !v.twopoint }))}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${flagOnly.twopoint
              ? 'bg-violet-600 text-white border-violet-600'
              : 'bg-white text-violet-700 border-violet-300 hover:bg-violet-50'}`}
            title="2점고정 대상만 보기 (같은 주소는 카카오맵 기준으로 누적)">
            2점고정만 ({flagCounts.twopoint})
          </button>
          <label className="ml-auto text-sm text-gray-600">차량번호</label>
          <select value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">전체 ({high.length})</option>
            {vehicles.map(v => <option key={v} value={v}>{v} ({high.filter(h => h.vehicle === v).length})</option>)}
          </select>
          <button onClick={() => printHigh(highFiltered, vehicleFilter, label, flagDeliverySets)}
            className="px-4 py-1.5 rounded bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700">PDF 다운로드</button>
        </div>
        <p className="text-xs text-gray-400">실내실외기실 · 2점고정 체크는 <b>즉시 23.20.121.23에 자동 저장</b>되고(저장 버튼 불필요), 같은 주소(카카오맵 기준)가 다시 올라오면 <b>자동 체크</b>됩니다.</p>
        <div className="max-h-[26rem] overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-center whitespace-nowrap" title="로드뷰로 실외기가 실내(실외기실)인지 확인 후 체크">실내<br />실외기실</th>
                <th className="px-2 py-1.5 text-center whitespace-nowrap" title="2점고정 대상이면 체크">2점<br />고정</th>
                <th className="px-3 py-1.5 text-left">차량번호</th><th className="px-3 py-1.5 text-left">납품번호</th>
                <th className="px-3 py-1.5 text-left">대표모델</th><th className="px-3 py-1.5 text-left">납기시간</th>
                <th className="px-3 py-1.5 text-left">주소</th><th className="px-3 py-1.5 text-center">층</th>
              </tr>
            </thead>
            <tbody>
              {highFiltered.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400">없음</td></tr>}
              {highFiltered.map(it => {
                const indoor = isFlagged('indoor', it.deliveryNo)
                const twopoint = isFlagged('twopoint', it.deliveryNo)
                const hasKey = !!addrKeyByDelivery[it.deliveryNo]
                return (
                <tr key={it.key} onClick={() => focusOn(it.key)}
                  className={`border-t cursor-pointer ${focus?.key === it.key ? 'bg-amber-100 ring-2 ring-inset ring-amber-400' : indoor ? 'bg-sky-50 hover:bg-sky-100' : twopoint ? 'bg-violet-50 hover:bg-violet-100' : 'hover:bg-red-50'}`}>
                  <td className="px-2 py-1.5 text-center" onClick={e => { e.stopPropagation(); toggleFlag('indoor', it.deliveryNo, it.address) }}>
                    <input type="checkbox" checked={indoor} readOnly disabled={!hasKey}
                      className="w-4 h-4 accent-sky-600 cursor-pointer disabled:opacity-40"
                      title={hasKey ? '실내 실외기실 해당 (같은 주소는 누적)' : '지도 로딩 중… 잠시 후 체크'} />
                  </td>
                  <td className="px-2 py-1.5 text-center" onClick={e => { e.stopPropagation(); toggleFlag('twopoint', it.deliveryNo, it.address) }}>
                    <input type="checkbox" checked={twopoint} readOnly disabled={!hasKey}
                      className="w-4 h-4 accent-violet-600 cursor-pointer disabled:opacity-40"
                      title={hasKey ? '2점고정 해당 (같은 주소는 누적)' : '지도 로딩 중… 잠시 후 체크'} />
                  </td>
                  <td className="px-3 py-1.5 font-mono">{it.vehicle || '-'}</td>
                  <td className="px-3 py-1.5 font-mono">{it.deliveryNo || '-'}</td>
                  <td className="px-3 py-1.5">{it.model || '-'}</td>
                  <td className="px-3 py-1.5">{it.promiseTime || '-'}</td>
                  <td className="px-3 py-1.5">{it.address || '-'}</td>
                  <td className="px-3 py-1.5 text-center">{it.floor ?? '-'}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 저층 */}
      <section ref={lowMapRef} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
        <h3 className="font-semibold text-green-700 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-500" />저층 지도
        </h3>
        <SafetyMap items={lowMapItems} focus={focus} roadview onGeocoded={onGeocoded} indoorKeys={indoorKeySet} weather={weather} />
        <SimpleList title="저층 (1층)" items={lowFiltered} onRow={focusLow} />
      </section>
    </div>
  )
}

function esc(s: string) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function printHigh(rows: KeyedItem[], vehicle: string, label: string, flagSets: { indoor: Set<string>; twopoint: Set<string> }) {
  if (rows.length === 0) { alert('출력할 2층이상 건이 없습니다.'); return }
  const today = new Date().toLocaleDateString('ko-KR')
  const body = rows.map((r, i) =>
    `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td style="text-align:center">${flagSets.indoor.has(r.deliveryNo) ? '●' : ''}</td>
      <td style="text-align:center">${flagSets.twopoint.has(r.deliveryNo) ? '●' : ''}</td>
      <td>${esc(r.vehicle)}</td><td>${esc(r.deliveryNo)}</td><td>${esc(r.model)}</td>
      <td style="text-align:center">${esc(r.promiseTime)}</td><td>${esc(r.address)}</td>
      <td style="text-align:center">${r.floor ?? ''}</td>
      <td style="text-align:center;width:36px"></td>
    </tr>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>2층이상 안전벨트 점검 ${esc(label)}</title>
    <style>
      @page{size:A4 landscape;margin:12mm}
      body{font-family:'Malgun Gothic',sans-serif;padding:0;color:#111}
      h1{font-size:16px;margin:0 0 4px}
      .meta{font-size:12px;color:#555;margin-bottom:8px}
      table{border-collapse:collapse;width:100%;font-size:12px}
      th,td{border:1px solid #666;padding:4px 6px;text-align:left}
      th{background:#eef2f7}
      tbody tr:nth-child(even){background:#fafafa}
    </style></head><body>
    <h1>2층이상 안전벨트 점검표${vehicle ? ' · 차량 ' + esc(vehicle) : ''}</h1>
    <div class="meta">출력일 ${today} · 총 ${rows.length}건 · ● = 해당(실내 실외기실 / 2점고정)</div>
    <table><thead><tr>
      <th style="width:32px">No</th><th style="width:56px">실내<br>실외기실</th><th style="width:44px">2점<br>고정</th>
      <th>차량번호</th><th>납품번호</th><th>대표모델</th><th style="width:70px">납기시간</th>
      <th>주소</th><th style="width:40px">층</th><th style="width:40px">점검</th>
    </tr></thead><tbody>${body}</tbody></table>
    </body></html>`

  // 팝업 차단에 막히지 않도록 숨김 iframe 로 인쇄 (인쇄 대화상자에서 "PDF로 저장" 선택)
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) { iframe.remove(); return }
  doc.open(); doc.write(html); doc.close()
  let printed = false
  const run = () => {
    if (printed) return; printed = true
    setTimeout(() => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print() } catch { /* noop */ }
      setTimeout(() => iframe.remove(), 1500)
    }, 250)
  }
  iframe.onload = run
  setTimeout(run, 700)   // onload 미발화 대비 폴백
}

function PasteCard({ title, text, setText, preview, loading, onFetch, onClear }: {
  title: string; text: string; setText: (s: string) => void; preview: number; loading: boolean; onFetch: () => void; onClear: () => void
}) {
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
      <label className="flex items-center gap-2 font-semibold text-slate-800 mb-2">
        <span className="w-1 h-5 rounded-full bg-indigo-500" />{title} 붙여넣기
      </label>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder={`${title} 리스트를 붙여넣으세요`}
        className="w-full h-36 border border-slate-200 rounded-xl p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition" />
      <div className="flex items-center justify-between mt-3">
        <span className="text-sm text-slate-500">인식: <b className="text-slate-800">{preview}</b>건</span>
        <div className="flex gap-2">
          <button onClick={onClear} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">지우기</button>
          <button onClick={onFetch} disabled={loading || preview === 0}
            className="px-6 py-2 rounded-xl text-white font-semibold disabled:opacity-50 bg-gradient-to-r from-indigo-600 to-violet-600 shadow-sm shadow-indigo-200 hover:opacity-95 transition-opacity">
            {loading ? 'SAP 조회 중…' : '끌고오기'}</button>
        </div>
      </div>
    </section>
  )
}

function SimpleList({ title, items, onRow }: { title: string; items: KeyedItem[]; onRow: (key: string) => void }) {
  return (
    <div>
      <div className="px-1 py-1 font-semibold text-green-800 flex items-center gap-2">
        {title}<span className="ml-auto text-sm font-normal">{items.length}건</span>
      </div>
      <div className="max-h-96 overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 sticky top-0">
            <tr>
              <th className="px-3 py-1.5 text-left">차량번호</th><th className="px-3 py-1.5 text-left">납품번호</th>
              <th className="px-3 py-1.5 text-left">대표모델</th><th className="px-3 py-1.5 text-left">주소</th><th className="px-3 py-1.5 text-center">층</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">없음</td></tr>}
            {items.map(it => (
              <tr key={it.key} onClick={() => onRow(it.key)} className="border-t hover:bg-green-50 cursor-pointer">
                <td className="px-3 py-1.5 font-mono">{it.vehicle || '-'}</td>
                <td className="px-3 py-1.5 font-mono">{it.deliveryNo || '-'}</td>
                <td className="px-3 py-1.5">{it.model || '-'}</td>
                <td className="px-3 py-1.5">{it.address || '-'}</td>
                <td className="px-3 py-1.5 text-center">{it.floor ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Badge({ label, value, color }: { label: string; value: number; color: string }) {
  return <span className={`px-3 py-1 rounded-full font-medium ${color}`}>{label} {value}</span>
}

// 대시보드 통계 카드 — 둥근 카드 + 작은 컬러 도트 + 큰 숫자 (이모지 없음)
const STAT_DOT: Record<string, string> = {
  gray: 'bg-slate-300',
  teal: 'bg-emerald-500',
  amber: 'bg-amber-500',
  blue: 'bg-indigo-500',
  red: 'bg-rose-500',
}
function Stat({ label, value, sub, tone = 'gray' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-1.5 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${STAT_DOT[tone] ?? STAT_DOT.gray}`} />
        <span className="text-[13px] font-medium text-slate-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-800 leading-none tracking-tight">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

// 배차 요약용 대표모델 대수 집계
const MODEL_ORDER = ['시스템에어컨', '업소용', '홈멀티', '스탠드', '벽걸이', '이전설치', '단품']
// 주문사유 ZL4 = 사전방문. "벽걸이 사전방문" 처럼 대표모델 뒤에 붙어 오며, 실제 설치가 아니라
// 방문만 하는 건이라 대수(0)에서 제외한다. 이동은 하므로 시간/매출은 소량만 잡는다.
const PREVISIT = '사전방문'
function isPrevisit(model?: string) { return (model || '').includes(PREVISIT) }
function baseModel(model?: string) { return (model || '').replace(PREVISIT, '').trim() }
// 리모컨 배달(ARR) — 실제 설치가 아니라 리모컨만 배달. 건수·대수에서 제외하되 지도엔 표시.
const REMOTE = '리모컨'
function isRemote(model?: string) { return (model || '').trim() === REMOTE }
// 매출 가중치: 시스템에어컨 > 업소용 > 홈멀티 > 스탠드 > 벽걸이 > 단품 > 이전설치 (자동 균등배차 1순위 = 매출)
const MODEL_WEIGHT: Record<string, number> = { 시스템에어컨: 6, 업소용: 5, 홈멀티: 4, 스탠드: 3, 벽걸이: 2, 단품: 1, 이전설치: 0.5 }
function modelWeight(model?: string) {
  if (isRemote(model)) return 0                           // 리모컨 배달 — 매출 없음
  if (isPrevisit(model)) return 0.3                       // 사전방문은 설치 매출 없음
  return MODEL_WEIGHT[(model || '').trim()] ?? 1
}
// 설치 대수: 리모컨·사전방문=0대(설치 아님), 홈멀티=2대, 그 외=1대
const MODEL_UNITS: Record<string, number> = { 시스템에어컨: 1, 업소용: 1, 홈멀티: 2, 스탠드: 1, 벽걸이: 1, 단품: 1, 이전설치: 1 }
function modelUnits(model?: string) {
  if (isRemote(model) || isPrevisit(model)) return 0      // ★ 리모컨·사전방문은 설치 대수 미포함
  return MODEL_UNITS[(model || '').trim()] ?? 1
}
// 건수 집계 대상 여부 — 리모컨 배달은 물량 건수에서도 제외(지도에는 표시)
function isInstallCount(model?: string) { return !isRemote(model) }
// 설치 소요시간(부하) — 자동배차 균등 기준. 시스템에어컨이 가장 오래 걸림(사실상 하루 1대) → 그 차량엔 다른 물량 적게 배정.
const MODEL_TIME: Record<string, number> = { 시스템에어컨: 4, 업소용: 2, 홈멀티: 2, 스탠드: 1, 벽걸이: 1, 단품: 1, 이전설치: 1 }
function modelTime(model?: string) {
  if (isRemote(model)) return 0.3                         // 배달만 — 이동시간 정도만
  if (isPrevisit(model)) return 0.5                       // 방문만 — 이동시간 정도만 반영
  return MODEL_TIME[(model || '').trim()] ?? 1
}
// 두 좌표 간 거리(km) — Haversine
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}
// 최근접순(greedy nearest-neighbor)으로 방문 순서를 정하고 총 이동거리(km) 반환.
// 시작점 = 가장 서쪽(경도 최소) 지점. 설치 동선 근사.
function nnRoute<T extends { lat: number; lng: number }>(pts: T[]): { order: T[]; km: number } {
  if (pts.length <= 1) return { order: pts.slice(), km: 0 }
  const remaining = pts.slice()
  let startIdx = 0
  for (let i = 1; i < remaining.length; i++) if (remaining[i].lng < remaining[startIdx].lng) startIdx = i
  const order: T[] = [remaining.splice(startIdx, 1)[0]]
  let km = 0
  while (remaining.length) {
    const last = order[order.length - 1]
    let best = 0, bestD = Infinity
    for (let i = 0; i < remaining.length; i++) { const d = haversineKm(last, remaining[i]); if (d < bestD) { bestD = d; best = i } }
    km += bestD
    order.push(remaining.splice(best, 1)[0])
  }
  return { order, km }
}

// 대표모델별 건수. 사전방문은 기본모델(벽걸이 등)과 섞이지 않도록 그대로 별도 키로 센다.
function modelCounts(items: KeyedItem[]): Record<string, number> {
  const c: Record<string, number> = {}
  for (const it of items) { const m = it.model || '단품'; c[m] = (c[m] ?? 0) + 1 }
  return c
}
// 요약 표시용 순서 — 설치건(MODEL_ORDER) 먼저, 사전방문 건은 뒤에 모아서
function summaryKeys(mc: Record<string, number>): string[] {
  const inst = MODEL_ORDER.filter(m => mc[m])
  const pre = Object.keys(mc).filter(k => isPrevisit(k)).sort()
  return [...inst, ...pre]
}
function copyText(text: string) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
  else fallbackCopy(text)
}
function fallbackCopy(text: string) {
  const ta = document.createElement('textarea'); ta.value = text
  ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta)
  ta.select(); try { document.execCommand('copy') } catch { /* noop */ } document.body.removeChild(ta)
}

// 구역 배정 패널 — 차량을 A~E(+미분류) 박스로 드래그드랍. 클릭으로 여러 대 선택 후 한꺼번에 이동 가능.
function RegionAssignPanel({ vehicles, config, regionUnits, onSetRegion }: {
  vehicles: { teamName: string; vehicleNumber: string }[]
  config: Record<string, { region: string }>
  regionUnits: Record<string, number>
  onSetRegion: (vehicleNo: string, region: string) => void
}) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const toggle = (v: string) => setSel(s => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n })
  const clearSel = () => setSel(new Set())
  const regionOf = (v: string) => config[v]?.region || ''
  // 차량 초기화 — 배정된 차량 전부 미배정으로
  const resetAll = () => {
    const assigned = vehicles.filter(v => regionOf(v.vehicleNumber))
    if (assigned.length === 0) return
    if (!confirm(`구역 배정된 차량 ${assigned.length}대를 모두 미배정으로 되돌릴까요?`)) return
    assigned.forEach(v => onSetRegion(v.vehicleNumber, ''))
    clearSel()
  }
  const boxes: { code: string; label: string }[] = [
    { code: '', label: '미배정' },
    ...REGION_ORDER.filter(r => r !== 'UNKNOWN').map(r => ({ code: r as string, label: `${r} ${REGION_NAMES[r]}` })),
  ]
  const inBox = (code: string) => vehicles.filter(v => regionOf(v.vehicleNumber) === code)
  // 드래그 대상: 선택돼 있으면 선택 전체, 아니면 이 차량만
  const dragGroup = (v: string) => (sel.has(v) && sel.size > 0) ? [...sel] : [v]
  const dropTo = (code: string, list: string[]) => { list.forEach(v => onSetRegion(v, code)); clearSel() }
  return (
    <div className="border rounded-lg p-3 bg-sky-50/40 space-y-2">
      <div className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
        <span>차량을 <b>클릭해 여러 대 선택</b> 후 구역 박스로 <b>한꺼번에 드래그</b>하세요. 자동배차는 <b>구역에 배정된 차량에만</b> 배분(미배정 = 오늘 미사용).</span>
        <span className="ml-auto inline-flex items-center gap-2 text-xs">
          {sel.size > 0 && (
            <>
              <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white font-medium">선택 {sel.size}대</span>
              <button onClick={clearSel} className="px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">선택 해제</button>
            </>
          )}
          <button onClick={resetAll} className="px-2 py-0.5 rounded border border-red-300 bg-white text-red-600 hover:bg-red-50">차량 초기화</button>
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {boxes.map(box => {
          const vs = inBox(box.code)
          const units = box.code === '' ? 0 : (regionUnits[box.code] ?? 0)
          const avg = vs.length ? units / vs.length : 0
          return (
            <div key={box.code || 'none'} onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const raw = e.dataTransfer.getData('text/plain'); if (raw) dropTo(box.code, raw.split(',').filter(Boolean)) }}
              className={`border-2 border-dashed rounded-lg p-2 min-h-[92px] ${box.code === '' ? 'bg-gray-50 border-gray-300' : 'bg-white border-sky-300'}`}>
              <div className="text-xs font-semibold text-gray-700 flex items-center justify-between">
                <span>{box.label}</span><span className="text-gray-400">차량 {vs.length}</span>
              </div>
              {box.code !== '' && (
                <div className="text-[10px] text-gray-500">
                  물량 {units}대{vs.length > 0 && <span className="text-indigo-600 font-medium"> · 차량당 {avg.toFixed(1)}대</span>}
                </div>
              )}
              <div className="flex flex-wrap gap-1 mt-1">
                {vs.map(v => {
                  const on = sel.has(v.vehicleNumber)
                  return (
                    <div key={v.vehicleNumber} draggable
                      onClick={() => toggle(v.vehicleNumber)}
                      onDragStart={e => { const g = dragGroup(v.vehicleNumber); e.dataTransfer.setData('text/plain', g.join(',')) }}
                      title={`${v.vehicleNumber} ${v.teamName} — 클릭=선택, 끌어서 구역 이동`}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] cursor-move transition-colors ${on
                        ? 'bg-indigo-600 text-white ring-2 ring-indigo-300'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                      <span className="font-mono font-semibold">{v.vehicleNumber}</span>
                      {v.teamName && <span className="opacity-80">{v.teamName}</span>}
                    </div>
                  )
                })}
                {vs.length === 0 && <span className="text-[11px] text-gray-300">여기로 드래그</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RegionTab({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${active
        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-transparent shadow-sm shadow-indigo-200'
        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
      {label} <span className={active ? 'text-indigo-100' : 'text-slate-400'}>({count})</span>
    </button>
  )
}
// 모델 필터 탭 — 모델색(지도 마커 테두리와 동일)으로 표시. 선택 시 그 색으로 채움.
function ModelTab({ active, onClick, label, count, color }: { active: boolean; onClick: () => void; label: string; count: number; color?: string }) {
  const c = color || '#64748b'
  return (
    <button onClick={onClick}
      className="px-3 py-1 rounded-full text-xs font-medium border transition-colors inline-flex items-center gap-1.5"
      style={active
        ? { background: c, borderColor: c, color: '#fff' }
        : { background: '#fff', borderColor: '#e2e8f0', color: '#475569' }}>
      {!active && <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />}
      {label} <span style={{ color: active ? 'rgba(255,255,255,.8)' : '#94a3b8' }}>({count})</span>
    </button>
  )
}

// /safety = 안전관리 (전체지도+배차 제외, 2층이상/저층 유지)
export default function SafetyPage() {
  return <SafetyView withDispatch={false}
    title="안전관리 (2층이상 / 저층)"
    subtitle="주문번호 붙여넣고 끌고오기 → 주소 층으로 2층이상/저층 자동 분류 · 지도 · 로드뷰 · PDF" />
}
