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

type FormData = Omit<Driver, 'id' | 'status'>

const EMPTY_FORM: FormData = {
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
const fmtDate = (v: string | null) =>
  v ? new Date(v).toISOString().slice(0, 10) : ''

function driverToForm(d: Driver): FormData {
  return {
    teamCode: d.teamCode,
    teamName: d.teamName,
    route: d.route,
    center: d.center ?? '',
    vehicleNumber: d.vehicleNumber ?? '',
    vehicleType: d.vehicleType ?? '영업용',
    vehicleStructure: d.vehicleStructure ?? 'TOP',
    cellName: d.cellName ?? '',
    cellRole: d.cellRole ?? '셀원',
    residency: d.residency ?? '상주',
    contractDone: d.contractDone,
    contractExpectedDate: fmtDate(d.contractExpectedDate),
    contractEndDate: fmtDate(d.contractEndDate),
    safetyEduDone: d.safetyEduDone,
    safetyEduDate: fmtDate(d.safetyEduDate),
    expertSecured: d.expertSecured,
    expertExpectedDate: fmtDate(d.expertExpectedDate),
    expertRelation: d.expertRelation ?? '',
    canSupportOther: d.canSupportOther,
    supportableCenters: d.supportableCenters ?? '',
  }
}

// 한 줄 폼 컴포넌트 (등록/수정 공용)
function DriverForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
}: {
  form: FormData
  onChange: (k: keyof FormData, v: unknown) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  submitting: boolean
  submitLabel: string
}) {
  const inp = (w: string) => `border rounded px-2 py-1.5 text-xs ${w}`
  const sel = (w: string) => `border rounded px-1 py-1.5 text-xs ${w}`
  const lbl = 'block text-xs text-gray-500 mb-1 whitespace-nowrap'

  return (
    <form onSubmit={onSubmit}>
      <div className="flex items-end gap-2 p-4 min-w-max overflow-x-auto">
        <div><label className={lbl}>센터</label>
          <input type="text" value={form.center ?? ''} onChange={e => onChange('center', e.target.value)} className={inp('w-16')} placeholder="제주" /></div>
        <div><label className={lbl}>차량번호</label>
          <input type="text" value={form.vehicleNumber ?? ''} onChange={e => onChange('vehicleNumber', e.target.value)} className={inp('w-24')} placeholder="12가3456" /></div>
        <div><label className={lbl}>영업용구분</label>
          <select value={form.vehicleType ?? '영업용'} onChange={e => onChange('vehicleType', e.target.value)} className={sel('w-20')}>
            <option value="영업용">영업용</option><option value="자가용">자가용</option></select></div>
        <div><label className={lbl}>ID *</label>
          <input type="text" value={form.teamCode} onChange={e => onChange('teamCode', e.target.value)} className={inp('w-14')} placeholder="001" required /></div>
        <div><label className={lbl}>이름 *</label>
          <input type="text" value={form.teamName} onChange={e => onChange('teamName', e.target.value)} className={inp('w-20')} placeholder="홍길동" required /></div>
        <div><label className={lbl}>차량구조</label>
          <select value={form.vehicleStructure ?? 'TOP'} onChange={e => onChange('vehicleStructure', e.target.value)} className={sel('w-16')}>
            <option value="TOP">TOP</option><option value="카고">카고</option></select></div>
        <div><label className={lbl}>셀명</label>
          <input type="text" value={form.cellName ?? ''} onChange={e => onChange('cellName', e.target.value)} className={inp('w-20')} placeholder="명성셀" /></div>
        <div><label className={lbl}>셀구분</label>
          <select value={form.cellRole ?? '셀원'} onChange={e => onChange('cellRole', e.target.value)} className={sel('w-18')}>
            <option value="셀리더">셀리더</option><option value="셀원">셀원</option></select></div>
        <div><label className={lbl}>상주여부</label>
          <select value={form.residency ?? '상주'} onChange={e => onChange('residency', e.target.value)} className={sel('w-18')}>
            <option value="상주">상주</option><option value="비상주">비상주</option></select></div>
        <div><label className={lbl}>계약완료</label>
          <div className="flex justify-center py-1.5">
            <input type="checkbox" checked={form.contractDone} onChange={e => onChange('contractDone', e.target.checked)} className="w-4 h-4" /></div></div>
        <div><label className={lbl}>계약예상일</label>
          <input type="date" value={form.contractExpectedDate ?? ''} onChange={e => onChange('contractExpectedDate', e.target.value)} className={inp('w-32')} /></div>
        <div><label className={lbl}>계약종료일</label>
          <input type="date" value={form.contractEndDate ?? ''} onChange={e => onChange('contractEndDate', e.target.value)} className={inp('w-32')} /></div>
        <div><label className={lbl}>보수교육</label>
          <div className="flex justify-center py-1.5">
            <input type="checkbox" checked={form.safetyEduDone} onChange={e => onChange('safetyEduDone', e.target.checked)} className="w-4 h-4" /></div></div>
        <div><label className={lbl}>보수교육일</label>
          <input type="date" value={form.safetyEduDate ?? ''} onChange={e => onChange('safetyEduDate', e.target.value)} className={inp('w-32')} /></div>
        <div><label className={lbl}>전문기사확보</label>
          <div className="flex justify-center py-1.5">
            <input type="checkbox" checked={form.expertSecured} onChange={e => onChange('expertSecured', e.target.checked)} className="w-4 h-4" /></div></div>
        <div><label className={lbl}>채용예상일</label>
          <input type="date" value={form.expertExpectedDate ?? ''} onChange={e => onChange('expertExpectedDate', e.target.value)} className={inp('w-32')} /></div>
        <div><label className={lbl}>전문기사관계</label>
          <input type="text" value={form.expertRelation ?? ''} onChange={e => onChange('expertRelation', e.target.value)} className={inp('w-20')} placeholder="가족/지인" /></div>
        <div><label className={lbl}>타센터가능</label>
          <div className="flex justify-center py-1.5">
            <input type="checkbox" checked={form.canSupportOther} onChange={e => onChange('canSupportOther', e.target.checked)} className="w-4 h-4" /></div></div>
        <div><label className={lbl}>가능센터</label>
          <input type="text" value={form.supportableCenters ?? ''} onChange={e => onChange('supportableCenters', e.target.value)} className={inp('w-20')} placeholder="서울,부산" /></div>
        <div><label className={lbl}>권역 *</label>
          <select value={form.route} onChange={e => onChange('route', e.target.value)} className={sel('w-24')} required>
            <option value="0601">서귀포</option><option value="0602">제주시</option></select></div>
        <button type="submit" disabled={submitting}
          className="bg-red-600 text-white px-3 py-1.5 rounded text-xs hover:bg-red-700 disabled:opacity-50 whitespace-nowrap">
          {submitting ? '...' : submitLabel}
        </button>
        <button type="button" onClick={onCancel}
          className="border px-3 py-1.5 rounded text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap">
          취소
        </button>
      </div>
    </form>
  )
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(false)
  const [filterRoute, setFilterRoute] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // 등록 폼
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<FormData>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState('')

  // 수정 모달
  const [editTarget, setEditTarget] = useState<Driver | null>(null)
  const [editForm, setEditForm] = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [editMsg, setEditMsg] = useState('')

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

  // 등록
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    setAddMsg('')
    try {
      const res = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAddMsg('등록 완료!')
      setAddForm(EMPTY_FORM)
      setShowAddForm(false)
      fetchDrivers()
    } catch (err: unknown) {
      setAddMsg(`오류: ${err instanceof Error ? err.message : '등록 실패'}`)
    } finally {
      setAdding(false)
    }
  }

  // 수정 열기
  const openEdit = (d: Driver) => {
    setEditTarget(d)
    setEditForm(driverToForm(d))
    setEditMsg('')
  }

  // 수정 저장
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTarget) return
    setSaving(true)
    setEditMsg('')
    try {
      const res = await fetch('/api/drivers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editTarget.id, ...editForm }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setEditTarget(null)
      fetchDrivers()
    } catch (err: unknown) {
      setEditMsg(`오류: ${err instanceof Error ? err.message : '수정 실패'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`[${name}] 기사를 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/drivers?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      fetchDrivers()
    } catch (err) {
      alert(err instanceof Error ? err.message : '오류')
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
          <button onClick={() => { setShowAddForm(!showAddForm); setAddMsg('') }}
            className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700">
            + 기사 등록
          </button>
        </div>

        {/* 등록 폼 */}
        {showAddForm && (
          <div className="bg-white rounded-lg shadow mb-6 border-l-4 border-red-500 overflow-x-auto">
            <div className="px-4 pt-3 text-xs font-semibold text-gray-500">신규 기사 등록</div>
            <DriverForm
              form={addForm}
              onChange={(k, v) => setAddForm(f => ({ ...f, [k]: v }))}
              onSubmit={handleAdd}
              onCancel={() => setShowAddForm(false)}
              submitting={adding}
              submitLabel="등록"
            />
            {addMsg && (
              <p className={`px-4 pb-3 text-sm ${addMsg.startsWith('오류') ? 'text-red-600' : 'text-green-600'}`}>{addMsg}</p>
            )}
          </div>
        )}

        {/* 수정 모달 */}
        {editTarget && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-[98vw] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b">
                <h3 className="font-semibold text-gray-700">기사 수정 — {editTarget.teamName}</h3>
                <button onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
              </div>
              <div className="overflow-x-auto">
                <DriverForm
                  form={editForm}
                  onChange={(k, v) => setEditForm(f => ({ ...f, [k]: v }))}
                  onSubmit={handleEdit}
                  onCancel={() => setEditTarget(null)}
                  submitting={saving}
                  submitLabel="저장"
                />
              </div>
              {editMsg && (
                <p className="px-4 pb-3 text-sm text-red-600">{editMsg}</p>
              )}
            </div>
          </div>
        )}

        {/* 목록 테이블 */}
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
                      '상태', '상태변경', '수정', '삭제',
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
                        <select value={d.status} onChange={e => handleStatusChange(d.id, e.target.value)}
                          className="border rounded px-2 py-1 text-xs">
                          <option value="ACTIVE">정상</option>
                          <option value="SUSPENDED">배차정지</option>
                          <option value="CONTRACT_ENDED">계약종료</option>
                          <option value="ON_LEAVE">휴무</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => openEdit(d)}
                          className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600">
                          수정
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => handleDelete(d.id, d.teamName)}
                          className="bg-red-500 text-white px-2 py-1 rounded text-xs hover:bg-red-700">
                          삭제
                        </button>
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
