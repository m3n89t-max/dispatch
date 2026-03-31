'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'

// ─── 타입 정의 ───────────────────────────────────────────────
interface DriverResult {
  customerName: string
  dispatched: number
  confirmed: number
  completed: number
  confirmRate: number | null
  completeRate: number | null
  confirmToComplete: number | null
  clearDispatched: number
  clearConfirmRate: number | null
  clearCompleteRate: number | null
  rainyDispatched: number
  rainyConfirmRate: number | null
  rainyCompleteRate: number | null
  weatherImpact: number | null
  dispatchedInstall: number
}

interface DateSummary {
  date: string
  isRainy: boolean
  note: string | null
  hasDispatch: boolean
  hasConfirm: boolean
  hasComplete: boolean
}

interface AnalysisResult {
  from: string
  to: string
  totalDays: number
  rainyDays: number
  drivers: DriverResult[]
  dateSummary: DateSummary[]
}

// ─── 유틸 ────────────────────────────────────────────────────
function pctColor(v: number | null, good = 70): string {
  if (v === null) return 'text-gray-300'
  if (v >= good) return 'text-green-600 font-bold'
  if (v >= good * 0.7) return 'text-yellow-600'
  return 'text-red-500'
}

function Pct({ v, good }: { v: number | null; good?: number }) {
  if (v === null) return <span className="text-gray-300 text-xs">-</span>
  return <span className={pctColor(v, good ?? 70)}>{v}%</span>
}

function ImpactBadge({ v }: { v: number | null }) {
  if (v === null) return <span className="text-gray-300 text-xs">-</span>
  if (v > 15) return <span className="text-red-500 font-bold text-xs">↓{v}% 우천회피</span>
  if (v > 5) return <span className="text-orange-400 text-xs">↓{v}%</span>
  if (v < -5) return <span className="text-blue-500 text-xs font-bold">↑{Math.abs(v)}% 적극</span>
  return <span className="text-gray-400 text-xs">±{Math.abs(v)}%</span>
}

type SortKey = keyof Pick<DriverResult, 'dispatched' | 'confirmRate' | 'completeRate' | 'confirmToComplete' | 'rainyCompleteRate' | 'weatherImpact'>

const UPLOAD_LABELS = { DISPATCH: '전일배차', CONFIRM: '납기확정', COMPLETE: '설치완료' } as const

