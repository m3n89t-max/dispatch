'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import Link from 'next/link'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DriverSummaryItem {
  driverName: string
  vehicleNo: string
  matched?: boolean
  deliveryNos?: string[]
  deliveryCount: number
  totalInstall: number
  wallMount: number
  stand: number
  homeMulti: number
  systemAc: number
  preVisit: number
  moveInstall: number
}

interface ComparisonDriver {
  driverName: string
  vehicleNo: string
  prevDeliveryCount: number
  prevInstallCount: number
  sameDayDeliveryCount: number
  sameDayInstallCount: number
  maintained: number
  postponed: number
  added: number
}

interface UploadResult {
  success: boolean
  installDate: string
  uploadType: string
  totalRows: number
  deliveryCount: number
  driverSummary: DriverSummaryItem[]
  unmatchedVehicles: string[]
  comparison: ComparisonDriver[] | null
}

interface DateInfo {
  date: string
  hasPrev: boolean
  hasSameDay: boolean
  prevInstallCount: number
  sameDayInstallCount: number
}

interface SessionInfo {
  id: string
  fileName: string
  uploadedAt: string
  driverSummary: DriverSummaryItem[] | null
  deliveryCount: number
  totalInstall: number
}

interface ViewData {
  installDate: string
  prevSession: SessionInfo | null
  sameDaySession: SessionInfo | null
  comparison: ComparisonDriver[] | null
}

