import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white p-4 shadow">
        <h1 className="text-2xl font-bold">제주 물류 배차 자동화 시스템</h1>
        <p className="text-blue-200 text-sm mt-1">가전/에어컨 설치 배차 관리 (제주 물류센터)</p>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">

          <Link href="/dispatch" className="block">
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border-l-4 border-blue-500">
              <h2 className="text-xl font-semibold text-gray-800">배차 대시보드</h2>
              <p className="text-gray-500 mt-2 text-sm">전일 배차 우선순위 및 권역별 배차 현황</p>
              <div className="mt-4 text-blue-600 text-sm font-medium">바로가기 →</div>
            </div>
          </Link>

          <Link href="/upload" className="block">
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border-l-4 border-green-500">
              <h2 className="text-xl font-semibold text-gray-800">엑셀 업로드</h2>
              <p className="text-gray-500 mt-2 text-sm">전일 배차 및 익일 확정 파일 업로드</p>
              <div className="mt-4 text-green-600 text-sm font-medium">바로가기 →</div>
            </div>
          </Link>

          <Link href="/performance" className="block">
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border-l-4 border-yellow-500">
              <h2 className="text-xl font-semibold text-gray-800">실적 입력</h2>
              <p className="text-gray-500 mt-2 text-sm">완료율, OP2, NPS, 불량률 입력</p>
              <div className="mt-4 text-yellow-600 text-sm font-medium">바로가기 →</div>
            </div>
          </Link>

          <Link href="/monthly" className="block">
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border-l-4 border-purple-500">
              <h2 className="text-xl font-semibold text-gray-800">월별 집계</h2>
              <p className="text-gray-500 mt-2 text-sm">월별 실적 집계 및 순위</p>
              <div className="mt-4 text-purple-600 text-sm font-medium">바로가기 →</div>
            </div>
          </Link>

          <Link href="/drivers" className="block">
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border-l-4 border-red-500">
              <h2 className="text-xl font-semibold text-gray-800">기사 관리</h2>
              <p className="text-gray-500 mt-2 text-sm">기사 정보, 안전 위반, 배차 제외 관리</p>
              <div className="mt-4 text-red-600 text-sm font-medium">바로가기 →</div>
            </div>
          </Link>

          <Link href="/delivery-compare" className="block">
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border-l-4 border-indigo-500">
              <h2 className="text-xl font-semibold text-gray-800">납기 비교</h2>
              <p className="text-gray-500 mt-2 text-sm">전일 배차 vs 익일 확정 비교 분석</p>
              <div className="mt-4 text-indigo-600 text-sm font-medium">바로가기 →</div>
            </div>
          </Link>

        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-semibold text-gray-700 mb-3">설치대수 판단 기준</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-mono">AR*</span>
                <span className="text-gray-600">벽걸이 → 1대</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-mono">AF* (숫자끝)</span>
                <span className="text-gray-600">스탠드 → 1대</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-mono">AF* (영문3자끝)</span>
                <span className="text-gray-600">홈멀티 → 2대</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-mono">AC*</span>
                <span className="text-gray-600">시스템에어컨 → 제외</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-mono">AUGRU=ZL4</span>
                <span className="text-gray-600">사전방문 → 제외</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-semibold text-gray-700 mb-3">배차 점수 가중치</h3>
            <div className="space-y-1.5 text-sm">
              {[
                { label: '완료율', weight: 30, color: 'bg-blue-500' },
                { label: '납기확정률', weight: 15, color: 'bg-green-500' },
                { label: '납기유지율', weight: 15, color: 'bg-teal-500' },
                { label: 'OP2', weight: 15, color: 'bg-yellow-500' },
                { label: 'NPS', weight: 10, color: 'bg-orange-500' },
                { label: '불량률 (역산)', weight: 10, color: 'bg-red-500' },
                { label: '추세', weight: 5, color: 'bg-purple-500' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="w-28 text-gray-600">{item.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div
                      className={`${item.color} h-2 rounded-full`}
                      style={{ width: `${item.weight * 3}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-gray-500 text-xs">{item.weight}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h3 className="font-semibold text-gray-700 mb-3">시스템 현황 (목표)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded">
              <div className="text-2xl font-bold text-blue-600">34</div>
              <div className="text-xs text-gray-500 mt-1">전체 팀</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded">
              <div className="text-2xl font-bold text-green-600">28</div>
              <div className="text-xs text-gray-500 mt-1">일 가동팀</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded">
              <div className="text-2xl font-bold text-yellow-600">112</div>
              <div className="text-xs text-gray-500 mt-1">목표 처리 (대)</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded">
              <div className="text-2xl font-bold text-purple-600">4</div>
              <div className="text-xs text-gray-500 mt-1">팀당 목표</div>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-800 mb-2">순환 배차 보정 점수</h3>
          <div className="flex gap-6 text-sm text-yellow-700">
            <span>미배차 1일: <strong>+5점</strong></span>
            <span>미배차 2일: <strong>+10점</strong></span>
            <span>미배차 3일 이상: <strong>+15점</strong></span>
          </div>
        </div>
      </main>
    </div>
  )
}