// ─── 메인 컴포넌트 ────────────────────────────────────────────
export default function PerformancePage() {
  const today = new Date().toISOString().slice(0, 10)
  const oneMonthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  const [tab, setTab] = useState<'upload' | 'analysis' | 'weather'>('upload')

  // 업로드 상태
  const [uploadType, setUploadType] = useState<'DISPATCH' | 'CONFIRM' | 'COMPLETE'>('DISPATCH')
  const [uploadDate, setUploadDate] = useState(today)
  const [isRainy, setIsRainy] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ deliveryCount: number; totalRows: number; uploadType: string; date: string } | null>(null)
  const [uploadError, setUploadError] = useState('')

  // 분석 상태
  const [from, setFrom] = useState(oneMonthAgo)
  const [to, setTo] = useState(today)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('confirmRate')
  const [sortDesc, setSortDesc] = useState(true)

  // 날씨 수정
  const [weatherDate, setWeatherDate] = useState(today)
  const [weatherRainy, setWeatherRainy] = useState(false)
  const [weatherSaving, setWeatherSaving] = useState(false)

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!uploadFile) return
    setUploading(true)
    setUploadError('')
    setUploadResult(null)

    try {
      const fd = new FormData()
      fd.append('file', uploadFile)
      fd.append('uploadType', uploadType)
      fd.append('date', uploadDate)
      fd.append('isRainy', String(isRainy))

      const res = await fetch('/api/performance/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '업로드 실패')
      setUploadResult(json)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '오류 발생')
    } finally {
      setUploading(false)
    }
  }

  const handleAnalysis = useCallback(async () => {
    setAnalyzing(true)
    try {
      const res = await fetch(`/api/performance/analysis?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAnalysisResult(json)
      setTab('analysis')
    } catch (err) {
      alert(err instanceof Error ? err.message : '분석 오류')
    } finally {
      setAnalyzing(false)
    }
  }, [from, to])

  const handleWeatherSave = async () => {
    setWeatherSaving(true)
    try {
      await fetch('/api/performance/workdate', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: weatherDate, isRainy: weatherRainy }),
      })
      alert(`${weatherDate} 날씨 저장: ${weatherRainy ? '비' : '맑음'}`)
    } finally {
      setWeatherSaving(false)
    }
  }

  const sorted: DriverResult[] = analysisResult
    ? [...analysisResult.drivers].sort((a, b) => {
        const av = (a[sortKey] as number | null) ?? -999
        const bv = (b[sortKey] as number | null) ?? -999
        return sortDesc ? bv - av : av - bv
      })
    : []

  const thSort = (key: SortKey, label: string) => (
    <th
      className="border px-2 py-2 cursor-pointer hover:bg-gray-200 select-none whitespace-nowrap text-xs font-medium"
      onClick={() => { setSortDesc(sortKey === key ? !sortDesc : true); setSortKey(key) }}
    >
      {label}{sortKey === key ? (sortDesc ? ' ↓' : ' ↑') : ''}
    </th>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-indigo-700 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-indigo-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">기사 실적 분석</h1>
        <span className="text-indigo-300 text-sm ml-auto">납기확정률 · 설치완료율 · 우천 분석</span>
      </header>

      <main className="max-w-7xl mx-auto p-4">

        {/* 탭 */}
        <div className="flex gap-1 mb-4 border-b">
          {(['upload', 'analysis', 'weather'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t === 'upload' ? '업로드' : t === 'analysis' ? '실적 분석' : '날씨 관리'}
            </button>
          ))}
        </div>

        {/* ─── 업로드 탭 ─── */}
        {tab === 'upload' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 업로드 폼 */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="font-bold text-gray-700 mb-4">파일 업로드</h2>
              <form onSubmit={handleUpload} className="space-y-4">

                {/* 업로드 구분 */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-2">업로드 구분</label>
                  <div className="flex gap-2">
                    {(['DISPATCH', 'CONFIRM', 'COMPLETE'] as const).map(t => (
                      <button key={t} type="button" onClick={() => setUploadType(t)}
                        className={`flex-1 py-2 px-2 rounded border text-xs font-medium transition-colors ${
                          uploadType === t
                            ? t === 'DISPATCH' ? 'bg-blue-600 text-white border-blue-600'
                              : t === 'CONFIRM' ? 'bg-green-600 text-white border-green-600'
                              : 'bg-purple-600 text-white border-purple-600'
                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                        }`}>
                        {UPLOAD_LABELS[t]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">
                    {uploadType === 'DISPATCH' && '전일 배차된 차량 리스트 — 배차 기준일 선택'}
                    {uploadType === 'CONFIRM' && '익일 납기확정된 Delivery 리스트 — 확정 당일 날짜'}
                    {uploadType === 'COMPLETE' && '당일 설치완료된 Delivery 리스트 — 완료 당일'}
                  </p>
                </div>

                {/* 날짜 + 날씨 */}
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-600 mb-1">기준 날짜</label>
                    <input type="date" value={uploadDate} onChange={e => setUploadDate(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                  <button type="button" onClick={() => setIsRainy(!isRainy)}
                    className={`px-4 py-2 rounded border text-sm font-medium mb-0.5 transition-colors ${
                      isRainy ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-yellow-50 border-yellow-300 text-yellow-700'
                    }`}>
                    {isRainy ? '🌧 비' : '☀️ 맑음'}
                  </button>
                </div>

                {/* 파일 선택 */}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">SAP 엑셀 파일</label>
                  <input type="file" accept=".xlsx,.xls"
                    onChange={e => setUploadFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer border rounded p-2" />
                  {uploadFile && (
                    <p className="text-xs text-indigo-600 mt-1">{uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)</p>
                  )}
                </div>

                {uploadError && (
                  <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{uploadError}</div>
                )}

                <button type="submit" disabled={!uploadFile || uploading}
                  className="w-full bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700 disabled:opacity-50 font-medium text-sm">
                  {uploading ? '처리 중...' : `${UPLOAD_LABELS[uploadType]} 업로드`}
                </button>
              </form>

              {uploadResult && (
                <div className="mt-4 bg-green-50 border border-green-200 rounded p-3">
                  <p className="text-green-700 font-medium text-sm">✓ 업로드 완료</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {uploadResult.date} · {UPLOAD_LABELS[uploadResult.uploadType as keyof typeof UPLOAD_LABELS]} ·
                    Delivery {uploadResult.deliveryCount}건 · {uploadResult.totalRows}행
                  </p>
                </div>
              )}
            </div>

            {/* 분석 실행 */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="font-bold text-gray-700 mb-4">분석 실행</h2>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-600 mb-1">시작일</label>
                    <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-600 mb-1">종료일</label>
                    <input type="date" value={to} onChange={e => setTo(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                </div>

                <button onClick={handleAnalysis} disabled={analyzing}
                  className="w-full bg-green-600 text-white py-2.5 rounded hover:bg-green-700 disabled:opacity-50 font-medium text-sm">
                  {analyzing ? '분석 중...' : '실적 분석 실행 →'}
                </button>

                <div className="bg-gray-50 rounded p-4 text-xs text-gray-500 space-y-1.5">
                  <p className="font-semibold text-gray-700 mb-2">분석 항목 설명</p>
                  <p><span className="text-green-600 font-medium">납기확정률</span> = 배차건 중 납기확정 비율 (%)</p>
                  <p><span className="text-blue-600 font-medium">설치완료율</span> = 배차건 중 설치완료 비율 (%)</p>
                  <p><span className="text-purple-600 font-medium">납기→완료율</span> = 확정건 중 실제 완료 비율 (%)</p>
                  <p>☀️ 맑은날 / 🌧 비오는날 구분 비교</p>
                  <p><span className="text-red-500 font-medium">날씨영향도</span> = 맑음완료율 − 비오는날완료율</p>
                  <p className="text-gray-400 pt-1">※ 매칭 기준: Delivery 번호 (SAP 공통)</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── 실적 분석 탭 ─── */}
        {tab === 'analysis' && (
          <div>
            {!analysisResult ? (
              <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                <p className="text-lg mb-3">분석 결과가 없습니다</p>
                <button onClick={() => setTab('upload')} className="text-indigo-600 hover:underline text-sm">
                  업로드 탭에서 분석을 실행하세요 →
                </button>
              </div>
            ) : (
              <>
                {/* 요약 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="bg-white rounded shadow p-3 text-center">
                    <div className="text-xl font-bold text-indigo-600">{analysisResult.totalDays}일</div>
                    <div className="text-xs text-gray-400">분석 기간 ({analysisResult.from.slice(5)} ~ {analysisResult.to.slice(5)})</div>
                  </div>
                  <div className="bg-white rounded shadow p-3 text-center">
                    <div className="text-xl font-bold text-blue-500">{analysisResult.rainyDays}일</div>
                    <div className="text-xs text-gray-400">🌧 비오는날 (맑음 {analysisResult.totalDays - analysisResult.rainyDays}일)</div>
                  </div>
                  <div className="bg-white rounded shadow p-3 text-center">
                    <div className="text-xl font-bold text-green-600">{analysisResult.drivers.length}명</div>
                    <div className="text-xs text-gray-400">분석 기사</div>
                  </div>
                  <div className="bg-white rounded shadow p-3 text-center">
                    <button onClick={handleAnalysis} disabled={analyzing}
                      className="w-full text-indigo-600 text-sm font-medium hover:underline disabled:opacity-50">
                      {analyzing ? '분석중...' : '↺ 재분석'}
                    </button>
                  </div>
                </div>

                {/* 날짜별 업로드 현황 */}
                <div className="bg-white rounded shadow p-3 mb-4 overflow-x-auto">
                  <p className="text-xs font-medium text-gray-600 mb-2">날짜별 업로드 현황</p>
                  <div className="flex gap-1 flex-wrap">
                    {analysisResult.dateSummary.map(d => (
                      <div key={d.date}
                        className={`text-xs rounded px-2 py-1 border ${d.isRainy ? 'bg-blue-50 border-blue-200' : 'bg-yellow-50 border-yellow-200'}`}>
                        <span className="font-mono">{d.date.slice(5)}</span>
                        {d.isRainy ? ' 🌧' : ' ☀️'}
                        <span className="ml-1">
                          {d.hasDispatch ? '📋' : '⬜'}
                          {d.hasConfirm ? '✅' : '⬜'}
                          {d.hasComplete ? '🔧' : '⬜'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">📋배차 ✅확정 🔧완료</p>
                </div>

                {/* 분석 테이블 */}
                <div className="bg-white rounded-lg shadow overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-xs">
                        <th className="border px-3 py-2 text-left" rowSpan={2}>기사명</th>
                        <th className="border px-2 py-1 text-center bg-indigo-50" colSpan={3}>전체</th>
                        <th className="border px-2 py-1 text-center bg-yellow-50" colSpan={2}>☀️ 맑은날</th>
                        <th className="border px-2 py-1 text-center bg-blue-100" colSpan={2}>🌧 비오는날</th>
                        <th className="border px-2 py-1 text-center bg-red-50" rowSpan={2}>날씨영향<br/><span className="font-normal">(맑음-비)</span></th>
                      </tr>
                      <tr className="bg-gray-100">
                        {thSort('dispatched', '배차건')}
                        {thSort('confirmRate', '납기확정률')}
                        {thSort('completeRate', '설치완료율')}
                        {thSort('confirmRate', '확정률')}
                        {thSort('completeRate', '완료율')}
                        {thSort('rainyConfirmRate' as SortKey, '확정률')}
                        {thSort('rainyCompleteRate', '완료율')}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((d, i) => (
                        <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                          <td className="border px-3 py-2 font-medium whitespace-nowrap">{d.customerName}</td>
                          <td className="border px-2 py-2 text-center text-gray-500 text-xs">{d.dispatched}</td>
                          <td className="border px-2 py-2 text-center bg-indigo-50">
                            <Pct v={d.confirmRate} good={70} />
                          </td>
                          <td className="border px-2 py-2 text-center bg-indigo-50">
                            <Pct v={d.completeRate} good={60} />
                          </td>
                          <td className="border px-2 py-2 text-center bg-yellow-50">
                            {d.clearDispatched > 0 ? <Pct v={d.clearConfirmRate} good={70} /> : <span className="text-gray-200 text-xs">-</span>}
                          </td>
                          <td className="border px-2 py-2 text-center bg-yellow-50">
                            {d.clearDispatched > 0 ? <Pct v={d.clearCompleteRate} good={60} /> : <span className="text-gray-200 text-xs">-</span>}
                          </td>
                          <td className="border px-2 py-2 text-center bg-blue-50">
                            {d.rainyDispatched > 0 ? <Pct v={d.rainyConfirmRate} good={70} /> : <span className="text-gray-200 text-xs">-</span>}
                          </td>
                          <td className="border px-2 py-2 text-center bg-blue-50">
                            {d.rainyDispatched > 0 ? <Pct v={d.rainyCompleteRate} good={60} /> : <span className="text-gray-200 text-xs">-</span>}
                          </td>
                          <td className="border px-2 py-2 text-center bg-red-50">
                            <ImpactBadge v={d.weatherImpact} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500 bg-white rounded p-3 shadow">
                  <span><span className="text-green-600 font-bold">■</span> 우수 (70%+)</span>
                  <span><span className="text-yellow-600 font-bold">■</span> 보통 (49~69%)</span>
                  <span><span className="text-red-500 font-bold">■</span> 미흡 (48% 이하)</span>
                  <span className="ml-3"><span className="text-red-500 font-bold">↓ 우천회피</span> = 비오는날 완료율 15%+ 하락</span>
                  <span><span className="text-blue-500 font-bold">↑ 적극</span> = 비와도 완료율 오히려 높음</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── 날씨 관리 탭 ─── */}
        {tab === 'weather' && (
          <div className="bg-white rounded-lg shadow p-6 max-w-sm">
            <h2 className="font-bold text-gray-700 mb-4">날짜별 날씨 수정</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">날짜</label>
                <input type="date" value={weatherDate} onChange={e => setWeatherDate(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setWeatherRainy(false)}
                  className={`flex-1 py-3 rounded border text-sm font-medium transition-colors ${
                    !weatherRainy ? 'bg-yellow-100 border-yellow-400 text-yellow-700' : 'bg-white border-gray-200 text-gray-400'
                  }`}>☀️ 맑음</button>
                <button onClick={() => setWeatherRainy(true)}
                  className={`flex-1 py-3 rounded border text-sm font-medium transition-colors ${
                    weatherRainy ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-white border-gray-200 text-gray-400'
                  }`}>🌧 비</button>
              </div>
              <button onClick={handleWeatherSave} disabled={weatherSaving}
                className="w-full bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700 disabled:opacity-50 font-medium text-sm">
                {weatherSaving ? '저장 중...' : '날씨 저장'}
              </button>
              <p className="text-xs text-gray-400">업로드 시 날씨를 함께 선택하거나, 여기서 별도 수정 가능합니다.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
