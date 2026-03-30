import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '제주 배차 자동화',
  description: '제주 물류센터 가전/에어컨 설치 배차 자동화 시스템',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  )
}
