'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'

const RegionMap = dynamic(() => import('@/components/RegionMap'), { ssr: false })

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

interface RegionStatsResp {
  from: string
  to: string
  uploadType: string
  driverName: string | null
  total: Record<RegionCode, number>
  byDriver: Array<{ driverName: string; counts: Record<RegionCode, number>; sum: number }>
  byZipcode: ZipcodePoint[]
  regionOrder: RegionCode[]
  regionNames: Record<RegionCode, string>
}

const REGION_BG: Record<RegionCode, string> = {
  A: 'bg-emerald-100 text-emerald-800',
  B: 'bg-sky-100 text-sky-800',
  C: 'bg-violet-100 text-violet-800',
  D: 'bg-amber-100 text-amber-800',
  E: 'bg-rose-100 text-rose-800',
  UNKNOWN: 'bg-gray-100 text-gray-600',
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoStr(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export default function RegionDashboardPage() {
  const [from, setFrom] = useState(daysAgoStr(30))
  const [to, setTo] = useState(todayStr())
  const [driverName, setDriverName] = useState('')
  const [uploadType, setUploadType] = useState<'PREV_DELIVERY' | 'SAME_DAY_DELIVERY'>('PREV_DELIVERY')
  const [data, setData] = useState<RegionStatsResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [driverFilter, setDriverFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ from, to, uploadType })
      if (driverName) qs.set('driverName', driverName)
      const res = await fetch(`/api/delivery/region-stats?${qs.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '조회 실패')
      setData(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '오류')
    } finally {
      setLoading(false)
    }
  }, [from, to, driverName, uploadType])

  useEffect(() => { load() }, [load])

  const totalSum = data ? data.regionOrder.reduce((s, r) => s + (data.total[r] ?? 0), 0) : 0

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">🗺 구역별 누적 분포</h1>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700">← 납기 업로드로</Link>
        </div>

        {/* 필터 */}
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-600 mb-1">시작일</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">종료일</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">납기 유형</label>
              <select value={uploadType} onChange={e => setUploadType(e.target.value as 'PREV_DELIVERY' | 'SAME_DAY_DELIVERY')}
                className="w-full border rounded px-2 py-1.5 text-sm">
                <option value="PREV_DELIVERY">전일 납기</option>
                <option value="SAME_DAY_DELIVERY">당일 납기</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">기사 (선택)</label>
              <input type="text" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="비우면 전체"
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => { setFrom(daysAgoStr(7)); setTo(todayStr()) }} className="px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded">7일</button>
              <button onClick={() => { setFrom(daysAgoStr(30)); setTo(todayStr()) }} className="px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded">30일</button>
              <button onClick={() => { setFrom(daysAgoStr(90)); setTo(todayStr()) }} className="px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded">90일</button>
              <button onClick={load} className="ml-auto px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">조회</button>
            </div>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-4">{error}</div>}
        {loading && <div className="text-center text-sm text-gray-500 py-8">조회 중...</div>}

        {data && !loading && (
          <>
            {/* 전체 분포 */}
            <div className="bg-white rounded-lg shadow p-4 mb-4">
              <div className="flex justify-between items-baseline mb-3">
                <h3 className="font-semibold text-sm">전체 분포 ({totalSum}건)</h3>
                <span className="text-xs text-gray-500">{from} ~ {to}</span>
              </div>
              <div className="flex gap-1 h-8 rounded overflow-hidden mb-3">
                {data.regionOrder.map(r => {
                  const cnt = data.total[r] ?? 0
                  if (cnt === 0 || totalSum === 0) return null
                  const pct = (cnt / totalSum) * 100
                  return (
                    <div key={r} className={`${REGION_BG[r]} flex items-center justify-center text-xs font-medium`}
                      style={{ width: `${pct}%` }}
                      title={`${r}구역: ${cnt}건 (${pct.toFixed(1)}%)`}>
                      {pct >= 8 ? `${r} ${cnt}` : ''}
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-6 gap-2 text-xs">
                {data.regionOrder.map(r => (
                  <div key={r} className={`${REGION_BG[r]} rounded p-2 text-center`}>
                    <div className="font-semibold">{r}구역</div>
                    <div className="text-[10px] opacity-75">{data.regionNames[r]}</div>
                    <div className="text-base font-bold mt-0.5">{data.total[r] ?? 0}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 지도 */}
            {data.byZipcode.length > 0 && (
              <div className="bg-white rounded-lg shadow p-4 mb-4">
                <h3 className="font-semibold text-sm mb-3">🗺 지도 분포 ({data.byZipcode.length} 우편번호 / {data.byZipcode.reduce((s, p) => s + p.count, 0)}건)</h3>
                <RegionMap points={data.byZipcode} height={500} driverFilter={driverName || undefined} />
              </div>
            )}

            {/* 기사별 누적 표 */}
            {data.byDriver.length > 0 && (
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm">기사별 구역 누적 ({data.byDriver.length}명)</h3>
                  <input type="text" placeholder="기사명 검색"
                    value={driverFilter} onChange={e => setDriverFilter(e.target.value)}
                    className="border rounded px-2 py-1 text-xs w-40" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border px-2 py-1.5 text-left sticky left-0 bg-gray-50">기사</th>
                        {data.regionOrder.map(r => (
                          <th key={r} className="border px-2 py-1.5 text-center w-14">
                            <span className={`inline-block px-1.5 py-0.5 rounded ${REGION_BG[r]}`}>{r}</span>
                          </th>
                        ))}
                        <th className="border px-2 py-1.5 text-center w-14 bg-gray-100">합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byDriver
                        .filter(d => !driverFilter || d.driverName.includes(driverFilter))
                        .map(d => (
                          <tr key={d.driverName} className="hover:bg-gray-50">
                            <td className="border px-2 py-1 font-medium sticky left-0 bg-white">{d.driverName}</td>
                            {data.regionOrder.map(r => {
                              const c = d.counts[r] ?? 0
                              const pct = d.sum > 0 ? (c / d.sum) * 100 : 0
                              return (
                                <td key={r} className="border px-1 py-1 text-center">
                                  {c > 0 ? (
                                    <div>
                                      <div className="font-semibold">{c}</div>
                                      <div className="text-[10px] text-gray-500">{pct.toFixed(0)}%</div>
                                    </div>
                                  ) : <span className="text-gray-300">·</span>}
                                </td>
                              )
                            })}
                            <td className="border px-2 py-1 text-center font-bold bg-gray-50">{d.sum}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
