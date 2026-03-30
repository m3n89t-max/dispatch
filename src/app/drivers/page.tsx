'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Driver {
  id: string
  teamCode: string
  teamName: string
  route: string
  status: string
  center: string | null
  vehicleNumber: string | null
  vehicleType: string | null
  vehicleStructure: string | null
  cellName: string | null
  cellRole: string | null
  residency: string | null
  contractDone: boolean
  contractExpectedDate: string | null
  contractEndDate: string | null
  safetyEduDone: boolean
  safetyEduDate: string | null
  expertSecured: boolean
  expertExpectedDate: string | null
  expertRelation: string | null
  canSupportOther: boolean
  supportableCenters: string | null
}

const EMPTY_FORM: Omit<Driver, 'id' | 'status'> = {
  teamCode: '',
  teamName: '',
  route: '0602',
  center: '',
  vehicleNumber: '',
  vehicleType: '영업용',
  vehicleStructure: 'TOP',
  cellName: '',
  cellRole: '셀원',
  residency: '상주',
  contractDone: false,
  contractExpectedDate: '',
  contractEndDate: '',
  safetyEduDone: false,
  safetyEduDate: '',
  expertSecured: false,
  expertExpectedDate: '',
  expertRelation: '',
  canSupportOther: false,
  supportableCenters: '',
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

const yn = (v: boolean) => (v ? 'O' : 'X')
const dt = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '-'

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(false)
  const [filterRoute, setFilterRoute] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<Omit<Driver, 'id' | 'status'>>(EMPTY_FORM)
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

  useEffect(() => { fetchDrivers() }, [fetchDrivers])

  const set = (k: keyof typeof EMPTY_FORM, v: unknown) =>
    setAddForm(f => ({ ...f, [k]: v }))

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
      setAddForm(EMPTY_FORM)
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

  const inputCls = 'border rounded px-2 py-1.5 text-sm w-full'
  const selectCls = 'border rounded px-2 py-1.5 text-sm w-full'
  const labelCls = 'block text-xs text-gray-500 mb-1'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-red-700 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-red-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">기사 관리</h1>
      </header>

      <main className="max-w-full px-4 py-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-6 max-w-xl">
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
              <label className={labelCls}>권역</label>
              <select value={filterRoute} onChange={e => setFilterRoute(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
                <option value="">전체</option>
                <option value="0601">서귀포 (0601)</option>
                <option value="0602">제주시 (0602)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>상태</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
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
            <h3 className="font-semibold text-gray-700 mb-5">신규 기사 등록</h3>
            <form onSubmit={handleAdd}>
              {/* 기본 정보 */}
              <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">기본 정보</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
                <div>
                  <label className={labelCls}>센터</label>
                  <input type="text" value={addForm.center ?? ''} onChange={e => set('center', e.target.value)} className={inputCls} placeholder="제주" />
                </div>
                <div>
                  <label className={labelCls}>차량번호</label>
                  <input type="text" value={addForm.vehicleNumber ?? ''} onChange={e => set('vehicleNumber', e.target.value)} className={inputCls} placeholder="12가 3456" />
                </div>
                <div>
                  <label className={labelCls}>영업용구분</label>
                  <select value={addForm.vehicleType ?? '영업용'} onChange={e => set('vehicleType', e.target.value)} className={selectCls}>
                    <option value="영업용">영업용</option>
                    <option value="자가용">자가용</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>시퀀스ID *</label>
                  <input type="text" value={addForm.teamCode} onChange={e => set('teamCode', e.target.value)} className={inputCls} placeholder="001" required />
                </div>
                <div>
                  <label className={labelCls}>이름 *</label>
                  <input type="text" value={addForm.teamName} onChange={e => set('teamName', e.target.value)} className={inputCls} placeholder="홍길동" required />
                </div>
              </div>

              {/* 차량/셀 */}
              <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">차량 / 셀</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
                <div>
                  <label className={labelCls}>차량구조</label>
                  <select value={addForm.vehicleStructure ?? 'TOP'} onChange={e => set('vehicleStructure', e.target.value)} className={selectCls}>
                    <option value="TOP">TOP</option>
                    <option value="카고">카고</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>셀명</label>
                  <input type="text" value={addForm.cellName ?? ''} onChange={e => set('cellName', e.target.value)} className={inputCls} placeholder="명성셀" />
                </div>
                <div>
                  <label className={labelCls}>셀구분</label>
                  <select value={addForm.cellRole ?? '셀원'} onChange={e => set('cellRole', e.target.value)} className={selectCls}>
                    <option value="셀리더">셀리더</option>
                    <option value="셀원">셀원</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>상주여부</label>
                  <select value={addForm.residency ?? '상주'} onChange={e => set('residency', e.target.value)} className={selectCls}>
                    <option value="상주">상주</option>
                    <option value="비상주">비상주</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>권역 *</label>
                  <select value={addForm.route} onChange={e => set('route', e.target.value)} className={selectCls} required>
                    <option value="0601">서귀포 (0601)</option>
                    <option value="0602">제주시 (0602)</option>
                  </select>
                </div>
              </div>

              {/* 계약 */}
              <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">계약</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
                <div className="flex items-center gap-3 pt-5">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={addForm.contractDone} onChange={e => set('contractDone', e.target.checked)} className="w-4 h-4" />
                    계약완료
                  </label>
                </div>
                <div>
                  <label className={labelCls}>계약예상일시</label>
                  <input type="date" value={addForm.contractExpectedDate ?? ''} onChange={e => set('contractExpectedDate', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>계약종료일</label>
                  <input type="date" value={addForm.contractEndDate ?? ''} onChange={e => set('contractEndDate', e.target.value)} className={inputCls} />
                </div>
              </div>

              {/* 보수교육 */}
              <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">보수교육</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
                <div className="flex items-center gap-3 pt-5">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={addForm.safetyEduDone} onChange={e => set('safetyEduDone', e.target.checked)} className="w-4 h-4" />
                    보수교육완료
                  </label>
                </div>
                <div>
                  <label className={labelCls}>보수교육일시</label>
                  <input type="date" value={addForm.safetyEduDate ?? ''} onChange={e => set('safetyEduDate', e.target.value)} className={inputCls} />
                </div>
              </div>

              {/* 전문기사 */}
              <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">전문기사 (보조인력)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-5">
                <div className="flex items-center gap-3 pt-5">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={addForm.expertSecured} onChange={e => set('expertSecured', e.target.checked)} className="w-4 h-4" />
                    전문기사 확보
                  </label>
                </div>
                <div>
                  <label className={labelCls}>채용예상일시</label>
                  <input type="date" value={addForm.expertExpectedDate ?? ''} onChange={e => set('expertExpectedDate', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>전문기사 관계</label>
                  <input type="text" value={addForm.expertRelation ?? ''} onChange={e => set('expertRelation', e.target.value)} className={inputCls} placeholder="가족, 지인 등" />
                </div>
              </div>

              {/* 타센터 */}
              <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">타센터 지원</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
                <div className="flex items-center gap-3 pt-5">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={addForm.canSupportOther} onChange={e => set('canSupportOther', e.target.checked)} className="w-4 h-4" />
                    타센터 지원 가능
                  </label>
                </div>
                <div>
                  <label className={labelCls}>가능 센터</label>
                  <input type="text" value={addForm.supportableCenters ?? ''} onChange={e => set('supportableCenters', e.target.value)} className={inputCls} placeholder="서울, 부산" />
                </div>
              </div>

              <div className="flex gap-3">
                <button type="submit" disabled={adding} className="bg-red-600 text-white px-5 py-2 rounded text-sm hover:bg-red-700 disabled:opacity-50">
                  {adding ? '등록 중...' : '등록'}
                </button>
                <button type="button" onClick={() => setShowAddForm(false)} className="border px-5 py-2 rounded text-sm text-gray-600 hover:bg-gray-50">
                  취소
                </button>
              </div>
              {message && (
                <p className={`mt-3 text-sm ${message.startsWith('오류') ? 'text-red-600' : 'text-green-600'}`}>{message}</p>
              )}
            </form>
          </div>
        )}

        {/* Drivers Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">로딩 중...</div>
          ) : drivers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">기사 데이터가 없습니다. 위에서 기사를 등록해주세요.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {[
                      '센터', '차량번호', '영업용구분', 'ID', '이름', '차량구조',
                      '셀명', '셀구분', '상주여부',
                      '계약완료', '계약예상일', '계약종료일',
                      '보수교육', '보수교육일',
                      '전문기사확보', '채용예상일', '전문기사관계',
                      '타센터가능', '가능센터',
                      '상태', '상태변경',
                    ].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-gray-500 font-medium border-b">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d, i) => (
                    <tr key={d.id} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50`}>
                      <td className="px-3 py-2">{d.center || '-'}</td>
                      <td className="px-3 py-2">{d.vehicleNumber || '-'}</td>
                      <td className="px-3 py-2">{d.vehicleType || '-'}</td>
                      <td className="px-3 py-2 font-mono">{d.teamCode}</td>
                      <td className="px-3 py-2 font-medium">{d.teamName}</td>
                      <td className="px-3 py-2">{d.vehicleStructure || '-'}</td>
                      <td className="px-3 py-2">{d.cellName || '-'}</td>
                      <td className="px-3 py-2">
                        {d.cellRole ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs ${d.cellRole === '셀리더' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                            {d.cellRole}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        {d.residency ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs ${d.residency === '상주' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {d.residency}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold">{yn(d.contractDone)}</td>
                      <td className="px-3 py-2">{dt(d.contractExpectedDate)}</td>
                      <td className="px-3 py-2">{dt(d.contractEndDate)}</td>
                      <td className="px-3 py-2 text-center font-semibold">{yn(d.safetyEduDone)}</td>
                      <td className="px-3 py-2">{dt(d.safetyEduDate)}</td>
                      <td className="px-3 py-2 text-center font-semibold">{yn(d.expertSecured)}</td>
                      <td className="px-3 py-2">{dt(d.expertExpectedDate)}</td>
                      <td className="px-3 py-2">{d.expertRelation || '-'}</td>
                      <td className="px-3 py-2 text-center font-semibold">{yn(d.canSupportOther)}</td>
                      <td className="px-3 py-2">{d.supportableCenters || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_CLASSES[d.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[d.status] || d.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
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