interface DriverRecord {
  id: string
  teamCode: string
  teamName: string
  vehicleNumber: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function numCell(n: number, cls: string) {
  return n > 0
    ? <span className={cls + ' font-semibold'}>{n}</span>
    : <span className="text-gray-300">-</span>
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface DeliveryDetail {
  deliveryNo: string
  customerName: string
  totalInstall: number
  items: { matnr: string; modelType: string; installCount: number }[]
}

const MODEL_TYPE_KR: Record<string, string> = {
  WALL_MOUNT: '벽걸이',
  STAND: '스탠드',
  HOME_MULTI: '홈멀티',
  SYSTEM_AC: '[시스템]',
  COMMERCIAL: '[업소용]',
  PRE_VISIT: '사전방문',
  MOVE_INSTALL: '이전설치',
  UNKNOWN: '미분류',
}

function DriverSummaryTable({
  rows,
  installDate,
  uploadType,
}: {
  rows: DriverSummaryItem[]
  installDate: string
  uploadType: 'PREV_DELIVERY' | 'SAME_DAY_DELIVERY'
}) {
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null)
  const [details, setDetails] = useState<DeliveryDetail[] | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const handleClickDriver = async (driverName: string) => {
    if (expandedDriver === driverName) {
      setExpandedDriver(null)
      setDetails(null)
      return
    }
    setExpandedDriver(driverName)
    setDetails(null)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/delivery/records?date=${installDate}&driverName=${encodeURIComponent(driverName)}&uploadType=${uploadType}`)
      const data = await res.json()
      setDetails(data.deliveries ?? [])
    } catch {
      setDetails([])
    } finally {
      setDetailLoading(false)
    }
  }

  const total = rows.reduce((s, d) => ({
    totalInstall: s.totalInstall + d.totalInstall,
    wallMount: s.wallMount + d.wallMount,
    stand: s.stand + d.stand,
    homeMulti: s.homeMulti + d.homeMulti,
    systemAc: s.systemAc + d.systemAc,
    preVisit: s.preVisit + d.preVisit,
    moveInstall: s.moveInstall + d.moveInstall,
  }), { totalInstall: 0, wallMount: 0, stand: 0, homeMulti: 0, systemAc: 0, preVisit: 0, moveInstall: 0 })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 text-xs">
            <th className="border px-3 py-2 text-left">기사명</th>
            <th className="border px-3 py-2 text-left text-gray-500">차량번호</th>
            <th className="border px-3 py-2 text-right">배송건</th>
            <th className="border px-3 py-2 text-right font-bold">설치대수</th>
            <th className="border px-3 py-2 text-center">벽걸이</th>
            <th className="border px-3 py-2 text-center">스탠드</th>
            <th className="border px-3 py-2 text-center">홈멀티</th>
            <th className="border px-3 py-2 text-center">[시스템]</th>
            <th className="border px-3 py-2 text-center">이전</th>
            <th className="border px-3 py-2 text-center">사전방문</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d, i) => {
            const isExpanded = expandedDriver === d.driverName
            return (
              <Fragment key={i}>
                <tr className={isExpanded ? 'bg-blue-50' : i % 2 === 0 ? '' : 'bg-gray-50'}>
                  <td className="border px-3 py-1.5 font-medium">
                    <button
                      type="button"
                      onClick={() => handleClickDriver(d.driverName)}
                      className="text-blue-700 hover:text-blue-900 hover:underline cursor-pointer inline-flex items-center gap-1"
                    >
                      <span className="text-xs text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                      {d.driverName}
                    </button>
                    {d.matched === false && <span className="ml-1 text-xs text-yellow-600 bg-yellow-50 px-1 rounded">미매칭</span>}
                  </td>
                  <td className="border px-3 py-1.5 text-xs text-gray-400 font-mono">{d.vehicleNo || '-'}</td>
                  <td className="border px-3 py-1.5 text-right text-gray-600">{d.deliveryCount}</td>
                  <td className="border px-3 py-1.5 text-right font-bold text-green-700 text-base">{d.totalInstall}</td>
                  <td className="border px-3 py-1.5 text-center">{numCell(d.wallMount, 'text-blue-600')}</td>
                  <td className="border px-3 py-1.5 text-center">{numCell(d.stand, 'text-green-600')}</td>
                  <td className="border px-3 py-1.5 text-center">{numCell(d.homeMulti, 'text-purple-600')}</td>
                  <td className="border px-3 py-1.5 text-center">{numCell(d.systemAc, 'text-gray-600')}</td>
                  <td className="border px-3 py-1.5 text-center">{numCell(d.moveInstall, 'text-yellow-600')}</td>
                  <td className="border px-3 py-1.5 text-center">{numCell(d.preVisit, 'text-orange-600')}</td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={10} className="border bg-blue-50/30 px-4 py-3">
                      {detailLoading ? (
                        <div className="text-center text-sm text-gray-400 py-3">배차 상세 로딩 중...</div>
                      ) : details && details.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-xs text-gray-500 mb-2">
                            {d.driverName} ({d.vehicleNo}) — 배차 {details.length}건 · 설치 {details.reduce((s, x) => s + x.totalInstall, 0)}대
                          </div>
                          <table className="w-full text-xs border-collapse bg-white">
                            <thead>
                              <tr className="bg-gray-50 text-gray-600">
                                <th className="border px-2 py-1 text-left">Delivery 번호</th>
                                <th className="border px-2 py-1 text-left">고객명</th>
                                <th className="border px-2 py-1 text-left">모델 코드</th>
                                <th className="border px-2 py-1 text-center">유형</th>
                                <th className="border px-2 py-1 text-center">대수</th>
                              </tr>
                            </thead>
                            <tbody>
                              {details.flatMap((dv, idx) =>
                                dv.items.map((it, j) => (
                                  <tr key={`${idx}-${j}`} className={j === 0 ? 'border-t-2 border-t-gray-300' : ''}>
                                    <td className="border px-2 py-1 font-mono text-gray-600">{j === 0 ? dv.deliveryNo : ''}</td>
                                    <td className="border px-2 py-1">{j === 0 ? dv.customerName : ''}</td>
                                    <td className="border px-2 py-1 font-mono text-gray-700">{it.matnr}</td>
                                    <td className="border px-2 py-1 text-center">
                                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                                        it.modelType === 'WALL_MOUNT' ? 'bg-blue-50 text-blue-700' :
                                        it.modelType === 'STAND' ? 'bg-green-50 text-green-700' :
                                        it.modelType === 'HOME_MULTI' ? 'bg-purple-50 text-purple-700' :
                                        it.modelType === 'SYSTEM_AC' ? 'bg-gray-100 text-gray-700' :
                                        it.modelType === 'COMMERCIAL' ? 'bg-pink-50 text-pink-700' :
                                        it.modelType === 'PRE_VISIT' ? 'bg-orange-50 text-orange-700' :
                                        it.modelType === 'MOVE_INSTALL' ? 'bg-yellow-50 text-yellow-700' :
                                        'bg-gray-50 text-gray-400'
                                      }`}>
                                        {MODEL_TYPE_KR[it.modelType] ?? it.modelType}
                                      </span>
                                    </td>
                                    <td className="border px-2 py-1 text-center font-semibold">
                                      {it.installCount > 0 ? it.installCount : <span className="text-gray-300">-</span>}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-center text-sm text-gray-400 py-3">배차 데이터 없음</div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-green-50 font-bold text-sm">
            <td className="border px-3 py-2" colSpan={2}>합계</td>
            <td className="border px-3 py-2 text-right text-gray-600">{rows.reduce((s, d) => s + d.deliveryCount, 0)}</td>
            <td className="border px-3 py-2 text-right text-green-700 text-base">{total.totalInstall}</td>
            <td className="border px-3 py-2 text-center text-blue-600">{total.wallMount || '-'}</td>
            <td className="border px-3 py-2 text-center text-green-600">{total.stand || '-'}</td>
            <td className="border px-3 py-2 text-center text-purple-600">{total.homeMulti || '-'}</td>
            <td className="border px-3 py-2 text-center text-gray-600">{total.systemAc || '-'}</td>
            <td className="border px-3 py-2 text-center text-yellow-600">{total.moveInstall || '-'}</td>
            <td className="border px-3 py-2 text-center text-orange-600">{total.preVisit || '-'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function ComparisonTable({ rows }: { rows: ComparisonDriver[] }) {
  const totalPostponed = rows.reduce((s, r) => s + r.postponed, 0)
  const totalAdded = rows.reduce((s, r) => s + r.added, 0)
  const totalMaintained = rows.reduce((s, r) => s + r.maintained, 0)

  return (
    <div className="space-y-3">
      {/* 전체 요약 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-red-50 border border-red-200 rounded p-3 text-center">
          <div className="text-2xl font-bold text-red-600">{totalPostponed}</div>
          <div className="text-xs text-red-700 mt-1">연기 (전일→당일 미포함)</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{totalAdded}</div>
          <div className="text-xs text-blue-700 mt-1">추가 (당일 신규 접수)</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{totalMaintained}</div>
          <div className="text-xs text-green-700 mt-1">유지 (전일·당일 공통)</div>
        </div>
      </div>

      {/* 기사별 비교 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-xs">
              <th className="border px-3 py-2 text-left">기사명</th>
              <th className="border px-3 py-2 text-center bg-green-50">전일 납기<br /><span className="font-normal text-gray-500">건 / 대</span></th>
              <th className="border px-3 py-2 text-center bg-blue-50">당일 납기<br /><span className="font-normal text-gray-500">건 / 대</span></th>
              <th className="border px-3 py-2 text-center bg-red-50">연기</th>
              <th className="border px-3 py-2 text-center bg-blue-50">추가</th>
              <th className="border px-3 py-2 text-center bg-green-50">유지</th>
              <th className="border px-3 py-2 text-center">변동</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const delta = r.sameDayInstallCount - r.prevInstallCount
              return (
                <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                  <td className="border px-3 py-1.5 font-medium">{r.driverName}</td>
                  <td className="border px-3 py-1.5 text-center">
                    <span className="text-gray-700">{r.prevDeliveryCount}건</span>
                    <span className="text-gray-400 mx-1">/</span>
                    <span className="font-semibold text-green-700">{r.prevInstallCount}대</span>
                  </td>
                  <td className="border px-3 py-1.5 text-center">
                    <span className="text-gray-700">{r.sameDayDeliveryCount}건</span>
                    <span className="text-gray-400 mx-1">/</span>
                    <span className="font-semibold text-blue-700">{r.sameDayInstallCount}대</span>
                  </td>
                  <td className="border px-3 py-1.5 text-center">
                    {r.postponed > 0
                      ? <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded font-semibold">{r.postponed}</span>
                      : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="border px-3 py-1.5 text-center">
                    {r.added > 0
                      ? <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">{r.added}</span>
                      : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="border px-3 py-1.5 text-center">
                    {r.maintained > 0
                      ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded">{r.maintained}</span>
                      : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="border px-3 py-1.5 text-center font-semibold">
                    {delta > 0
                      ? <span className="text-blue-600">+{delta}</span>
                      : delta < 0
                        ? <span className="text-red-600">{delta}</span>
                        : <span className="text-gray-400">0</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const todayStr = new Date().toISOString().slice(0, 10)
  const now = new Date()

  // 업로드 폼 상태
  const [uploadType, setUploadType] = useState<'PREV_DELIVERY' | 'SAME_DAY_DELIVERY'>('PREV_DELIVERY')
  const [installDate, setInstallDate] = useState(todayStr)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 달력 상태
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)
  const [calendarDates, setCalendarDates] = useState<DateInfo[]>([])
  const [calLoading, setCalLoading] = useState(false)

  // 결과 상태
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [viewData, setViewData] = useState<ViewData | null>(null)
  const [viewLoading, setViewLoading] = useState(false)

  // 결과 탭 (기사별 요약 / 비교)
  const [resultTab, setResultTab] = useState<'driver' | 'compare'>('driver')
  // 기사별 탭 내 서브탭 (과거 날짜 조회 시)
  const [driverSubTab, setDriverSubTab] = useState<'prev' | 'sameday'>('prev')

  // 미매칭 차량번호 처리
  const [allDrivers, setAllDrivers] = useState<DriverRecord[]>([])
  const [vehicleAssign, setVehicleAssign] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // SAP 자동 가져오기
  const [sapImporting, setSapImporting] = useState(false)
  const [sapMsg, setSapMsg] = useState('')

  // 기사 목록 로드
  useEffect(() => {
    fetch('/api/drivers')
      .then(r => r.json())
      .then((data: DriverRecord[]) => setAllDrivers(data))
      .catch(() => {})
  }, [])

  // 달력 데이터 로드
  const loadCalendar = useCallback(async (year: number, month: number) => {
    setCalLoading(true)
    try {
      const res = await fetch(`/api/delivery/dates?year=${year}&month=${month}`)
      const data = await res.json()
      setCalendarDates(data.dates ?? [])
    } catch {
      setCalendarDates([])
    } finally {
      setCalLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCalendar(calYear, calMonth)
  }, [calYear, calMonth, loadCalendar])

  // 날짜 클릭 → 해당 날짜 데이터 조회
  const loadDateView = async (date: string) => {
    setViewLoading(true)
    setSelectedDate(date)
    setUploadResult(null)
    setInstallDate(date)
    try {
      const res = await fetch(`/api/delivery/compare?date=${date}`)
      const data: ViewData = await res.json()
      setViewData(data)
      if (data.comparison) setResultTab('compare')
      else {
        setResultTab('driver')
        setDriverSubTab(data.sameDaySession ? 'sameday' : 'prev')
      }
    } catch {
      setViewData(null)
    } finally {
      setViewLoading(false)
    }
  }

  // 업로드 처리
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setLoading(true)
    setError('')
    setUploadResult(null)
    setViewData(null)
    setSaveMsg('')
    setVehicleAssign({})

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('uploadType', uploadType)
      formData.append('installDate', installDate)

      const res = await fetch('/api/delivery/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '업로드 실패')

      setUploadResult(json)
      setSelectedDate(installDate)
      if (json.comparison) setResultTab('compare')
      else setResultTab('driver')

      // 달력 갱신
      const d = new Date(installDate)
      if (d.getFullYear() === calYear && d.getMonth() + 1 === calMonth) {
        loadCalendar(calYear, calMonth)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  // SAP에서 자동 가져오기
  const handleSapImport = async () => {
    if (!confirm('SAP에서 배차 정보를 자동으로 가져옵니다.\n\n전제: SAP에 이미 로그인되어 있어야 합니다.\n진행하시겠습니까?')) return

    setSapImporting(true)
    setError('')
    setUploadResult(null)
    setViewData(null)
    setVehicleAssign({})
    setSapMsg('SAP 연결 중... (SAP GUI를 확인하세요)')

    try {
      const res = await fetch('/api/sap/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadType, installDate }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'SAP 가져오기 실패')

      setUploadResult(json)
      setSelectedDate(installDate)
      if (json.comparison) setResultTab('compare')
      else setResultTab('driver')

      setSapMsg(`✓ ${json.sapDownloadedFile} (${json.totalRows}행, ${json.deliveryCount}건) 가져오기 완료`)

      const d = new Date(installDate)
      if (d.getFullYear() === calYear && d.getMonth() + 1 === calMonth) {
        loadCalendar(calYear, calMonth)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'SAP 가져오기 중 오류')
      setSapMsg('')
    } finally {
      setSapImporting(false)
    }
  }

  // 미매칭 차량번호 기사 저장
  const handleSaveAssign = async () => {
    const entries = Object.entries(vehicleAssign).filter(([, dId]) => dId)
    if (!entries.length) return
    setSaving(true)
    setSaveMsg('')
    try {
      await Promise.all(
        entries.map(([vehicleNo, driverId]) =>
          fetch('/api/drivers', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: driverId, vehicleNumber: vehicleNo }),
          })
        )
      )
      setSaveMsg(`${entries.length}명 저장 완료. 파일을 다시 업로드하면 기사명이 표시됩니다.`)
    } catch {
      setSaveMsg('저장 중 오류가 발생했습니다')
    } finally {
      setSaving(false)
    }
  }

  // 달력 렌더링
  const dateInfoMap = new Map(calendarDates.map(d => [d.date, d]))

  function renderCalendar() {
    const firstDay = new Date(calYear, calMonth - 1, 1).getDay()
    const totalDays = new Date(calYear, calMonth, 0).getDate()
    const cells = []

    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`e-${i}`} />)
    }

    for (let d = 1; d <= totalDays; d++) {
      const mm = String(calMonth).padStart(2, '0')
      const dd = String(d).padStart(2, '0')
      const dateStr = `${calYear}-${mm}-${dd}`
      const info = dateInfoMap.get(dateStr)
      const isToday = dateStr === todayStr
      const isSelected = dateStr === selectedDate

      cells.push(
        <button
          key={dateStr}
          onClick={() => loadDateView(dateStr)}
          className={`
            relative h-10 rounded text-center flex flex-col items-center justify-center text-sm transition-colors
            ${isSelected
              ? 'bg-blue-600 text-white font-bold'
              : isToday
                ? 'bg-blue-50 text-blue-700 font-bold ring-1 ring-blue-400'
                : 'hover:bg-gray-100 text-gray-700'}
          `}
        >
          <span>{d}</span>
          {info && (
            <div className="flex gap-0.5 mt-0.5">
              {info.hasPrev && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-green-300' : 'bg-green-500'}`} />}
              {info.hasSameDay && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-200' : 'bg-blue-500'}`} />}
            </div>
          )}
        </button>
      )
    }
    return cells
  }

  // 결과 섹션에서 표시할 데이터 결정
  const showResult = !!(uploadResult || viewData)

  // 현재 표시할 기사별 요약 (업로드 결과 or 날짜 조회)
  const getDriverSummary = (): DriverSummaryItem[] | null => {
    if (uploadResult) return uploadResult.driverSummary
    if (viewData) {
      if (driverSubTab === 'sameday') return viewData.sameDaySession?.driverSummary ?? null
      return viewData.prevSession?.driverSummary ?? viewData.sameDaySession?.driverSummary ?? null
    }
    return null
  }

  const getComparison = (): ComparisonDriver[] | null => {
    return uploadResult?.comparison ?? viewData?.comparison ?? null
  }

  const hasComparison = !!(getComparison())

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-700 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-green-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">납기 업로드</h1>
        <span className="text-green-200 text-sm">전일 납기 · 당일 납기 관리 및 비교</span>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── 업로드 폼 (3/5) ── */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="font-semibold text-gray-700 mb-4">납기 파일 업로드</h2>

              {/* 타입 선택 */}
              <div className="flex gap-2 mb-4">
                {(['PREV_DELIVERY', 'SAME_DAY_DELIVERY'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setUploadType(t)}
                    className={`flex-1 py-3 rounded-lg text-sm font-medium border-2 transition-colors ${
                      uploadType === t
                        ? t === 'PREV_DELIVERY'
                          ? 'border-green-600 bg-green-600 text-white'
                          : 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {t === 'PREV_DELIVERY' ? '전일 납기' : '당일 납기'}
                    <span className="block text-xs mt-0.5 font-normal opacity-75">
                      {t === 'PREV_DELIVERY' ? '설치 전날 업로드 (배차 기준)' : '설치 당일 오전 업로드 (연기/추가 확인)'}
                    </span>
                  </button>
                ))}
              </div>

              {/* 설명 박스 */}
              <div className={`rounded p-3 mb-4 text-xs ${
                uploadType === 'PREV_DELIVERY'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}>
                {uploadType === 'PREV_DELIVERY'
                  ? '예) 5월 20일 설치 → 5월 19일에 전일 납기 업로드 → 기사 배차 및 전화확정 기준'
                  : '예) 5월 20일 오전 → 당일 납기 업로드 → 전일 대비 연기·추가 건수 자동 비교'}
              </div>

              {/* 설치일 */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  설치일 <span className="text-red-500">*</span>
                  <span className="text-gray-400 font-normal ml-1">(전일/당일 납기 모두 설치일 기준으로 입력)</span>
                </label>
                <input
                  type="date"
                  value={installDate}
                  onChange={e => setInstallDate(e.target.value)}
                  className="border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 w-44"
                />
              </div>

              {/* SAP에서 자동 가져오기 */}
              <div className="border-2 border-dashed border-blue-300 rounded-lg p-4 text-center bg-blue-50/40 mb-3">
                <button
                  type="button"
                  onClick={handleSapImport}
                  disabled={sapImporting || !installDate}
                  className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium text-sm inline-flex items-center gap-2"
                >
                  {sapImporting ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      SAP에서 가져오는 중...
                    </>
                  ) : (
                    <>📥 SAP에서 자동 가져오기</>
                  )}
                </button>
                <p className="mt-2 text-xs text-gray-500">
                  SAP에 로그인된 상태에서 클릭 → 자동 조회 + 업로드 (ZRLEK51270)
                </p>
                {sapMsg && (
                  <p className={`mt-2 text-xs font-medium ${sapMsg.startsWith('✓') ? 'text-green-700' : 'text-blue-700'}`}>
                    {sapMsg}
                  </p>
                )}
              </div>

              <div className="text-center text-xs text-gray-400 my-2">— 또는 수동으로 파일 업로드 —</div>

              {/* 파일 업로드 */}
              <form onSubmit={handleUpload} className="space-y-3">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-5 text-center hover:border-green-400 transition-colors">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={e => setFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100 cursor-pointer"
                  />
                  {file && (
                    <p className="mt-2 text-sm text-green-700 font-medium">
                      {file.name} ({(file.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded p-2.5 text-xs text-gray-500">
                  자동 감지: Delivery 번호(73xxxxxxxx) · 모델코드(AR/AF/AC/L-) · 차량번호 → DB 기사명 매칭
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={!file || loading || !installDate}
                  className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 disabled:opacity-50 font-medium text-sm"
                >
                  {loading ? '처리 중...' : '업로드 및 처리'}
                </button>
              </form>
            </div>

            {/* 미매칭 차량번호 */}
            {uploadResult && uploadResult.unmatchedVehicles.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-semibold text-yellow-700 mb-3">
                  ⚠ 미매칭 차량번호 ({uploadResult.unmatchedVehicles.length}개)
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  차량번호를 기사와 연결하면 DB에 저장됩니다. 이후 업로드 시 자동 매칭됩니다.
                </p>
                <div className="space-y-2">
                  {uploadResult.unmatchedVehicles.map(vno => (
                    <div key={vno} className="flex items-center gap-3">
                      <span className="w-28 font-mono text-sm bg-yellow-50 border border-yellow-200 rounded px-2 py-1.5 text-yellow-800">
                        {vno}
                      </span>
                      <span className="text-gray-400">→</span>
                      <select
                        value={vehicleAssign[vno] ?? ''}
                        onChange={e => setVehicleAssign(prev => ({ ...prev, [vno]: e.target.value }))}
                        className="flex-1 border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                      >
                        <option value="">-- 기사 선택 --</option>
                        {allDrivers.map(d => (
                          <option key={d.id} value={d.id}>
                            {d.teamName} ({d.teamCode}){d.vehicleNumber ? ` [현재: ${d.vehicleNumber}]` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={handleSaveAssign}
                    disabled={saving || Object.values(vehicleAssign).every(v => !v)}
                    className="bg-green-600 text-white px-4 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-40"
                  >
                    {saving ? '저장 중...' : '차량번호 저장'}
                  </button>
                  {saveMsg && <p className="text-sm text-green-700">{saveMsg}</p>}
                </div>
              </div>
            )}
          </div>

          {/* ── 달력 (2/5) ── */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow p-4 sticky top-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-700 text-sm">날짜별 현황</h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12) }
                      else setCalMonth(m => m - 1)
                    }}
                    className="w-7 h-7 rounded hover:bg-gray-100 text-gray-600 flex items-center justify-center text-lg"
                  >
                    ‹
                  </button>
                  <span className="text-sm font-medium w-20 text-center">{calYear}년 {calMonth}월</span>
                  <button
                    onClick={() => {
                      if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1) }
                      else setCalMonth(m => m + 1)
                    }}
                    className="w-7 h-7 rounded hover:bg-gray-100 text-gray-600 flex items-center justify-center text-lg"
                  >
                    ›
                  </button>
                </div>
              </div>

              {/* 요일 헤더 */}
              <div className="grid grid-cols-7 text-center text-xs text-gray-400 mb-1">
                {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                  <div key={d} className="py-1">{d}</div>
                ))}
              </div>

              {/* 달력 그리드 */}
              <div className="grid grid-cols-7 gap-0.5">
                {calLoading
                  ? <div className="col-span-7 text-center text-sm text-gray-400 py-8">로딩 중...</div>
                  : renderCalendar()}
              </div>

              {/* 범례 */}
              <div className="mt-3 pt-3 border-t flex gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                  전일 납기
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                  당일 납기
                </div>
              </div>

              {/* 선택된 날짜 빠른 정보 */}
              {selectedDate && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs text-gray-500 mb-1">
                    선택: <span className="font-medium text-gray-700">{selectedDate}</span>
                  </p>
                  {(() => {
                    const info = dateInfoMap.get(selectedDate)
                    if (!info) return <p className="text-xs text-gray-400">업로드 없음</p>
                    return (
                      <div className="space-y-1 text-xs">
                        {info.hasPrev && (
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-gray-600">전일 납기 {info.prevInstallCount}대</span>
                          </div>
                        )}
                        {info.hasSameDay && (
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="text-gray-600">당일 납기 {info.sameDayInstallCount}대</span>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 결과 섹션 ── */}
        {(showResult || viewLoading) && (
          <div className="mt-6">
            {viewLoading && (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
                데이터 로딩 중...
              </div>
            )}

            {!viewLoading && showResult && (
              <div className="bg-white rounded-lg shadow">
                {/* 결과 헤더 */}
                <div className="p-4 border-b">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-green-600 font-bold">✓</span>
                      <span className="font-semibold text-gray-700">
                        {selectedDate} 설치일 납기 현황
                      </span>
                      {uploadResult && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          uploadResult.uploadType === 'PREV_DELIVERY'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {uploadResult.uploadType === 'PREV_DELIVERY' ? '전일 납기 업로드 완료' : '당일 납기 업로드 완료'}
                        </span>
                      )}
                    </div>

                    {/* 요약 카드들 */}
                    <div className="flex gap-2 text-sm">
                      {(viewData?.prevSession || (uploadResult?.uploadType === 'PREV_DELIVERY')) && (
                        <div className="bg-green-50 border border-green-200 rounded px-3 py-1.5 text-center">
                          <div className="font-bold text-green-700">
                            {uploadResult?.uploadType === 'PREV_DELIVERY'
                              ? uploadResult.driverSummary.reduce((s, d) => s + d.totalInstall, 0)
                              : viewData?.prevSession?.totalInstall ?? 0}대
                          </div>
                          <div className="text-xs text-green-600">전일 납기</div>
                        </div>
                      )}
                      {(viewData?.sameDaySession || (uploadResult?.uploadType === 'SAME_DAY_DELIVERY')) && (
                        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-1.5 text-center">
                          <div className="font-bold text-blue-700">
                            {uploadResult?.uploadType === 'SAME_DAY_DELIVERY'
                              ? uploadResult.driverSummary.reduce((s, d) => s + d.totalInstall, 0)
                              : viewData?.sameDaySession?.totalInstall ?? 0}대
                          </div>
                          <div className="text-xs text-blue-600">당일 납기</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 세션 정보 (날짜 조회 시) */}
                  {viewData && (
                    <div className="mt-2 flex gap-4 text-xs text-gray-400">
                      {viewData.prevSession && (
                        <span>전일 납기: {viewData.prevSession.fileName} · {formatDate(viewData.prevSession.uploadedAt)} 업로드</span>
                      )}
                      {viewData.sameDaySession && (
                        <span>당일 납기: {viewData.sameDaySession.fileName} · {formatDate(viewData.sameDaySession.uploadedAt)} 업로드</span>
                      )}
                    </div>
                  )}
                </div>

                {/* 탭 */}
                <div className="flex border-b px-4">
                  <button
                    onClick={() => setResultTab('driver')}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      resultTab === 'driver'
                        ? 'border-green-600 text-green-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    기사별 요약
                  </button>
                  {hasComparison && (
                    <button
                      onClick={() => setResultTab('compare')}
                      className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        resultTab === 'compare'
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      전일 vs 당일 비교
                      {(() => {
                        const comp = getComparison()
                        if (!comp) return null
                        const postponed = comp.reduce((s, r) => s + r.postponed, 0)
                        const added = comp.reduce((s, r) => s + r.added, 0)
                        return (postponed + added > 0)
                          ? <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-xs">{postponed + added}</span>
                          : null
                      })()}
                    </button>
                  )}
                </div>

                {/* 탭 컨텐츠 */}
                <div className="p-4">
                  {resultTab === 'driver' && (
                    <div>
                      {/* 날짜 조회 시 전일/당일 서브탭 */}
                      {viewData && viewData.prevSession && viewData.sameDaySession && (
                        <div className="flex gap-2 mb-3">
                          <button
                            onClick={() => setDriverSubTab('prev')}
                            className={`px-3 py-1 rounded text-xs font-medium border ${
                              driverSubTab === 'prev'
                                ? 'border-green-600 bg-green-600 text-white'
                                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            전일 납기 ({viewData.prevSession.totalInstall}대)
                          </button>
                          <button
                            onClick={() => setDriverSubTab('sameday')}
                            className={`px-3 py-1 rounded text-xs font-medium border ${
                              driverSubTab === 'sameday'
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            당일 납기 ({viewData.sameDaySession.totalInstall}대)
                          </button>
                        </div>
                      )}

                      {getDriverSummary()
                        ? <DriverSummaryTable
                            rows={getDriverSummary()!}
                            installDate={selectedDate ?? installDate}
                            uploadType={
                              uploadResult
                                ? (uploadResult.uploadType as 'PREV_DELIVERY' | 'SAME_DAY_DELIVERY')
                                : driverSubTab === 'sameday' ? 'SAME_DAY_DELIVERY' : 'PREV_DELIVERY'
                            }
                          />
                        : <p className="text-sm text-gray-400 text-center py-8">데이터가 없습니다</p>}
                    </div>
                  )}

                  {resultTab === 'compare' && (
                    <div>
                      {getComparison()
                        ? <ComparisonTable rows={getComparison()!} />
                        : <p className="text-sm text-gray-400 text-center py-8">비교 데이터가 없습니다</p>}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
