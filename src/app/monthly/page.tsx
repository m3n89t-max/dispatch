'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { ZipcodePoint } from '@/components/RegionMap'

const RegionMap = dynamic(() => import('@/components/RegionMap'), { ssr: false })

interface DriverRow {
  driverName: string
  vehicleNo: string
  teamCode: string
  route: string
  cellName: string
  workDays: number
  maxConsecutive: number
  deliveryCount: number
  totalInstall: number
  wallMount: number
  stand: number
  homeMulti: number
  systemAc: number
  commercial: number
  moveInstall: number
  preVisit: number
  region: Record<string, number>
}

interface SummaryData {
  year: number
  month: number
  periodLabel?: string
  regionOrder: string[]
  regionNames: Record<string, string>
  drivers: DriverRow[]
  totals: {
    driverCount: number
    workDateCount: number
    deliveryCount: number
    totalInstall: number
    wallMount: number
    stand: number
    homeMulti: number
    systemAc: number
    commercial: number
    moveInstall: number
    preVisit: number
    region: Record<string, number>
  }
}

const n = (v: number) => (v > 0 ? v : <span className="text-gray-300">-</span>)

export default function MonthlyPage() {
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [route, setRoute] = useState('')
  const [mode, setMode] = useState<'month' | 'range'>('month')
  const [startDate, setStartDate] = useState(monthStartStr)
  const [endDate, setEndDate] = useState(todayStr)
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 기사 클릭 → 지도 분포
  const [expanded, setExpanded] = useState<string | null>(null)
  const [mapPoints, setMapPoints] = useState<ZipcodePoint[] | null>(null)
  const [mapLoading, setMapLoading] = useState(false)

  const handleClickDriver = async (driverName: string) => {
    if (expanded === driverName) { setExpanded(null); setMapPoints(null); return }
    setExpanded(driverName)
    setMapPoints(null)
    setMapLoading(true)
    try {
      const res = await fetch(`/api/monthly/driver-map?year=${year}&month=${month}&driverName=${encodeURIComponent(driverName)}`)
      const json = await res.json()
      setMapPoints(json.points ?? [])
    } catch {
      setMapPoints([])
    } finally {
      setMapLoading(false)
    }
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (mode === 'range' && startDate && endDate) {
        params.set('start', startDate); params.set('end', endDate)
      } else {
        params.set('year', String(year)); params.set('month', String(month))
      }
      if (route) params.set('route', route)
      const res = await fetch(`/api/monthly/summary?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '조회 실패')
      setData(json)
      setExpanded(null)
      setMapPoints(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류 발생')
    } finally {
      setLoading(false)
    }
  }, [year, month, route, mode, startDate, endDate])

  useEffect(() => { fetchData() }, [fetchData])

  const t = data?.totals
  const regionOrder = data?.regionOrder ?? ['A', 'B', 'C', 'D', 'E']
  const regionNames = data?.regionNames ?? {}

  const pctOf = (v: number, base: number) => (base > 0 ? (v / base) * 100 : 0)
  const Card = ({ label, value, cls, pct }: { label: string; value: number; cls?: string; pct?: number }) => (
    <div className={`rounded-xl border p-3 text-center ${cls ?? 'bg-slate-50 text-slate-700 border-slate-200'}`}>
      <div className="text-2xl font-bold leading-none tabular-nums">{value}</div>
      {pct !== undefined && <div className="text-[11px] font-semibold opacity-70 tabular-nums mt-0.5">{pct.toFixed(1)}%</div>}
      <div className="text-xs mt-1 font-medium opacity-80">{label}</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-purple-700 text-white p-4 flex items-center gap-4 print:hidden">
        <Link href="/" className="text-purple-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">월별 집계 보고서</h1>
        <span className="text-purple-200 text-sm">업로드된 배차 기준</span>
      </header>

      <main className="max-w-[1680px] mx-auto p-4 md:p-6 lg:px-8">
        {/* 필터 */}
        <div className="bg-white rounded-lg shadow p-4 mb-5 flex flex-wrap gap-4 items-end print:hidden">
          <div>
            <label className="block text-sm text-gray-600 mb-1">집계 단위</label>
            <div className="flex rounded border overflow-hidden text-sm">
              <button type="button" onClick={() => setMode('month')} className={`px-3 py-2 ${mode === 'month' ? 'bg-purple-600 text-white' : 'bg-white text-gray-600'}`}>월별</button>
              <button type="button" onClick={() => setMode('range')} className={`px-3 py-2 border-l ${mode === 'range' ? 'bg-purple-600 text-white' : 'bg-white text-gray-600'}`}>기간(달력)</button>
            </div>
          </div>
          {mode === 'month' ? (
            <>
              <div>
                <label className="block text-sm text-gray-600 mb-1">년도</label>
                <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="border rounded px-3 py-2 text-sm">
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}년</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">월</label>
                <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="border rounded px-3 py-2 text-sm">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm text-gray-600 mb-1">시작일</label>
                <input type="date" value={startDate} max={endDate} onChange={e => setStartDate(e.target.value)} className="border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">종료일</label>
                <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className="border rounded px-3 py-2 text-sm" />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm text-gray-600 mb-1">권역</label>
            <select value={route} onChange={e => setRoute(e.target.value)} className="border rounded px-3 py-2 text-sm">
              <option value="">전체</option>
              <option value="0601">서귀포 (0601)</option>
              <option value="0602">제주시 (0602)</option>
            </select>
          </div>
          <button onClick={fetchData} disabled={loading} className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:opacity-50">
            {loading ? '조회 중...' : '조회'}
          </button>
          <button onClick={() => window.print()} className="bg-gray-700 text-white px-4 py-2 rounded text-sm hover:bg-gray-800 ml-auto">
            🖨 인쇄 / PDF 저장
          </button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-700 print:hidden">{error}</div>}

        {data && (
          <div className="bg-white rounded-lg shadow p-6 print:shadow-none print:p-0">
            {/* 보고서 헤더 */}
            <div className="text-center mb-5 border-b pb-4">
              <h2 className="text-2xl font-bold text-gray-800">제주 배차 월별 집계 보고서</h2>
              <p className="text-gray-500 mt-1">
                {data.periodLabel ?? `${data.year}년 ${data.month}월`}
                {route && ` · ${route === '0601' ? '서귀포' : '제주시'}`}
                {' · '}작업일 {t?.workDateCount ?? 0}일 · 기사 {t?.driverCount ?? 0}팀
              </p>
              <p className="text-xs text-gray-400 mt-1">생성일 {new Date().toLocaleString('ko-KR')}</p>
            </div>

            {/* 총괄 요약 */}
            {t && (
              <div className="space-y-3 mb-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <Card label="총 배송(건)" value={t.deliveryCount} />
                  <Card label="총 설치(대)" value={t.totalInstall} cls="bg-green-50 text-green-700 border-green-200" />
                  <Card label="투입 기사(팀)" value={t.driverCount} />
                  <Card label="작업일수" value={t.workDateCount} />
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1.5 font-medium">모델별 합계 (설치대수 대비 %)</div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                    <Card label="벽걸이" value={t.wallMount} pct={pctOf(t.wallMount, t.totalInstall)} cls="bg-blue-50 text-blue-700 border-blue-200" />
                    <Card label="스탠드" value={t.stand} pct={pctOf(t.stand, t.totalInstall)} cls="bg-green-50 text-green-700 border-green-200" />
                    <Card label="홈멀티" value={t.homeMulti} pct={pctOf(t.homeMulti, t.totalInstall)} cls="bg-purple-50 text-purple-700 border-purple-200" />
                    <Card label="시스템" value={t.systemAc} pct={pctOf(t.systemAc, t.totalInstall)} cls="bg-gray-50 text-gray-700 border-gray-200" />
                    <Card label="업소용" value={t.commercial} pct={pctOf(t.commercial, t.totalInstall)} cls="bg-pink-50 text-pink-700 border-pink-200" />
                    <Card label="이전설치" value={t.moveInstall} pct={pctOf(t.moveInstall, t.totalInstall)} cls="bg-amber-50 text-amber-700 border-amber-200" />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1.5 font-medium">구역별 합계 (배송건 대비 %)</div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                    {regionOrder.map(r => (
                      <Card key={r} label={`${r === 'UNKNOWN' ? '미분류' : r + ' ' + (regionNames[r] ?? '')}`} value={t.region[r] ?? 0} pct={pctOf(t.region[r] ?? 0, t.deliveryCount)} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 기사별 표 */}
            {data.drivers.length === 0 ? (
              <div className="text-center text-gray-500 py-10">해당 월에 업로드된 배차 데이터가 없습니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <h3 className="font-semibold text-base text-gray-800 mb-2">기사별 집계</h3>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-xs">
                      <th className="border px-2 py-2">#</th>
                      <th className="border px-2 py-2 text-left">기사명</th>
                      <th className="border px-2 py-2 text-left text-gray-500">차량</th>
                      <th className="border px-2 py-2 text-center">권역</th>
                      <th className="border px-2 py-2 text-center">셀</th>
                      <th className="border px-2 py-2 text-right">근무일수</th>
                      <th className="border px-2 py-2 text-right">연속근무</th>
                      <th className="border px-2 py-2 text-right">배송건</th>
                      <th className="border px-2 py-2 text-right font-bold">설치대수</th>
                      <th className="border px-2 py-2 text-right text-gray-500">비중%</th>
                      <th className="border px-2 py-2 text-center">벽걸이</th>
                      <th className="border px-2 py-2 text-center">스탠드</th>
                      <th className="border px-2 py-2 text-center">홈멀티</th>
                      <th className="border px-2 py-2 text-center">시스템</th>
                      <th className="border px-2 py-2 text-center">업소용</th>
                      <th className="border px-2 py-2 text-center">이전</th>
                      {regionOrder.map(r => (
                        <th key={r} className="border px-2 py-2 text-center w-10" title={regionNames[r]}>{r === 'UNKNOWN' ? '미' : r}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.drivers.map((d, i) => {
                      const isOpen = expanded === d.driverName
                      const colCount = 16 + regionOrder.length
                      return (
                      <Fragment key={d.driverName + i}>
                      <tr className={`${isOpen ? 'bg-purple-50' : i % 2 === 0 ? '' : 'bg-gray-50'}`}>
                        <td className="border px-2 py-1.5 text-center text-gray-400">{i + 1}</td>
                        <td className="border px-2 py-1.5 font-medium">
                          <button
                            type="button"
                            onClick={() => handleClickDriver(d.driverName)}
                            className="text-purple-700 hover:text-purple-900 hover:underline inline-flex items-center gap-1 print:no-underline print:text-black"
                            title="지도 분포 보기"
                          >
                            <span className="text-xs text-gray-400 print:hidden">{isOpen ? '▼' : '▶'}</span>
                            {d.driverName}
                          </button>
                        </td>
                        <td className="border px-2 py-1.5 text-xs text-gray-400 font-mono">{d.vehicleNo || '-'}</td>
                        <td className="border px-2 py-1.5 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${d.route === '0601' ? 'bg-orange-100 text-orange-700' : d.route === '0602' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                            {d.route === '0601' ? '서귀포' : d.route === '0602' ? '제주시' : '-'}
                          </span>
                        </td>
                        <td className="border px-2 py-1.5 text-center text-xs text-gray-500">{d.cellName || '-'}</td>
                        <td className="border px-2 py-1.5 text-right">{d.workDays}</td>
                        <td className="border px-2 py-1.5 text-right">{d.maxConsecutive >= 7 ? <span className="text-red-600 font-semibold">{d.maxConsecutive}</span> : d.maxConsecutive}</td>
                        <td className="border px-2 py-1.5 text-right text-gray-600">{d.deliveryCount}</td>
                        <td className="border px-2 py-1.5 text-right font-bold text-green-700">{d.totalInstall}</td>
                        <td className="border px-2 py-1.5 text-right text-gray-500 tabular-nums">{t ? pctOf(d.totalInstall, t.totalInstall).toFixed(1) : '0.0'}%</td>
                        <td className="border px-2 py-1.5 text-center text-blue-600">{n(d.wallMount)}</td>
                        <td className="border px-2 py-1.5 text-center text-green-600">{n(d.stand)}</td>
                        <td className="border px-2 py-1.5 text-center text-purple-600">{n(d.homeMulti)}</td>
                        <td className="border px-2 py-1.5 text-center text-gray-600">{n(d.systemAc)}</td>
                        <td className="border px-2 py-1.5 text-center text-pink-600">{n(d.commercial)}</td>
                        <td className="border px-2 py-1.5 text-center text-amber-600">{n(d.moveInstall)}</td>
                        {regionOrder.map(r => (
                          <td key={r} className="border px-1 py-1.5 text-center text-xs">{d.region[r] ? d.region[r] : <span className="text-gray-300">·</span>}</td>
                        ))}
                      </tr>
                      {isOpen && (
                        <tr className="print:hidden">
                          <td colSpan={colCount} className="border bg-purple-50/30 p-3">
                            <div className="text-xs text-gray-600 mb-2">
                              🗺 <b>{d.driverName}</b> ({d.vehicleNo}) — {data.month}월 배송 분포 · 설치 {d.totalInstall}대 / 배송 {d.deliveryCount}건
                            </div>
                            {mapLoading ? (
                              <div className="text-center text-sm text-gray-400 py-6">지도 로딩 중...</div>
                            ) : mapPoints && mapPoints.length > 0 ? (
                              <RegionMap points={mapPoints} height={460} />
                            ) : (
                              <div className="text-center text-sm text-gray-400 py-6">표시할 위치(우편번호/주소)가 없습니다.</div>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      )
                    })}
                  </tbody>
                  {t && (
                    <tfoot>
                      <tr className="bg-purple-50 font-bold text-sm">
                        <td className="border px-2 py-2 text-center" colSpan={5}>합계 ({t.driverCount}팀)</td>
                        <td className="border px-2 py-2 text-right text-gray-400">-</td>
                        <td className="border px-2 py-2 text-right text-gray-400">-</td>
                        <td className="border px-2 py-2 text-right">{t.deliveryCount}</td>
                        <td className="border px-2 py-2 text-right text-green-700">{t.totalInstall}</td>
                        <td className="border px-2 py-2 text-right text-gray-500">100%</td>
                        <td className="border px-2 py-2 text-center text-blue-600">{t.wallMount || '-'}</td>
                        <td className="border px-2 py-2 text-center text-green-600">{t.stand || '-'}</td>
                        <td className="border px-2 py-2 text-center text-purple-600">{t.homeMulti || '-'}</td>
                        <td className="border px-2 py-2 text-center text-gray-600">{t.systemAc || '-'}</td>
                        <td className="border px-2 py-2 text-center text-pink-600">{t.commercial || '-'}</td>
                        <td className="border px-2 py-2 text-center text-amber-600">{t.moveInstall || '-'}</td>
                        {regionOrder.map(r => (
                          <td key={r} className="border px-1 py-2 text-center text-xs">{t.region[r] || '-'}</td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
                <p className="text-xs text-gray-400 mt-2">
                  ※ 연속근무 7일 이상은 빨강 표시(안전 경고). 설치대수 = 실내기 기준(Qty 반영), 이전설치 포함. 구역 = 우편번호 기준 A~E.
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
