'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useKakaoMap } from '@/lib/useKakaoMap'
import { addrKeyFromKakao, normalizeAddr } from '@/lib/addrKey'

// 지도는 SSR 비활성 (window.kakao 사용)
const RegionMap = dynamic(() => import('@/components/RegionMap'), { ssr: false })

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
  commercial: number
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

type RegionCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'UNKNOWN'

interface DeliveryDot {
  deliveryNo: string
  driverName: string
  vehicleNo: string
  customerName: string
  address: string
  zipcode: string
  region: RegionCode
}

interface ZipcodePoint {
  zipcode: string
  region: RegionCode
  count: number
  sampleAddress: string
  deliveries?: DeliveryDot[]
}

interface RegionStats {
  total: Record<RegionCode, number>
  byDriver: Array<{ driverName: string; counts: Record<RegionCode, number> }>
  byZipcode?: ZipcodePoint[]
  regionOrder: RegionCode[]
  regionNames: Record<RegionCode, string>
}

interface DateStats {
  postponed: number   // 고객요청일 < 설치일 → 연기
  preInstall: number  // 고객요청일 > 설치일 → 선설치
  normal: number      // 고객요청일 = 설치일
  unknown: number     // 요청일 없음
}

// PDA Step Status (설치결과) 집계
type PdaCounts = Record<string, number>
interface StatusStats {
  total: PdaCounts
  byDriver: { driverName: string; vehicleNo: string; counts: PdaCounts }[]
}
const PDA_ORDER = ['INSTALLED', 'POSTPONED_INSTALLED', 'POSTPONED', 'CANCELLED', 'RETURNED', 'FAILED'] as const
const PDA_NAME: Record<string, string> = {
  INSTALLED: '설치', POSTPONED_INSTALLED: '연기후설치', POSTPONED: '연기',
  CANCELLED: '취소', RETURNED: '반품', FAILED: '통불', UNKNOWN: '미분류',
}
const PDA_CLS: Record<string, string> = {
  INSTALLED: 'bg-green-50 text-green-700 border-green-200',
  POSTPONED_INSTALLED: 'bg-teal-50 text-teal-700 border-teal-200',
  POSTPONED: 'bg-amber-50 text-amber-700 border-amber-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
  RETURNED: 'bg-rose-50 text-rose-700 border-rose-200',
  FAILED: 'bg-gray-50 text-gray-700 border-gray-200',
}

interface UploadResult {
  success: boolean
  installDate: string
  uploadType: string
  totalRows: number
  deliveryCount: number
  driverSummary: DriverSummaryItem[]
  dateStats?: DateStats
  unmatchedVehicles: string[]
  comparison: ComparisonDriver[] | null
  regionStats?: RegionStats
  statusStats?: StatusStats
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
  regionStats?: RegionStats
  statusStats?: StatusStats
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
  address: string
  totalInstall: number
  items: { matnr: string; modelType: string; installCount: number }[]
}

const MODEL_TYPE_KR: Record<string, string> = {
  WALL_MOUNT: '벽걸이',
  STAND: '스탠드',
  HOME_MULTI: '홈멀티',
  SYSTEM_4WAY: '[시스템4]',
  SYSTEM_1WAY: '[시스템1]',
  SYSTEM_AC: '[시스템]',
  COMMERCIAL: '[업소용]',
  PRE_VISIT: '사전방문',
  MOVE_INSTALL: '이전설치',
  UNKNOWN: '미분류',
}

const REGION_BG: Record<RegionCode, string> = {
  A: 'bg-emerald-100 text-emerald-800',
  B: 'bg-sky-100 text-sky-800',
  C: 'bg-violet-100 text-violet-800',
  D: 'bg-amber-100 text-amber-800',
  E: 'bg-rose-100 text-rose-800',
  UNKNOWN: 'bg-gray-100 text-gray-600',
}

