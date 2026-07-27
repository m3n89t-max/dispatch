'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// 상단 가로 메뉴바 (전역)
const NAV: { href: string; label: string }[] = [
  { href: '/vads', label: 'VADS 배차' },
  { href: '/safety', label: '안전관리' },
  { href: '/dispatch', label: '배차 대시보드' },
  { href: '/drivers', label: '기사 관리' },
  { href: '/upload', label: '업로드' },
  { href: '/performance', label: '실적 입력' },
  { href: '/monthly', label: '월별 집계' },
  { href: '/delivery-compare', label: '납기 비교' },
]

export default function TopNav() {
  const path = usePathname() || '/'
  const isActive = (href: string) => path === href || (href !== '/' && path.startsWith(href))
  return (
    <header className="sticky top-0 z-50 bg-slate-900 text-slate-200 shadow-lg">
      <div className="flex items-center gap-1 px-3 h-14">
        {/* 로고 */}
        <Link href="/" className="flex items-center gap-2.5 pr-4 mr-1 shrink-0">
          <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white text-sm font-bold tracking-tight shadow">JJ</span>
          <span className="hidden md:block font-semibold text-white text-sm leading-tight">제주 배차<br /><span className="text-[10px] font-normal text-slate-400">자동화 시스템</span></span>
        </Link>

        {/* 메뉴 (가로) */}
        <nav className="flex items-center gap-0.5 overflow-x-auto no-scrollbar flex-1">
          {NAV.map(n => {
            const active = isActive(n.href)
            return (
              <Link key={n.href} href={n.href}
                className={`inline-flex items-center px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${active
                  ? 'bg-white/10 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'}`}>
                {n.label}
              </Link>
            )
          })}
        </nav>

        {/* 우측 유틸 */}
        <div className="flex items-center gap-1.5 pl-2 shrink-0">
          <Link href="/" className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors">홈</Link>
        </div>
      </div>
    </header>
  )
}
