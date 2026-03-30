'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface DriverPriority {
  driverId: string
  teamCode: string
  teamName: string
  route: string
  baseScore: number
  circularBonus: number
  totalScore: number
  consecutiveDaysWithoutDispatch: number
  isEligible: boolean
  ineligibleReason?: string
}

interface PriorityData {
  date: string
  eligible: DriverPriority[]
  ineligible: DriverPriority[]
  summary: {
    total: number
    eligible: number
    ineligible: number
    byArea: { '0601': number; '0602': number }
  }
}

export default function DispatchPage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [route, setRoute] = useState('')
  const [data, setData] = useState<PriorityData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchPriority = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ date })
      if (route) params.set('route', route)
      const res = await fetch(`/api/dispatch/priority?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '조회 실패')
      setData(json)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류 발생')
    } finally {
      setLoading(false)
    }
  }, [date, route])

  useEffect(() => {
    fetchPriority()
  }, [fetchPriority])

  const getRouteName = (routeCode: string) => routeCode === '0601' ? '서귀포' : '제주시'
  const getRouteBadgeClass = (routeCode: string) =>
    routeCode === '0601'
      ? 'bg-orange-100 text-orange-700'
      : 'bg-blue-100 text-blue-700'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-blue-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">배차 대시보드</h1>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">배차 날짜</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">권역 필터</label>
            <select
              value={route}
              onChange={e => setRoute(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="">전체 권역</option>
              <option value="0601">서귀포 (0601)</option>
              <option value="0602">제주시 (0602)</option>
            </select>
          </div>
          <button
            onClick={fetchPriority}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '계산 중...' : '우선순위 계산'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-700">
            {error} — 데이터베이스가 연결되어 있는지 확인해주세요.
          </div>
        )}

        {/* Summary Cards */}
        {data?.summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <div className="text-2xl font-bold text-gray-700">{data.summary.total}</div>
              <div className="text-xs text-gray-500 mt-1">전체 팀</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{data.summary.eligible}</div>
              <div className="text-xs text-gray-500 mt-1">배차 가능</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <div className="text-2xl font-bold text-orange-500">{data.summary.byArea?.['0601'] || 0}</div>
              <div className="text-xs text-gray-500 mt-1">서귀포 (0601)</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{data.summary.byArea?.['0602'] || 0}</div>
              <div className="text-xs text-gray-500 mt-1">제주시 (0602)</div>
            </div>
          </div>
        )}

        {/* Priority Table - Eligible */}
        {data?.eligible && data.eligible.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
            <div className="p-4 border-b bg-green-50 flex items-center justify-between">
              <h2 className="font-semibold text-green-800">
                배차 가능 팀 — 우선순위 순 ({data.eligible.length}팀)
              </h2>
              <span className="text-xs text-green-600">높은 점수 = 높은 우선순위</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">순위</th>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">팀코드</th>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">팀명</th>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">권역</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">기본점수</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">순환보정</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">총점</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">미배차일</th>
                  </tr>
                </thead>
                <tbody>
                  {data.eligible.map((d, i) => (
                    <tr key={d.driverId} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                      <td className="px-4 py-2 font-medium text-blue-600">#{i + 1}</td>
                      <td className="px-4 py-2 font-mono text-xs">{d.teamCode}</td>
                      <td className="px-4 py-2 font-medium">{d.teamName}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getRouteBadgeClass(d.route)}`}>
                          {getRouteName(d.route)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">{d.baseScore.toFixed(1)}</td>
                      <td className="px-4 py-2 text-right text-green-600 font-medium">
                        {d.circularBonus > 0 ? `+${d.circularBonus}` : '-'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className="font-bold text-gray-800">{d.totalScore.toFixed(1)}</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {d.consecutiveDaysWithoutDispatch > 0 ? (
                          <span className={`font-medium ${d.consecutiveDaysWithoutDispatch >= 3 ? 'text-red-600' : 'text-orange-500'}`}>
                            {d.consecutiveDaysWithoutDispatch}일
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data?.eligible && data.eligible.length === 0 && !loading && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500 mb-6">
            배차 가능한 팀이 없습니다. 기사 데이터를 먼저 등록해주세요.
          </div>
        )}

        {/* Ineligible Table */}
        {data?.ineligible && data.ineligible.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-4 border-b bg-red-50">
              <h2 className="font-semibold text-red-800">
                배차 제외 팀 ({data.ineligible.length}팀)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">팀코드</th>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">팀명</th>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">권역</th>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">제외 사유</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ineligible.map((d, i) => (
                    <tr key={d.driverId} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="px-4 py-2 font-mono text-xs">{d.teamCode}</td>
                      <td className="px-4 py-2">{d.teamName}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${getRouteBadgeClass(d.route)}`}>
                          {getRouteName(d.route)}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">
                          {d.ineligibleReason}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
