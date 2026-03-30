'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Driver {
  id: string
  teamCode: string
  teamName: string
  route: string
  status: string
  contractEndDate: string | null
  createdAt: string
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '정상',
  SUSPENDED: '배차정지',
  CONTRACT_ENDED: '계약종료',
  ON_LEAVE: '휴무',
}

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  SUSPENDED: 'bg-red-100 text-red-700',
  CONTRACT_ENDED: 'bg-gray-100 text-gray-600',
  ON_LEAVE: 'bg-yellow-100 text-yellow-700',
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(false)
  const [filterRoute, setFilterRoute] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ teamCode: '', teamName: '', route: '0601' })
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState('')

  const fetchDrivers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterRoute) params.set('route', filterRoute)
      if (filterStatus) params.set('status', filterStatus)
      const res = await fetch(`/api/drivers?${params}`)
      const data = await res.json()
      setDrivers(Array.isArray(data) ? data : [])
    } catch {
      setDrivers([])
    } finally {
      setLoading(false)
    }
  }, [filterRoute, filterStatus])

  useEffect(() => {
    fetchDrivers()
  }, [fetchDrivers])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    setMessage('')
    try {
      const res = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMessage('기사 등록 완료!')
      setAddForm({ teamCode: '', teamName: '', route: '0601' })
      setShowAddForm(false)
      fetchDrivers()
    } catch (err: unknown) {
      setMessage(`오류: ${err instanceof Error ? err.message : '등록 실패'}`)
    } finally {
      setAdding(false)
    }
  }

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const res = await fetch('/api/drivers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) throw new Error('상태 변경 실패')
      fetchDrivers()
    } catch (err) {
      alert(err instanceof Error ? err.message : '오류')
    }
  }

  const activeCount = drivers.filter(d => d.status === 'ACTIVE').length
  const suspendedCount = drivers.filter(d => d.status === 'SUSPENDED').length

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-red-700 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-red-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">기사 관리</h1>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-gray-700">{drivers.length}</div>
            <div className="text-xs text-gray-500 mt-1">전체 기사</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{activeCount}</div>
            <div className="text-xs text-gray-500 mt-1">정상 운영</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-red-600">{suspendedCount}</div>
            <div className="text-xs text-gray-500 mt-1">배차 정지</div>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-4 items-end justify-between">
          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-gray-500 mb-1">권역</label>
              <select
                value={filterRoute}
                onChange={e => setFilterRoute(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm"
              >
                <option value="">전체</option>
                <option value="0601">서귀포 (0601)</option>
                <option value="0602">제주시 (0602)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">상태</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm"
              >
                <option value="">전체</option>
                <option value="ACTIVE">정상</option>
                <option value="SUSPENDED">배차정지</option>
                <option value="CONTRACT_ENDED">계약종료</option>
                <option value="ON_LEAVE">휴무</option>
              </select>
            </div>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700"
          >
            + 기사 등록
          </button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-6 border-l-4 border-red-500">
            <h3 className="font-semibold text-gray-700 mb-4">신규 기사 등록</h3>
            <form onSubmit={handleAdd} className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">팀코드 *</label>
                <input
                  type="text"
                  value={addForm.teamCode}
                  onChange={e => setAddForm(f => ({ ...f, teamCode: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm w-32"
                  placeholder="예: T001"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">팀명 *</label>
                <input
                  type="text"
                  value={addForm.teamName}
                  onChange={e => setAddForm(f => ({ ...f, teamName: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm w-40"
                  placeholder="홍길동팀"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">권역 *</label>
                <select
                  value={addForm.route}
                  onChange={e => setAddForm(f => ({ ...f, route: e.target.value }))}
                  className="border rounded px-3 py-2 text-sm"
                  required
                >
                  <option value="0601">서귀포 (0601)</option>
                  <option value="0602">제주시 (0602)</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={adding}
                className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {adding ? '등록 중...' : '등록'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="border px-4 py-2 rounded text-sm text-gray-600 hover:bg-gray-50"
              >
                취소
              </button>
            </form>
            {message && (
              <p className={`mt-3 text-sm ${message.startsWith('오류') ? 'text-red-600' : 'text-green-600'}`}>
                {message}
              </p>
            )}
          </div>
        )}

        {/* Drivers Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">로딩 중...</div>
          ) : drivers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              기사 데이터가 없습니다. 위에서 기사를 등록해주세요.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs text-gray-500">팀코드</th>
                    <th className="px-4 py-3 text-left text-xs text-gray-500">팀명</th>
                    <th className="px-4 py-3 text-center text-xs text-gray-500">권역</th>
                    <th className="px-4 py-3 text-center text-xs text-gray-500">상태</th>
                    <th className="px-4 py-3 text-center text-xs text-gray-500">계약종료일</th>
                    <th className="px-4 py-3 text-center text-xs text-gray-500">상태 변경</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d, i) => (
                    <tr key={d.id} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="px-4 py-2 font-mono text-xs">{d.teamCode}</td>
                      <td className="px-4 py-2 font-medium">{d.teamName}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs ${d.route === '0601' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                          {d.route === '0601' ? '서귀포' : '제주시'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASSES[d.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[d.status] || d.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center text-xs text-gray-500">
                        {d.contractEndDate
                          ? new Date(d.contractEndDate).toLocaleDateString('ko-KR')
                          : '-'}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <select
                          value={d.status}
                          onChange={e => handleStatusChange(d.id, e.target.value)}
                          className="border rounded px-2 py-1 text-xs"
                        >
                          <option value="ACTIVE">정상</option>
                          <option value="SUSPENDED">배차정지</option>
                          <option value="CONTRACT_ENDED">계약종료</option>
                          <option value="ON_LEAVE">휴무</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