function RegionStatsCard({ stats }: { stats: RegionStats }) {
  const total = stats.regionOrder.reduce((s, r) => s + (stats.total[r] ?? 0), 0)
  if (total === 0) return null

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="font-semibold text-base text-gray-800 mb-3">🗺 구역별 분포 (Delivery 기준)</h3>

      {/* 전체 분포 바 */}
      <div className="flex gap-1 h-8 rounded overflow-hidden mb-2">
        {stats.regionOrder.map(r => {
          const cnt = stats.total[r] ?? 0
          if (cnt === 0) return null
          const pct = (cnt / total) * 100
          return (
            <div
              key={r}
              className={`${REGION_BG[r]} flex items-center justify-center text-xs font-medium`}
              style={{ width: `${pct}%` }}
              title={`${r}구역 (${stats.regionNames[r]}): ${cnt}건 (${pct.toFixed(1)}%)`}
            >
              {pct >= 8 ? `${r} ${cnt}` : ''}
            </div>
          )
        })}
      </div>

      {/* 구역별 카운트 표 */}
      <div className="grid grid-cols-6 gap-2 text-xs mb-3">
        {stats.regionOrder.map(r => (
          <div key={r} className={`${REGION_BG[r]} rounded p-2 text-center`}>
            <div className="font-semibold">{r}구역</div>
            <div className="text-[10px] opacity-75">{stats.regionNames[r]}</div>
            <div className="text-base font-bold mt-0.5">{stats.total[r] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* 기사별 구역 분포 */}
      {stats.byDriver.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-600 hover:text-gray-800 mb-1">
            ▸ 기사별 구역 분포 ({stats.byDriver.length}명)
          </summary>
          <table className="w-full text-xs mt-2 border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="border px-2 py-1 text-left">기사</th>
                {stats.regionOrder.map(r => (
                  <th key={r} className="border px-2 py-1 text-center w-12">
                    <span className={`inline-block px-1.5 py-0.5 rounded ${REGION_BG[r]}`}>{r}</span>
                  </th>
                ))}
                <th className="border px-2 py-1 text-center w-12">합계</th>
              </tr>
            </thead>
            <tbody>
              {stats.byDriver
                .map(d => ({ ...d, sum: stats.regionOrder.reduce((s, r) => s + (d.counts[r] ?? 0), 0) }))
                .sort((a, b) => b.sum - a.sum)
                .map(d => (
                  <tr key={d.driverName} className="hover:bg-gray-50">
                    <td className="border px-2 py-1 font-medium">{d.driverName}</td>
                    {stats.regionOrder.map(r => {
                      const c = d.counts[r] ?? 0
                      return (
                        <td key={r} className="border px-1 py-1 text-center">
                          {c > 0 ? c : <span className="text-gray-300">·</span>}
                        </td>
                      )
                    })}
                    <td className="border px-2 py-1 text-center font-semibold">{d.sum}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

function UploadRegionMap({ stats }: { stats: RegionStats }) {
  const [driverFilter, setDriverFilter] = useState<string>('')
  const drivers = stats.byDriver.map(d => d.driverName).sort()
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-base text-gray-800">🗺 지도 분포 (차량별)</h3>
        <select
          value={driverFilter}
          onChange={e => setDriverFilter(e.target.value)}
          className="text-xs border rounded px-2 py-1"
        >
          <option value="">전체 기사</option>
          {drivers.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <RegionMap
        points={stats.byZipcode ?? []}
        height={620}
        driverFilter={driverFilter || undefined}
      />
      {driverFilter && (
        <p className="mt-2 text-xs text-gray-500">
          ▸ <b>{driverFilter}</b> 기사 강조 — 회색 마커는 다른 기사 배달
        </p>
      )}
    </div>
  )
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
    commercial: s.commercial + d.commercial,
    preVisit: s.preVisit + d.preVisit,
    moveInstall: s.moveInstall + d.moveInstall,
  }), { totalInstall: 0, wallMount: 0, stand: 0, homeMulti: 0, systemAc: 0, commercial: 0, preVisit: 0, moveInstall: 0 })

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
            <th className="border px-3 py-2 text-center">[업소용]</th>
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
                  <td className="border px-3 py-1.5 text-center">{numCell(d.commercial, 'text-pink-600')}</td>
                  <td className="border px-3 py-1.5 text-center">{numCell(d.moveInstall, 'text-yellow-600')}</td>
                  <td className="border px-3 py-1.5 text-center">{numCell(d.preVisit, 'text-orange-600')}</td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={11} className="border bg-blue-50/30 px-4 py-3">
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
                                <th className="border px-2 py-1 text-left">주소</th>
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
                                    <td className="border px-2 py-1 text-gray-600">{j === 0 ? dv.address : ''}</td>
                                    <td className="border px-2 py-1 font-mono text-gray-700">{it.matnr}</td>
                                    <td className="border px-2 py-1 text-center">
                                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                                        it.modelType === 'WALL_MOUNT' ? 'bg-blue-50 text-blue-700' :
                                        it.modelType === 'STAND' ? 'bg-green-50 text-green-700' :
                                        it.modelType === 'HOME_MULTI' ? 'bg-purple-50 text-purple-700' :
                                        (it.modelType === 'SYSTEM_AC' || it.modelType === 'SYSTEM_4WAY' || it.modelType === 'SYSTEM_1WAY') ? 'bg-gray-100 text-gray-700' :
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
            <td className="border px-3 py-2 text-center text-pink-600">{total.commercial || '-'}</td>
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

// 금일 현황 대시보드
function Dashboard({
  rows,
  dateStats,
  regionStats,
  statusStats,
}: {
  rows: DriverSummaryItem[]
  dateStats?: DateStats
  regionStats?: RegionStats
  statusStats?: StatusStats
}) {
  const teams = rows.length
  const deliveries = rows.reduce((s, d) => s + d.deliveryCount, 0)
  const install = rows.reduce((s, d) => s + d.totalInstall, 0)
  const wall = rows.reduce((s, d) => s + d.wallMount, 0)
  const stand = rows.reduce((s, d) => s + d.stand, 0)
  const home = rows.reduce((s, d) => s + d.homeMulti, 0)
  const sys = rows.reduce((s, d) => s + d.systemAc, 0)
  const comm = rows.reduce((s, d) => s + d.commercial, 0)

  const Stat = ({ label, value, cls }: { label: string; value: number; cls: string }) => (
    <div className={`rounded-xl border p-3.5 text-center ${cls}`}>
      <div className="text-3xl font-bold leading-none tabular-nums">{value}</div>
      <div className="text-xs mt-1.5 font-medium opacity-80">{label}</div>
    </div>
  )

  return (
    <div className="bg-white rounded-lg shadow p-5 space-y-4">
      <h3 className="font-semibold text-base text-gray-800">📊 금일 배차 현황</h3>

      {/* 핵심 */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
        <Stat label="차량투입(팀)" value={teams} cls="bg-slate-50 text-slate-700 border-slate-200" />
        <Stat label="배송(건)" value={deliveries} cls="bg-slate-50 text-slate-700 border-slate-200" />
        <Stat label="설치(대)" value={install} cls="bg-green-50 text-green-700 border-green-200" />
        <Stat label="연기" value={dateStats?.postponed ?? 0} cls="bg-red-50 text-red-700 border-red-200" />
        <Stat label="선설치" value={dateStats?.preInstall ?? 0} cls="bg-indigo-50 text-indigo-700 border-indigo-200" />
      </div>

      {/* 모델별 */}
      <div>
        <div className="text-xs text-gray-400 mb-1.5 font-medium">모델별</div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
          <Stat label="벽걸이" value={wall} cls="bg-blue-50 text-blue-700 border-blue-200" />
          <Stat label="스탠드" value={stand} cls="bg-green-50 text-green-700 border-green-200" />
          <Stat label="홈멀티" value={home} cls="bg-purple-50 text-purple-700 border-purple-200" />
          <Stat label="시스템" value={sys} cls="bg-gray-50 text-gray-700 border-gray-200" />
          <Stat label="업소용" value={comm} cls="bg-pink-50 text-pink-700 border-pink-200" />
        </div>
      </div>

      {/* 구역별 */}
      {regionStats && (
        <div>
          <div className="text-xs text-gray-400 mb-1.5 font-medium">구역별 (Delivery 기준)</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {regionStats.regionOrder.map(r => (
              <div key={r} className={`rounded-xl border p-2.5 text-center ${REGION_BG[r]}`}>
                <div className="text-2xl font-bold leading-none tabular-nums">{regionStats.total[r] ?? 0}</div>
                <div className="text-[11px] mt-1.5 font-medium opacity-80">{r} {regionStats.regionNames[r]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PDA 설치결과 (총계) */}
      {statusStats && (
        <div>
          <div className="text-xs text-gray-400 mb-1.5 font-medium">설치결과 (PDA Step Status · Delivery 기준)</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {PDA_ORDER.map(k => (
              <Stat key={k} label={PDA_NAME[k]} value={statusStats.total[k] ?? 0} cls={PDA_CLS[k]} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// 차량(기사)별 설치결과 — 연기/취소/반품 많은 순
// 안전관리에서 표시한 "실내 실외기실"(공유 DB) ↔ 오늘 배차 매칭 (비 오는 날 배차 대상)
function IndoorMatchCard({ matches, totalFlagged }: {
  matches: { deliveryNo: string; driverName: string; vehicleNo: string; address: string }[]; totalFlagged: number
}) {
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h3 className="font-semibold text-base text-gray-800 mb-1 flex items-center gap-2">
        🏠 실내 실외기실 매칭 <span className="text-sm font-normal text-gray-400">(비 오는 날 배차 대상)</span>
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        안전관리 표시 {totalFlagged}건 중 오늘 배차 포함 <b className="text-sky-700">{matches.length}건</b>
      </p>
      {matches.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">오늘 배차에 해당 건 없음</p>
      ) : (
        <div className="overflow-auto max-h-80">
          <table className="min-w-full text-sm">
            <thead className="bg-sky-50 text-gray-600 sticky top-0">
              <tr>
                <th className="border px-3 py-1.5 text-left">납품번호</th>
                <th className="border px-3 py-1.5 text-left">기사</th>
                <th className="border px-3 py-1.5 text-left">차량번호</th>
                <th className="border px-3 py-1.5 text-left">주소</th>
              </tr>
            </thead>
            <tbody>
              {matches.map(m => (
                <tr key={m.deliveryNo} className="bg-sky-50/40 hover:bg-sky-100">
                  <td className="border px-3 py-1.5 font-mono">{m.deliveryNo}</td>
                  <td className="border px-3 py-1.5">{m.driverName || '-'}</td>
                  <td className="border px-3 py-1.5 font-mono text-gray-500">{m.vehicleNo || '-'}</td>
                  <td className="border px-3 py-1.5">{m.address || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusByDriver({ statusStats }: { statusStats?: StatusStats }) {
  if (!statusStats || statusStats.byDriver.length === 0) return null
  const rows = statusStats.byDriver
  const sum = (k: string) => rows.reduce((s, d) => s + (d.counts[k] ?? 0), 0)
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h3 className="font-semibold text-base text-gray-800 mb-3">🚚 차량별 설치결과 (PDA)</h3>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600">
              <th className="border px-3 py-1.5 text-left">기사</th>
              <th className="border px-3 py-1.5 text-left">차량번호</th>
              {PDA_ORDER.map(k => <th key={k} className="border px-3 py-1.5 text-right">{PDA_NAME[k]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(d => (
              <tr key={d.driverName} className="hover:bg-gray-50">
                <td className="border px-3 py-1.5">{d.driverName}</td>
                <td className="border px-3 py-1.5 font-mono text-gray-500">{d.vehicleNo}</td>
                {PDA_ORDER.map(k => {
                  const v = d.counts[k] ?? 0
                  const warn = (k === 'POSTPONED' || k === 'CANCELLED' || k === 'RETURNED') && v > 0
                  return <td key={k} className={`border px-3 py-1.5 text-right tabular-nums ${warn ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{v || ''}</td>
                })}
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td className="border px-3 py-1.5" colSpan={2}>합계</td>
              {PDA_ORDER.map(k => <td key={k} className="border px-3 py-1.5 text-right tabular-nums">{sum(k) || ''}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const now = new Date()
  // 로컬(KST) 기준 오늘. toISOString()은 UTC라 KST 오전에는 하루 빠져 달력 '오늘'이 어제로 찍힘.
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // 업로드 폼 상태 — 전일/당일 구분 제거, 단일 타입 사용
  const uploadType = 'PREV_DELIVERY' as const
  const [installDate, setInstallDate] = useState(todayStr)
  const [error, setError] = useState('')
  // DRM 우회용: SAP 화면 복사 → 텍스트 붙여넣기
  const [pasteText, setPasteText] = useState('')
  const [pasteLoading, setPasteLoading] = useState(false)

  // 달력 상태
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)
  const [calendarDates, setCalendarDates] = useState<DateInfo[]>([])
  const [calLoading, setCalLoading] = useState(false)

  // 결과 상태
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr)
  const [viewData, setViewData] = useState<ViewData | null>(null)
  const [viewLoading, setViewLoading] = useState(false)

  // 기사별 요약 표시 기준 서브탭 (과거 날짜 조회 시)
  const [driverSubTab, setDriverSubTab] = useState<'prev' | 'sameday'>('prev')

  // 안전관리 "실내 실외기실" 표시(주소키 기준, 공유 DB) → 배차현황과 매칭 (비 오는 날 배차 대상)
  const [indoorFlags, setIndoorFlags] = useState<Record<string, boolean>>({})
  const [indoorMatches, setIndoorMatches] = useState<{ deliveryNo: string; driverName: string; vehicleNo: string; address: string }[]>([])
  const indoorGeocodeSig = useRef('')
  const { ready: kakaoReady } = useKakaoMap()

  // 미매칭 차량번호 처리
  const [allDrivers, setAllDrivers] = useState<DriverRecord[]>([])
  const [vehicleAssign, setVehicleAssign] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // SAP 자동 가져오기
  const [sapImporting, setSapImporting] = useState(false)
  const [sapMsg, setSapMsg] = useState('')
  const [autoMin, setAutoMin] = useState(0)   // 자동 갱신 간격(분): 0=끄기, 5, 8

  // 뒤로가기/홈 갔다와도 업로드 결과 유지 (sessionStorage 복원 → 저장)
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    try {
      const r = sessionStorage.getItem('upload_result'); if (r) setUploadResult(JSON.parse(r))
      const d = sessionStorage.getItem('upload_installDate'); if (d) setInstallDate(d)
    } catch { /* noop */ }
    setRestored(true)
  }, [])
  useEffect(() => {
    if (!restored) return
    try { if (uploadResult) sessionStorage.setItem('upload_result', JSON.stringify(uploadResult)); else sessionStorage.removeItem('upload_result') } catch { /* noop */ }
  }, [uploadResult, restored])
  useEffect(() => { if (restored) { try { sessionStorage.setItem('upload_installDate', installDate) } catch { /* noop */ } } }, [installDate, restored])

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
      setDriverSubTab(data.sameDaySession ? 'sameday' : 'prev')
    } catch {
      setViewData(null)
    } finally {
      setViewLoading(false)
    }
  }

  // 최초 진입 시 오늘 날짜 현황 자동 조회 (날짜 칸은 컴퓨터 날짜 기준)
  useEffect(() => {
    loadDateView(todayStr)
    // 안전관리에서 표시한 실내 실외기실(주소키) 목록 로드 → 배차와 매칭
    fetch('/api/safety/flag', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d && d.flags) setIndoorFlags(d.flags.indoor ?? {}) })
      .catch(() => { /* noop */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 업로드 처리
  // DRM 우회: SAP 화면에서 복사한 텍스트(TSV)를 업로드
  const handlePasteUpload = async () => {
    if (!pasteText.trim()) return
    setPasteLoading(true)
    setError('')
    setUploadResult(null)
    setViewData(null)
    setSaveMsg('')
    setVehicleAssign({})
    try {
      const formData = new FormData()
      formData.append('tsvText', pasteText)
      formData.append('uploadType', uploadType)
      formData.append('installDate', installDate)

      const res = await fetch('/api/delivery/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '업로드 실패')

      setUploadResult(json)
      setSelectedDate(installDate)
      const d = new Date(installDate)
      if (d.getFullYear() === calYear && d.getMonth() + 1 === calMonth) {
        loadCalendar(calYear, calMonth)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다')
    } finally {
      setPasteLoading(false)
    }
  }

  // SAP에서 자동 가져오기 (실제 실행 — 자동/수동 공용, 확인창 없음)
  const runningRef = useRef(false)
  const runSapImport = async () => {
    if (runningRef.current) return   // 실행 중이면 이번 틱 건너뜀(중복 방지)
    runningRef.current = true
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

      const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setSapMsg(`✓ ${json.sapDownloadedFile} (${json.totalRows}행, ${json.deliveryCount}건) — ${t} 갱신`)

      const d = new Date(installDate)
      if (d.getFullYear() === calYear && d.getMonth() + 1 === calMonth) {
        loadCalendar(calYear, calMonth)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'SAP 가져오기 중 오류')
      setSapMsg('')
    } finally {
      setSapImporting(false)
      runningRef.current = false
    }
  }
  // 인터벌에서 항상 최신 함수 호출하도록 ref 유지
  const runSapRef = useRef(runSapImport)
  runSapRef.current = runSapImport
  // 자동 갱신: autoMin 분마다 SAP 가져오기 (확인창 없이)
  useEffect(() => {
    if (autoMin <= 0) return
    const id = setInterval(() => { runSapRef.current() }, autoMin * 60 * 1000)
    return () => clearInterval(id)
  }, [autoMin])

  // 버튼 클릭(수동) — 확인 후 실행
  const handleSapImport = () => {
    if (!confirm('SAP에서 배차 정보를 자동으로 가져옵니다.\n\n전제: SAP에 이미 로그인되어 있어야 합니다.\n진행하시겠습니까?')) return
    runSapImport()
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

  const driverRows = getDriverSummary()
  const currentRegionStats = uploadResult?.regionStats ?? viewData?.regionStats ?? null
  const currentDateStats = uploadResult?.dateStats ?? null
  const currentStatusStats = uploadResult?.statusStats ?? viewData?.statusStats ?? null

  // 실내 실외기실(공유 DB, 주소키 기준) ↔ 오늘 배차 매칭
  // 판매처가 주소를 다르게 입력해도, 각 배차 주소를 카카오맵으로 지오코딩해 같은 건물이면 매칭됨.
  const flaggedCount = Object.values(indoorFlags).filter(Boolean).length

  useEffect(() => {
    const flagged = new Set(Object.keys(indoorFlags).filter(k => indoorFlags[k]))
    // 오늘 배차의 delivery(주소+기사) 목록 — 구역 지도 데이터에서
    const dots = currentRegionStats?.byZipcode?.flatMap(z => z.deliveries ?? []) ?? []
    const seen = new Set<string>()
    const cands = dots.filter(d => d.deliveryNo && d.address && !seen.has(d.deliveryNo) && seen.add(d.deliveryNo))
    const sig = `${[...flagged].sort().join('|')}#${cands.map(c => c.deliveryNo).join(',')}`
    if (flagged.size === 0 || cands.length === 0) { setIndoorMatches([]); indoorGeocodeSig.current = sig; return }
    if (!kakaoReady) return
    if (indoorGeocodeSig.current === sig) return   // 같은 데이터셋 재지오코딩 방지
    indoorGeocodeSig.current = sig

    const kakao = window.kakao
    const geocoder = new kakao.maps.services.Geocoder()
    // 주소 문자열 단위로 묶어 지오코딩 호출 최소화
    const byAddr = new Map<string, typeof cands>()
    for (const c of cands) { if (!byAddr.has(c.address)) byAddr.set(c.address, []); byAddr.get(c.address)!.push(c) }
    const addrs = [...byAddr.keys()]
    const out: { deliveryNo: string; driverName: string; vehicleNo: string; address: string }[] = []
    let cancelled = false
    const step = (i: number) => {
      if (cancelled) return
      if (i >= addrs.length) { setIndoorMatches(out); return }
      const address = addrs[i]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      geocoder.addressSearch(address, (result: any[], status: string) => {
        if (cancelled) return
        const ok = status === kakao.maps.services.Status.OK && result[0]
        const key = ok ? addrKeyFromKakao(result[0]) : normalizeAddr(address)
        if (flagged.has(key)) for (const d of byAddr.get(address)!)
          out.push({ deliveryNo: d.deliveryNo, driverName: d.driverName, vehicleNo: d.vehicleNo, address: d.address })
        setTimeout(() => step(i + 1), 40)
      })
    }
    step(0)
    return () => { cancelled = true }
  }, [kakaoReady, currentRegionStats, indoorFlags])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-700 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-green-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">납기 업로드</h1>
        <span className="text-green-200 text-sm">설치일 납기 업로드 · 배차 현황</span>
      </header>

      <main className="max-w-[1680px] mx-auto p-4 md:p-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── 업로드 폼 (3/5) ── */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="font-semibold text-gray-700 mb-4">납기 파일 업로드</h2>

              {/* 설치일 */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  설치일 <span className="text-red-500">*</span>
                  <span className="text-gray-400 font-normal ml-1">(기본값: 오늘)</span>
                </label>
                <input
                  type="date"
                  value={installDate}
                  onChange={e => setInstallDate(e.target.value)}
                  className="border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 w-44"
                />
              </div>

              {/* SAP 자동 다운로드 + 자동 업로드 (메인) */}
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

                {/* 자동 갱신 간격 */}
                <div className="mt-3 flex items-center justify-center gap-1.5 text-xs flex-wrap">
                  <span className="text-gray-500 mr-1">자동 갱신</span>
                  {[0, 5, 8].map(m => (
                    <button key={m} type="button" onClick={() => setAutoMin(m)}
                      className={`px-3 py-1 rounded-full border transition-colors ${autoMin === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                      {m === 0 ? '끄기' : `${m}분`}
                    </button>
                  ))}
                  {autoMin > 0 && (
                    <span className="ml-1 inline-flex items-center gap-1 text-green-600 font-medium">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      {autoMin}분마다 자동 실행 중
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs text-gray-500">
                  SAP에 로그인된 상태에서 클릭 → 자동 조회 + 엑셀 다운로드 + 자동 업로드 (ZRLEJ56700)
                  {autoMin > 0 && <><br />※ 자동 갱신 중엔 확인창 없이 {autoMin}분마다 실행됩니다 (이 화면을 열어둔 상태 유지).</>}
                </p>
                {sapMsg && (
                  <p className={`mt-2 text-xs font-medium ${sapMsg.startsWith('✓') ? 'text-green-700' : 'text-blue-700'}`}>
                    {sapMsg}
                  </p>
                )}
              </div>

              {/* 오류 표시 (SAP 가져오기/붙여넣기 공통) */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mt-3">{error}</div>
              )}

              {/* DRM 우회: SAP 화면 복사 → 텍스트 붙여넣기 */}
              <div className="mt-4 border-t pt-4">
                <div className="text-center text-xs text-gray-400 mb-2">— 또는 SAP 화면을 복사해 붙여넣기 (DRM 우회) —</div>
                <p className="text-xs text-gray-500 mb-2">
                  보안 PC에서 엑셀이 <b>DRM 암호화</b>돼 업로드가 안 될 때: SAP 조회 화면에서 <b>전체 선택(Ctrl+A) → 복사(Ctrl+C)</b> 후 아래에 붙여넣기(Ctrl+V).
                  <b className="text-gray-700"> 헤더(UNCOB 등)가 포함</b>되도록 복사하세요.
                </p>
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="여기에 SAP 화면에서 복사한 데이터를 붙여넣으세요 (탭 구분)"
                  rows={4}
                  className="w-full border rounded p-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-400"
                />
                <button
                  type="button"
                  onClick={handlePasteUpload}
                  disabled={!pasteText.trim() || pasteLoading || !installDate}
                  className="mt-2 bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700 disabled:opacity-50 font-medium text-sm"
                >
                  {pasteLoading ? '처리 중...' : '붙여넣기 업로드'}
                </button>
              </div>
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
              <div className="space-y-4">
                {/* 결과 헤더 */}
                <div className="bg-white rounded-lg shadow px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600 font-bold">✓</span>
                    <span className="font-semibold text-gray-700">{selectedDate} 설치일 배차 현황</span>
                    {uploadResult && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">업로드 완료</span>
                    )}
                  </div>
                  {viewData?.prevSession && (
                    <span className="text-xs text-gray-400">
                      {viewData.prevSession.fileName} · {formatDate(viewData.prevSession.uploadedAt)}
                    </span>
                  )}
                </div>

                {/* 2단: 좌(대시보드+기사표) / 우(구역+지도 항시) — 지도 넓게 3:2 */}
                <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
                  {/* 좌 */}
                  <div className="xl:col-span-3 space-y-4">
                    {driverRows && driverRows.length > 0 && (
                      <Dashboard
                        rows={driverRows}
                        dateStats={currentDateStats ?? undefined}
                        regionStats={currentRegionStats ?? undefined}
                        statusStats={currentStatusStats ?? undefined}
                      />
                    )}

                    <StatusByDriver statusStats={currentStatusStats ?? undefined} />

                    {flaggedCount > 0 && <IndoorMatchCard matches={indoorMatches} totalFlagged={flaggedCount} />}

                    <div className="bg-white rounded-lg shadow p-5">
                      <h3 className="font-semibold text-base text-gray-800 mb-3">🚚 기사별 배차 요약</h3>
                      {driverRows && driverRows.length > 0
                        ? <DriverSummaryTable
                            rows={driverRows}
                            installDate={selectedDate ?? installDate}
                            uploadType={uploadType}
                          />
                        : <p className="text-sm text-gray-400 text-center py-8">데이터가 없습니다</p>}
                    </div>

                    {hasComparison && (
                      <div className="bg-white rounded-lg shadow p-4">
                        <h3 className="font-semibold text-sm mb-3">전일 vs 당일 비교</h3>
                        <ComparisonTable rows={getComparison()!} />
                      </div>
                    )}
                  </div>

                  {/* 우: 구역 + 지도 (항시 표시) */}
                  <div className="xl:col-span-2 space-y-4">
                    {currentRegionStats ? (
                      <>
                        <RegionStatsCard stats={currentRegionStats} />
                        {currentRegionStats.byZipcode && currentRegionStats.byZipcode.length > 0 && (
                          <UploadRegionMap stats={currentRegionStats} />
                        )}
                      </>
                    ) : (
                      <div className="bg-white rounded-lg shadow p-6 text-center text-sm text-gray-400">
                        구역/지도 데이터가 없습니다
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
