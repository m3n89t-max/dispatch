// 모델별 색상 — 지도 마커 테두리와 모델 필터 탭에서 공용으로 써서 색을 맞춘다.
// 담당자마다 배차 기준(동선/모델/난이도)이 달라, 모델을 색으로 한눈에 구분할 수 있게 한다.

const PREVISIT = '사전방문'

// 서로 확실히 구분되는 색 (색상환에서 멀리 떨어진 톤 + 명도 대비)
export const MODEL_COLORS: Record<string, string> = {
  시스템에어컨: '#7c3aed', // 보라
  업소용: '#e11d48',       // 진분홍/레드
  홈멀티: '#2563eb',       // 파랑
  스탠드: '#0d9488',       // 청록(teal) — 파랑과 구분
  벽걸이: '#65a30d',       // 라임그린 — 청록과 구분
  이전설치: '#ea580c',     // 주황
  단품: '#475569',         // 진회색(slate)
  리모컨: '#a16207',       // 갈색 — 주황과 구분
}
export const MODEL_COLOR_DEFAULT = '#64748b'

// "벽걸이 사전방문" → "벽걸이" 처럼 기본 모델명으로 색을 찾는다.
export function modelColor(model?: string): string {
  const base = (model || '').replace(PREVISIT, '').trim()
  return MODEL_COLORS[base] || MODEL_COLOR_DEFAULT
}
