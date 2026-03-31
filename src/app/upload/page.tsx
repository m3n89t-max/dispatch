'use client'

import { useState } from 'react'
import Link from 'next/link'

interface ProcessedItem {
  deliveryNo: string
  customerName: string
  matnr: string
  augru: string
  modelType: string
  installCount: number
}

interface DeliverySummary {
  deliveryNo: string
  customerName: string
  totalInstall: number
  itemCount: number
  wallMount: number
  stand: number
  homeMulti: number
  systemAc: number
  preVisit: number
  moveInstall: number
  unknown: number
}

interface CustomerSummary {
  customerName: string
  totalInstall: number
  deliveryCount: number
  wallMount: number
  stand: number
  homeMulti: number
  systemAc: number
  preVisit: number
  moveInstall: number
}

interface UploadResult {
  success: boolean
  uploadId: string
  totalRows: number
  deliveryCount: number
  customerCount: number
  items: ProcessedItem[]
  deliverySummary: DeliverySummary[]
  customerSummary: CustomerSummary[]
}

const MODEL_TYPE_LABELS: Record<string, string> = {
  WALL_MOUNT: '벽걸이',
  STAND: '스탠드',
  HOME_MULTI: '홈멀티',
  SYSTEM_AC: '[시스템]',
  PRE_VISIT: '사전방문',
  MOVE_INSTALL: '이전설치',
  UNKNOWN: '미분류',
}

const MODEL_TYPE_CLASSES: Record<string, string> = {
  WALL_MOUNT: 'bg-blue-100 text-blue-700',
  STAND: 'bg-green-100 text-green-700',
  HOME_MULTI: 'bg-purple-100 text-purple-700',
  SYSTEM_AC: 'bg-gray-200 text-gray-700',
  PRE_VISIT: 'bg-orange-100 text-orange-700',
  MOVE_INSTALL: 'bg-yellow-100 text-yellow-700',
  UNKNOWN: 'bg-red-50 text-red-400',
}

