'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Driver {
  id: string
  teamCode: string
  teamName: string
  route: string
  status: string
}

interface Performance {
  id: string
  driverId: string
  perfDate: string
  completionRate: number | null
  op2Score: number | null
  npsScore: number | null
  defectRate: number | null
  deliveryConfirmRate: number | null
  deliveryMaintainRate: number | null
  totalScore: number | null
  driver: Driver
}

export default function PerformancePage() {
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [selected, setSelected] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [form, setForm] = useState({
    completionRate: '',
    op2Score: '',
    npsScore: '',
    defectRate: '',
    deliveryConfirmRate: '',
    deliveryMaintainRate: '',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [recentPerfs, setRecentPerfs] = useState<Performance[]>([])
  const [loadingPerfs, setLoadingPerfs] = useState(false)

  useEffect(() => {
    fetch('/api/drivers?status=ACTIVE')
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setDrivers(data) : setDrivers([]))
      .catch(() => setDrivers([]))
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoadingPerfs(true)
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    fetch(`/api/performance?driverId=${selected}&startDate=${startDate}&endDate=${endDate}`)
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setRecentPerfs(data.slice(0, 10)) : setRecentPerfs([]))
      .catch(() => setRecentPerfs([]))
      .finally(() => setLoadingPerfs(false))
  }, [selected])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return

    setSaving(true)
    setMessage('')

    try {
      const res = await fetch('/api/performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId: selected,
          perfDate: date,
          completionRate: form.completionRate ? parseFloat(form.completionRate) : undefined,
          op2Score: form.op2Score ? parseFloat(form.op2Score) : undefined,
          npsScore: form.npsScore ? parseFloat(form.npsScore) : undefined,
          defectRate: form.defectRate ? parseFloat(form.defectRate) : undefined,
          deliveryConfirmRate: form.deliveryConfirmRate ? parseFloat(form.deliveryConfirmRate) : undefined,
          deliveryMaintainRate: form.deliveryMaintainRate ? parseFloat(form.deliveryMaintainRate) : undefined,
        }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMessage('저장 완료!')
      setForm({ completionRate: '', op2Score: '', npsScore: '', defectRate: '', deliveryConfirmRate: '', deliveryMaintainRate: '' })
      // Refresh recent performances
      const endDate = new Date().toISOString().split('T')[0]
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      fetch(`/api/performance?driverId=${selected}&startDate=${startDate}&endDate=${endDate}`)
        .then(r => r.json())
        .then(data => Array.isArray(data) ? setRecentPerfs(data.slice(0, 10)) : setRecentPerfs([]))
    } catch (err: unknown) {
      setMessage(`오류: ${err instanceof Error ? err.message : '저장 실패'}`)
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { key: 'completionRate', label: '완료율 (%)', weight: '30%', hint: '실제완료/기준배차×100' },
    { key: 'deliveryConfirmRate', label: '납기확정률 (%)', weight: '15%', hint: '익일확정/전일배차×100' },
    { key: 'deliveryMaintainRate', label: '납기유지율 (%)', weight: '15%', hint: '익일확정/전일배차×100' },
    { key: 'op2Score', label: 'OP2 점수', weight: '15%', hint: '0-100' },
    { key: 'npsScore', label: 'NPS 점수', weight: '10%', hint: '0-100' },
    { key: 'defectRate', label: '불량률 (%)', weight: '10%', hint: '낮을수록 좋음' },
  ] as const

  const selectedDriver = drivers.find(d => d.id === selected)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-yellow-600 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-yellow-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">실적 입력</h1>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Input Form */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="font-semibold text-gray-700 mb-4">실적 입력</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">기사 선택 <span className="text-red-500">*</span></label>
                <select
                  value={selected}
                  onChange={e => setSelected(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  required
                >
                  <option value="">선택하세요</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>
                      [{d.teamCode}] {d.teamName} ({d.route === '0601' ? '서귀포' : '제주시'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">실적 날짜 <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  required
                />
              </div>

              <div className="space-y-3">
                {fields.map(({ key, label, weight, hint }) => (
                  <div key={key}>
                    <label className="block text-sm text-gray-600 mb-1">
                      {label}
                      <span className="ml-1 text-xs text-blue-500">({weight})</span>
                      <span className="ml-1 text-xs text-gray-400">— {hint}</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={form[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-sm"
                      placeholder="빈칸 = 미입력"
                    />
                  </div>
                ))}
              </div>

              {message && (
                <div className={`rounded p-3 text-sm ${message.startsWith('오류') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={saving || !selected}
                className="w-full bg-yellow-600 text-white py-2 rounded hover:bg-yellow-700 disabled:opacity-50 font-medium"
              >
                {saving ? '저장 중...' : '실적 저장'}
              </button>
            </form>
          </div>

          {/* Recent Performances */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="font-semibold text-gray-700 mb-4">
              최근 실적
              {selectedDriver && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  [{selectedDriver.teamCode}] {selectedDriver.teamName}
                </span>
              )}
            </h2>

            {!selected && (
              <div className="text-center text-gray-400 text-sm py-8">
                기사를 선택하면 최근 실적이 표시됩니다
              </div>
            )}

            {selected && loadingPerfs && (
              <div className="text-center text-gray-400 text-sm py-8">로딩 중...</div>
            )}

            {selected && !loadingPerfs && recentPerfs.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-8">
                최근 30일 실적이 없습니다
              </div>
            )}

            {recentPerfs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left text-gray-500">날짜</th>
                      <th className="px-2 py-1 text-right text-gray-500">완료율</th>
                      <th className="px-2 py-1 text-right text-gray-500">OP2</th>
                      <th className="px-2 py-1 text-right text-gray-500">NPS</th>
                      <th className="px-2 py-1 text-right text-gray-500">불량</th>
                      <th className="px-2 py-1 text-right text-gray-500">총점</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPerfs.map((p, i) => (
                      <tr key={p.id} className={`border-t ${i % 2 === 0 ? '' : 'bg-gray-50'}`}>
                        <td className="px-2 py-1 text-gray-600">
                          {new Date(p.perfDate).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                        </td>
                        <td className="px-2 py-1 text-right">{p.completionRate?.toFixed(1) ?? '-'}</td>
                        <td className="px-2 py-1 text-right">{p.op2Score?.toFixed(1) ?? '-'}</td>
                        <td className="px-2 py-1 text-right">{p.npsScore?.toFixed(1) ?? '-'}</td>
                        <td className="px-2 py-1 text-right">{p.defectRate?.toFixed(1) ?? '-'}</td>
                        <td className="px-2 py-1 text-right font-bold text-blue-600">
                          {p.totalScore?.toFixed(1) ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
