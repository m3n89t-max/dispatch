'use client'

import { useState } from 'react'
import Link from 'next/link'

interface ProcessedItem {
  teamCode: string
  teamName: string
  route: string
  matnr: string
  augru: string
  quantity: number
  modelType: string
  installCount: number
}

interface TeamSummary {
  teamCode: string
  teamName: string
  route: string
  totalInstall: number
  itemCount: number
}

interface UploadResult {
  success: boolean
  uploadId: string
  totalRows: number
  teamCount: number
  items: ProcessedItem[]
  teamSummary: TeamSummary[]
}

const MODEL_TYPE_LABELS: Record<string, string> = {
  WALL_MOUNT: '벽걸이',
  STAND: '스탠드',
  HOME_MULTI: '홈멀티',
  SYSTEM_AC: '시스템AC',
  PRE_VISIT: '사전방문',
  UNKNOWN: '미분류',
}

const MODEL_TYPE_CLASSES: Record<string, string> = {
  WALL_MOUNT: 'bg-blue-100 text-blue-700',
  STAND: 'bg-green-100 text-green-700',
  HOME_MULTI: 'bg-purple-100 text-purple-700',
  SYSTEM_AC: 'bg-gray-100 text-gray-600',
  PRE_VISIT: 'bg-orange-100 text-orange-700',
  UNKNOWN: 'bg-red-100 text-red-700',
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'items' | 'summary'>('summary')

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/upload/prev-dispatch', {
        method: 'POST',
        body: formData,
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '업로드 실패')
      setResult(json)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-700 text-white p-4 flex items-center gap-4">
        <Link href="/" className="text-green-200 hover:text-white text-sm">← 홈</Link>
        <h1 className="text-xl font-bold">엑셀 업로드</h1>
      </header>

      <main className="max-w-5xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="font-semibold text-gray-700 mb-4">전일 배차 파일 업로드</h2>

          <form onSubmit={handleUpload} className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-green-400 transition-colors">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100 cursor-pointer"
              />
              {file && (
                <p className="mt-2 text-sm text-green-700 font-medium">
                  선택된 파일: {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-800">
              <strong className="block mb-2">엑셀 파일 컬럼 순서 (헤더 행 포함):</strong>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                {['A: 팀코드', 'B: 팀명', 'C: 권역(ROUTE)', 'D: 모델코드(MATNR)', 'E: 주문사유(AUGRU)', 'F: 수량'].map(col => (
                  <span key={col} className="bg-white rounded px-2 py-1 border border-blue-200">{col}</span>
                ))}
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-xs text-yellow-800">
              <strong>권역 코드:</strong> 0601 = 서귀포, 0602 = 제주시
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!file || loading}
              className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 disabled:opacity-50 font-medium"
            >
              {loading ? '처리 중...' : '업로드 및 처리'}
            </button>
          </form>
        </div>

        {result && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-green-600 text-xl">✓</span>
              <h3 className="font-semibold text-gray-700">처리 완료</h3>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-green-50 rounded p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{result.totalRows}</div>
                <div className="text-xs text-gray-500 mt-1">전체 행</div>
              </div>
              <div className="bg-blue-50 rounded p-3 text-center">
                <div className="text-2xl font-bold text-blue-600">{result.teamCount}</div>
                <div className="text-xs text-gray-500 mt-1">팀 수</div>
              </div>
              <div className="bg-purple-50 rounded p-3 text-center">
                <div className="text-2xl font-bold text-purple-600">{result.uploadId.slice(-6)}</div>
                <div className="text-xs text-gray-500 mt-1">업로드 ID</div>
              </div>
            </div>

            {/* Tab navigation */}
            <div className="flex border-b mb-4">
              <button
                onClick={() => setActiveTab('summary')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === 'summary' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                팀별 요약 ({result.teamSummary?.length || 0}팀)
              </button>
              <button
                onClick={() => setActiveTab('items')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === 'items' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                상세 항목 ({result.items?.length || 0}건)
              </button>
            </div>

            {activeTab === 'summary' && result.teamSummary && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border px-3 py-2 text-left">팀코드</th>
                      <th className="border px-3 py-2 text-left">팀명</th>
                      <th className="border px-3 py-2 text-center">권역</th>
                      <th className="border px-3 py-2 text-right">항목수</th>
                      <th className="border px-3 py-2 text-right">설치대수 합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.teamSummary.map((team, i) => (
                      <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="border px-3 py-2 font-mono text-xs">{team.teamCode}</td>
                        <td className="border px-3 py-2">{team.teamName}</td>
                        <td className="border px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs ${team.route === '0601' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                            {team.route === '0601' ? '서귀포' : team.route === '0602' ? '제주시' : team.route}
                          </span>
                        </td>
                        <td className="border px-3 py-2 text-right">{team.itemCount}</td>
                        <td className="border px-3 py-2 text-right font-bold text-green-700">{team.totalInstall}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'items' && result.items && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border px-3 py-2 text-left">팀코드</th>
                      <th className="border px-3 py-2 text-left">MATNR</th>
                      <th className="border px-3 py-2 text-center">AUGRU</th>
                      <th className="border px-3 py-2 text-center">유형</th>
                      <th className="border px-3 py-2 text-right">수량</th>
                      <th className="border px-3 py-2 text-right">설치대수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.slice(0, 50).map((item, i) => (
                      <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="border px-3 py-1 font-mono text-xs">{String(item.teamCode)}</td>
                        <td className="border px-3 py-1 font-mono text-xs">{String(item.matnr)}</td>
                        <td className="border px-3 py-1 text-center text-xs">{item.augru ? String(item.augru) : '-'}</td>
                        <td className="border px-3 py-1 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs ${MODEL_TYPE_CLASSES[item.modelType] || 'bg-gray-100 text-gray-600'}`}>
                            {MODEL_TYPE_LABELS[item.modelType] || item.modelType}
                          </span>
                        </td>
                        <td className="border px-3 py-1 text-right">{Number(item.quantity) || 1}</td>
                        <td className="border px-3 py-1 text-right font-medium">
                          <span className={item.installCount === 0 ? 'text-gray-400' : 'text-green-700'}>
                            {item.installCount}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.items.length > 50 && (
                  <p className="text-xs text-gray-500 mt-2 text-center py-2">
                    ... 외 {result.items.length - 50}건 (총 {result.items.length}건)
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