function DeliveryTypeTag({ d }: { d: DeliverySummary }) {
  if (d.systemAc > 0) return <span className="px-2 py-0.5 rounded text-xs bg-gray-200 text-gray-700">[시스템]</span>
  if (d.homeMulti > 0 && d.totalInstall >= 2) return <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">홈멀티</span>
  if (d.wallMount > 0) return <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">벽걸이</span>
  if (d.stand > 0) return <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">스탠드</span>
  if (d.moveInstall > 0) return <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700">이전설치</span>
  if (d.preVisit > 0) return <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-700">사전방문</span>
  return <span className="px-2 py-0.5 rounded text-xs bg-red-50 text-red-400">미분류</span>
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'customer' | 'delivery' | 'items'>('customer')

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
        <h1 className="text-xl font-bold">납기전 배차 업로드</h1>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="font-semibold text-gray-700 mb-4">SAP 납기전 배차 파일 업로드</h2>

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
              <strong className="block mb-2">SAP 엑셀 컬럼 형식:</strong>
              <div className="grid grid-cols-4 md:grid-cols-7 gap-2 text-xs">
                {['A: Delivery', 'B: Shipping Point', 'C: S.Org', 'D: Material', 'E: Qty', 'F: Unit', 'G: Customer'].map(col => (
                  <span key={col} className="bg-white rounded px-2 py-1 border border-blue-200">{col}</span>
                ))}
              </div>
              <p className="mt-2 text-xs text-blue-600">
                모델코드(AR/AF/AC/L-)는 자동 감지됩니다.
              </p>
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

            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-green-50 rounded p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{result.totalRows}</div>
                <div className="text-xs text-gray-500 mt-1">전체 행</div>
              </div>
              <div className="bg-blue-50 rounded p-3 text-center">
                <div className="text-2xl font-bold text-blue-600">{result.deliveryCount}</div>
                <div className="text-xs text-gray-500 mt-1">배송건수</div>
              </div>
              <div className="bg-purple-50 rounded p-3 text-center">
                <div className="text-2xl font-bold text-purple-600">{result.customerCount}</div>
                <div className="text-xs text-gray-500 mt-1">기사수</div>
              </div>
              <div className="bg-orange-50 rounded p-3 text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {result.customerSummary.reduce((s, c) => s + c.totalInstall, 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">총 설치대수</div>
              </div>
            </div>

            {/* Tab navigation */}
            <div className="flex border-b mb-4">
              <button
                onClick={() => setActiveTab('customer')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === 'customer' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                기사별 요약 ({result.customerSummary?.length || 0}명)
              </button>
              <button
                onClick={() => setActiveTab('delivery')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === 'delivery' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                배송건별 ({result.deliverySummary?.length || 0}건)
              </button>
              <button
                onClick={() => setActiveTab('items')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === 'items' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                행별 상세 ({result.items?.length || 0}건)
              </button>
            </div>

            {/* 기사별 요약 */}
            {activeTab === 'customer' && result.customerSummary && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border px-3 py-2 text-left">기사명</th>
                      <th className="border px-3 py-2 text-right">배송건</th>
                      <th className="border px-3 py-2 text-right font-bold">설치대수</th>
                      <th className="border px-3 py-2 text-center text-xs">벽걸이</th>
                      <th className="border px-3 py-2 text-center text-xs">스탠드</th>
                      <th className="border px-3 py-2 text-center text-xs">홈멀티</th>
                      <th className="border px-3 py-2 text-center text-xs">[시스템]</th>
                      <th className="border px-3 py-2 text-center text-xs">이전설치</th>
                      <th className="border px-3 py-2 text-center text-xs">사전방문</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.customerSummary
                      .sort((a, b) => b.totalInstall - a.totalInstall)
                      .map((c, i) => (
                        <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                          <td className="border px-3 py-2 font-medium">{c.customerName || '-'}</td>
                          <td className="border px-3 py-2 text-right">{c.deliveryCount}</td>
                          <td className="border px-3 py-2 text-right font-bold text-green-700 text-base">{c.totalInstall}</td>
                          <td className="border px-3 py-2 text-center">{c.wallMount > 0 ? <span className="text-blue-600 font-medium">{c.wallMount}</span> : <span className="text-gray-300">-</span>}</td>
                          <td className="border px-3 py-2 text-center">{c.stand > 0 ? <span className="text-green-600 font-medium">{c.stand}</span> : <span className="text-gray-300">-</span>}</td>
                          <td className="border px-3 py-2 text-center">{c.homeMulti > 0 ? <span className="text-purple-600 font-medium">{c.homeMulti}</span> : <span className="text-gray-300">-</span>}</td>
                          <td className="border px-3 py-2 text-center">{c.systemAc > 0 ? <span className="text-gray-600 font-medium">{c.systemAc}</span> : <span className="text-gray-300">-</span>}</td>
                          <td className="border px-3 py-2 text-center">{c.moveInstall > 0 ? <span className="text-yellow-600 font-medium">{c.moveInstall}</span> : <span className="text-gray-300">-</span>}</td>
                          <td className="border px-3 py-2 text-center">{c.preVisit > 0 ? <span className="text-orange-600 font-medium">{c.preVisit}</span> : <span className="text-gray-300">-</span>}</td>
                        </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-green-50 font-bold">
                      <td className="border px-3 py-2">합계</td>
                      <td className="border px-3 py-2 text-right">{result.deliveryCount}</td>
                      <td className="border px-3 py-2 text-right text-green-700 text-base">
                        {result.customerSummary.reduce((s, c) => s + c.totalInstall, 0)}
                      </td>
                      <td className="border px-3 py-2 text-center text-blue-600">
                        {result.customerSummary.reduce((s, c) => s + c.wallMount, 0) || '-'}
                      </td>
                      <td className="border px-3 py-2 text-center text-green-600">
                        {result.customerSummary.reduce((s, c) => s + c.stand, 0) || '-'}
                      </td>
                      <td className="border px-3 py-2 text-center text-purple-600">
                        {result.customerSummary.reduce((s, c) => s + c.homeMulti, 0) || '-'}
                      </td>
                      <td className="border px-3 py-2 text-center text-gray-600">
                        {result.customerSummary.reduce((s, c) => s + c.systemAc, 0) || '-'}
                      </td>
                      <td className="border px-3 py-2 text-center text-yellow-600">
                        {result.customerSummary.reduce((s, c) => s + c.moveInstall, 0) || '-'}
                      </td>
                      <td className="border px-3 py-2 text-center text-orange-600">
                        {result.customerSummary.reduce((s, c) => s + c.preVisit, 0) || '-'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* 배송건별 */}
            {activeTab === 'delivery' && result.deliverySummary && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border px-3 py-2 text-left">Delivery</th>
                      <th className="border px-3 py-2 text-left">기사명</th>
                      <th className="border px-3 py-2 text-center">유형</th>
                      <th className="border px-3 py-2 text-right font-bold">설치대수</th>
                      <th className="border px-3 py-2 text-right text-xs">행수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.deliverySummary
                      .sort((a, b) => a.customerName.localeCompare(b.customerName) || a.deliveryNo.localeCompare(b.deliveryNo))
                      .map((d, i) => (
                        <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                          <td className="border px-3 py-2 font-mono text-xs">{d.deliveryNo}</td>
                          <td className="border px-3 py-2">{d.customerName || '-'}</td>
                          <td className="border px-3 py-2 text-center"><DeliveryTypeTag d={d} /></td>
                          <td className="border px-3 py-2 text-right font-bold text-green-700">{d.totalInstall}</td>
                          <td className="border px-3 py-2 text-right text-gray-400 text-xs">{d.itemCount}</td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 행별 상세 */}
            {activeTab === 'items' && result.items && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border px-3 py-2 text-left">Delivery</th>
                      <th className="border px-3 py-2 text-left">기사명</th>
                      <th className="border px-3 py-2 text-left">MATNR</th>
                      <th className="border px-3 py-2 text-center">유형</th>
                      <th className="border px-3 py-2 text-right">설치대수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.slice(0, 100).map((item, i) => (
                      <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="border px-3 py-1 font-mono text-xs">{item.deliveryNo}</td>
                        <td className="border px-3 py-1">{item.customerName || '-'}</td>
                        <td className="border px-3 py-1 font-mono text-xs">{item.matnr || '-'}</td>
                        <td className="border px-3 py-1 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs ${MODEL_TYPE_CLASSES[item.modelType] || 'bg-gray-100 text-gray-600'}`}>
                            {MODEL_TYPE_LABELS[item.modelType] || item.modelType}
                          </span>
                        </td>
                        <td className="border px-3 py-1 text-right font-medium">
                          <span className={item.installCount === 0 ? 'text-gray-300' : 'text-green-700'}>
                            {item.installCount}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.items.length > 100 && (
                  <p className="text-xs text-gray-500 mt-2 text-center py-2">
                    ... 외 {result.items.length - 100}건 (총 {result.items.length}건)
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
