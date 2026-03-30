'use client'

import { useState } from 'react'
import Link from 'next/link'

interface CompareRow {
  teamCode: string
  teamName: string
  route: string
  prevCount: number
  confirmedCount: number | null
  maintainRate: number | null
}

export default function DeliveryComparePage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [data, setData] = useState<CompareRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchData = async () => {
    setLoading(true)
    setError('')
    try {
      // Fetch dispatches for the date
      const res = await fetch(`/api/dispatch/priority?date=${date}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '조회 실패')
      // For now show eligible drivers with their scores
      const rows: CompareRow[] = (json.eligible || []).map((d: { teamCode: string; teamName: string; route: string }) => ({
        teamCode: d.teamCode,
        teamName: d.teamName,
        route: d.route,
        prevCount: 0,
        confirmedCount: null,
        maintainRate: null,
      }))
      setData(rows)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류 발생')
    } finally {
      setLoading(false)
    }
  }

  const totalPrev = data.reduce((sum, r) => sum + r.prevCount, 0)
  const totalConfirmed = data.reduce((sum, r) => sum + (r.confirmedCount || 0), 0)
  const overallRate = totalPrev > 0 ? (totalConfirmed / totalPrev * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-indigo-700 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-indigo-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">납기 비교</h1>
        <span className="text-indigo-200 text-sm">전일 배차 vs 익일 확정</span>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* Filter */}
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">기준 날짜</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? '조회 중...' : '조회'}
          </button>
        </div>

        {/* Formula explanation */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-indigo-800 mb-2 text-sm">계산 공식</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-indigo-700">
            <div className="bg-white rounded p-3 border border-indigo-100">
              <strong>납기유지율</strong> = 익일확정 ÷ 전일배차 × 100
              <div className="text-xs text-indigo-500 mt-1">전일 배차된 건 중 익일에도 확정된 비율</div>
            </div>
            <div className="bg-white rounded p-3 border border-indigo-100">
              <strong>납기확정률</strong> = 익일확정 ÷ 전일배차 × 100
              <div className="text-xs text-indigo-500 mt-1">가중치: 15%</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {data.length > 0 && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-lg shadow p-4 text-center">
                <div className="text-2xl font-bold text-gray-700">{totalPrev}</div>
                <div className="text-xs text-gray-500 mt-1">전일 배차 합계</div>
              </div>
              <div className="bg-white rounded-lg shadow p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{totalConfirmed}</div>
                <div className="text-xs text-gray-500 mt-1">익일 확정 합계</div>
              </div>
              <div className="bg-white rounded-lg shadow p-4 text-center">
                <div className={`text-2xl font-bold ${overallRate >= 90 ? 'text-green-600' : overallRate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {overallRate.toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500 mt-1">전체 납기유지율</div>
              </div>
            </div>

            {/* Comparison Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="p-4 border-b bg-indigo-50">
                <h2 className="font-semibold text-indigo-800">팀별 납기 비교</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs text-gray-500">팀코드</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-500">팀명</th>
                      <th className="px-4 py-3 text-center text-xs text-gray-500">권역</th>
                      <th className="px-4 py-3 text-right text-xs text-gray-500">전일 배차</th>
                      <th className="px-4 py-3 text-right text-xs text-gray-500">익일 확정</th>
                      <th className="px-4 py-3 text-right text-xs text-gray-500">납기유지율</th>
                      <th className="px-4 py-3 text-right text-xs text-gray-500">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, i) => {
                      const rate = row.maintainRate
                      return (
                        <tr key={row.teamCode} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                          <td className="px-4 py-2 font-mono text-xs">{row.teamCode}</td>
                          <td className="px-4 py-2">{row.teamName}</td>
                          <td className="px-4 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs ${row.route === '0601' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                              {row.route === '0601' ? '서귀포' : '제주시'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">{row.prevCount}</td>
                          <td className="px-4 py-2 text-right">{row.confirmedCount ?? '-'}</td>
                          <td className="px-4 py-2 text-right">
                            {rate !== null ? (
                              <span className={`font-medium ${rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {rate.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {rate === null ? (
                              <span className="text-xs text-gray-400">미입력</span>
                            ) : rate >= 90 ? (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">양호</span>
                            ) : rate >= 70 ? (
                              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">보통</span>
                            ) : (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">미달</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {data.length === 0 && !loading && !error && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            날짜를 선택하고 조회 버튼을 눌러주세요.
          </div>
        )}
      </main>
    </div>
  )
}
