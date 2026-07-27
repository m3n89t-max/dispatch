'use client'

// VADS (Visual Auto Dispatch System) — 안전관리 화면 전체 재사용 + 전체지도/배차 섹션 포함
import { SafetyView } from '../safety/page'

export default function VadsPage() {
  return <SafetyView withDispatch inputMode="delivery"
    title="VADS (Visual Auto Dispatch System)"
    subtitle="비주얼 배차 — 납품번호(익일 물량) 붙여넣기 → 전체 지도에서 동선·모델·2층/저층 보며 차량 배차" />
}
