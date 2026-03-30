'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface MonthlyStats {
  driver: {
    id: string
    teamCode: string
    teamName: string
    route: string
  }
  perfCount: number
  avgCompletionRate: number
  avgOp2Score: number
  avgNpsScore: number
  avgDefectRate: number
  avgDeliveryConfirmRate: number
  avgDeliveryMaintainRate: number
  avgTotalScore: number
}

interface MonthlyData {
  year: number
  month: number
  driverCount: number
  stats: MonthlyStats[]
}

export default function MonthlyPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [route, setRoute] = useState('')
  const [data, setData] = useState<MonthlyData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchMonthly = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      if (route) params.set('route', route)
      const res = await fetch(`/api/monthly?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '조회 실패')
      setData(json)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류 발생')
    } finally {
      setLoading(false)
    }
  }, [year, month, route])

  useEffect(() => {
    fetchMonthly()
  }, [fetchMonthly])

  const fmt = (val: number) => val > 0 ? val.toFixed(1) : '-'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-purple-700 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-purple-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">월별 집계</h1>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">년도</label>
            <select
              value={year}
              onChange={e => setYear(parseInt(e.target.value))}
              className="border rounded px-3 py-2 text-sm"
            >
              {[2024, 2025, 2026].map(y => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">월</label>
            <select
              value={month}
              onChange={e => setMonth(parseInt(e.target.value))}
              className="border rounded px-3 py-2 text-sm"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{m}월</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">권역</label>
            <select
              value={route}
              onChange={e => setRoute(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="">전체</option>
              <option value="0601">서귀포 (0601)</option>
              <option value="0602">제주시 (0602)</option>
            </select>
          </div>
          <button
            onClick={fetchMonthly}
            disabled={loading}
            className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? '조회 중...' : '조회'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-700">
                {data.year}년 {data.month}월 실적 집계
              </h2>
              <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
                {data.driverCount}팀
              </span>
            </div>

            {data.stats.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                해당 월에 실적 데이터가 없습니다.
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs text-gray-500">순위</th>
                        <th className="px-4 py-3 text-left text-xs text-gray-500">팀코드</th>
                        <th className="px-4 py-3 text-left text-xs text-gray-500">팀명</th>
                        <th className="px-4 py-3 text-center text-xs text-gray-500">권역</th>
                        <th className="px-4 py-3 text-right text-xs text-gray-500">입력일수</th>
                        <th className="px-4 py-3 text-right text-xs text-blue-600">완료율(%)</th>
                        <th className="px-4 py-3 text-right text-xs text-gray-500">납기확정</th>
                        <th className="px-4 py-3 text-right text-xs text-gray-500">납기유지</th>
                        <th className="px-4 py-3 text-right text-xs text-gray-500">OP2</th>
                        <th className="px-4 py-3 text-right text-xs text-gray-500">NPS</th>
                        <th className="px-4 py-3 text-right text-xs text-red-500">불량률</th>
                        <th className="px-4 py-3 text-right text-xs text-purple-600 font-bold">총점</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.stats.map((s, i) => (
                        <tr
                          key={s.driver.id}
                          className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-purple-50 transition-colors`}
                        >
                          <td className="px-4 py-2 font-medium text-purple-600">#{i + 1}</td>
                          <td className="px-4 py-2 font-mono text-xs">{s.driver.teamCode}</td>
                          <td className="px-4 py-2 font-medium">{s.driver.teamName}</td>
                          <td className="px-4 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs ${s.driver.route === '0601' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                              {s.driver.route === '0601' ? '서귀포' : '제주시'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-gray-500">{s.perfCount}</td>
                          <td className="px-4 py-2 text-right text-blue-600">{fmt(s.avgCompletionRate)}</td>
                          <td className="px-4 py-2 text-right">{fmt(s.avgDeliveryConfirmRate)}</td>
                          <td className="px-4 py-2 text-right">{fmt(s.avgDeliveryMaintainRate)}</td>
                          <td className="px-4 py-2 text-right">{fmt(s.avgOp2Score)}</td>
                          <td className="px-4 py-2 text-right">{fmt(s.avgNpsScore)}</td>
                          <td className="px-4 py-2 text-right text-red-500">{fmt(s.avgDefectRate)}</td>
                          <td className="px-4 py-2 text-right">
                            <span className="font-bold text-purple-700 text-base">{fmt(s.avgTotalScore)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
