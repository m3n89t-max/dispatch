import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import iconv from 'iconv-lite'
import { saveRemarks } from '../remark/route'

// VADS 익일 물량 끌고오기 — zllek52060(배차진행정보) VBS 실행 → 납품번호(VBELN) 목록 반환.
// vads-deliveries.vbs 가 C:\temp\vads_deliveries.txt 에 한 줄당 납품번호를 기록.

const TEMP_DIR = 'C:\\temp'
const OUT = path.join(TEMP_DIR, 'vads_deliveries.tsv')
const LOG = path.join(TEMP_DIR, 'vads_deliveries.log')

// VBS 실행 — 반드시 타임아웃을 둔다. SAP에 팝업이 떠 있거나 로그인이 풀리면 cscript가
// 무한 대기해 요청이 끝나지 않고, 브라우저에는 "Failed to fetch"만 뜬다(원인 파악 불가).
const VBS_TIMEOUT_MS = 240000   // 4분
function runVbs(scriptPath: string, timeoutMs = VBS_TIMEOUT_MS): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const cscript32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'cscript.exe')
  const exe = fsSync.existsSync(cscript32) ? cscript32 : 'cscript.exe'
  return new Promise((resolve, reject) => {
    const ps = spawn(exe, ['//NoLogo', scriptPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const out: Buffer[] = [], err: Buffer[] = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { ps.kill() } catch { /* 이미 종료 */ }
    }, timeoutMs)
    ps.stdout?.on('data', (d: Buffer) => out.push(d))
    ps.stderr?.on('data', (d: Buffer) => err.push(d))
    const dec = (c: Buffer[]) => { const b = Buffer.concat(c); try { return iconv.decode(b, 'cp949') } catch { return b.toString('utf8') } }
    ps.on('error', (e) => { clearTimeout(timer); reject(e) })
    ps.on('exit', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: dec(out), stderr: dec(err), timedOut }) })
  })
}

export async function POST() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {})
    await fs.unlink(OUT).catch(() => {})

    const vbs = path.join(process.cwd(), 'vads-deliveries.vbs')
    try { await fs.access(vbs) } catch { return NextResponse.json({ error: 'vads-deliveries.vbs 없음 (배포폴더에 VBS 필요)' }, { status: 500 }) }

    const r = await runVbs(vbs)
    if (r.timedOut) {
      return NextResponse.json({
        error: 'SAP 응답이 없어 4분 후 중단했습니다.\n\n확인사항:\n① SAP 화면에 팝업/대화상자가 떠 있으면 닫아주세요\n② SAP Logon 로그인이 유지되고 있는지 확인\n③ SAP GUI 스크립팅이 허용되어 있는지 확인',
        timedOut: true, stdout: r.stdout.slice(-800),
      }, { status: 504 })
    }
    let text = ''
    try { text = await fs.readFile(OUT, 'utf8') } catch {
      // VBS가 남긴 로그에서 실제 사유([ERROR]/[sbar])를 뽑아 화면에 그대로 보여준다.
      let reason = ''
      try {
        const log = await fs.readFile(LOG, 'utf8')
        const lines = log.split(/\r?\n/).filter(l => /\[ERROR\]|\[sbar\]|\[WARN\]/.test(l))
        if (lines.length) reason = '\n\nSAP 로그:\n' + lines.slice(-4).join('\n')
      } catch { /* 로그도 없으면 생략 */ }
      return NextResponse.json({
        error: `SAP 결과를 읽지 못했습니다.\n\n확인사항:\n① SAP Logon 로그인 상태\n② SAP 화면에 팝업이 떠 있으면 닫기\n③ zllek52060 트랜잭션 권한(안전관리는 다른 트랜잭션이라 이것만 막힐 수 있음)${reason}`,
        code: r.code, stdout: r.stdout.slice(-800),
      }, { status: 500 })
    }
    // TSV: Delivery<TAB>Vehicle<TAB>Remark (헤더 1줄). 차량번호 없으면 미배차.
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
    const body = lines[0]?.toLowerCase().startsWith('delivery') ? lines.slice(1) : lines
    const seen = new Set<string>()
    const items: { deliveryNo: string; vehicle: string; remark: string }[] = []
    for (const line of body) {
      const [dnRaw, vehRaw, remRaw] = line.split('\t')
      const deliveryNo = (dnRaw || '').replace(/[^0-9]/g, '')
      if (deliveryNo.length < 7 || seen.has(deliveryNo)) continue
      seen.add(deliveryNo)
      items.push({ deliveryNo, vehicle: (vehRaw || '').trim(), remark: (remRaw || '').trim() })
    }
    const deliveries = items.map(i => i.deliveryNo)
    const assignedCount = items.filter(i => i.vehicle).length
    // 비고는 공유 DB에 보관 → 새로고침/다른 PC에서도 유지 (저장 실패해도 조회 결과는 그대로 반환)
    const remarkCount = items.filter(i => i.remark).length
    try { await saveRemarks(items.map(i => ({ deliveryNo: i.deliveryNo, remark: i.remark }))) } catch { /* noop */ }
    return NextResponse.json({ ok: true, count: items.length, assignedCount, remarkCount, items, deliveries, log: r.stdout.slice(-400) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'SAP 조회 중 오류' }, { status: 500 })
  }
}
