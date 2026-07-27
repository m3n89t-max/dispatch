import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import iconv from 'iconv-lite'

// VADS 배차 완료 → 납품번호(delivery) + 차량번호를 SAP로 일괄 전송(전산 배차).
// 앱이 C:\temp\dispatch_send.tsv 를 기록 → vads-dispatch-send.vbs 가 읽어 SAP 배차(배차일자=전달값).
// 전송 VBS가 아직 없으면 파일만 준비하고 대기 상태로 응답.

const TEMP_DIR = 'C:\\temp'
const IN = path.join(TEMP_DIR, 'dispatch_send.tsv')
const OUT = path.join(TEMP_DIR, 'dispatch_send_result.tsv')
const VBS_NAME = 'vads-dispatch-send.vbs'

// 실행 중인 전송 프로세스 — 긴급정지(DELETE)에서 죽일 수 있도록 모듈 스코프에 보관
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let running: { ps: any; abort: boolean } | null = null

// VBS 실행 — 타임아웃 필수(SAP 팝업/로그인 풀림 시 무한 대기 → 브라우저 "Failed to fetch")
const VBS_TIMEOUT_MS = 300000   // 5분
function runVbs(scriptPath: string, timeoutMs = VBS_TIMEOUT_MS): Promise<{ code: number; stdout: string; timedOut: boolean; aborted: boolean }> {
  const cscript32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'cscript.exe')
  const exe = fsSync.existsSync(cscript32) ? cscript32 : 'cscript.exe'
  return new Promise((resolve, reject) => {
    const ps = spawn(exe, ['//NoLogo', scriptPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    running = { ps, abort: false }
    const out: Buffer[] = []
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; try { ps.kill() } catch { /* 이미 종료 */ } }, timeoutMs)
    ps.stdout?.on('data', (d: Buffer) => out.push(d))
    ps.stderr?.on('data', (d: Buffer) => out.push(d))
    ps.on('error', (e) => { clearTimeout(timer); running = null; reject(e) })
    ps.on('exit', (code) => {
      clearTimeout(timer)
      const aborted = !!running?.abort
      running = null
      resolve({ code: code ?? -1, timedOut, aborted, stdout: (() => { const b = Buffer.concat(out); try { return iconv.decode(b, 'cp949') } catch { return b.toString('utf8') } })() })
    })
  })
}

// DELETE: 긴급정지 — 진행 중인 SAP 전송(cscript)을 즉시 종료.
// SAP 화면은 중단 시점 상태로 남으므로 사용자가 SAP에서 직접 확인해야 한다.
export async function DELETE() {
  if (!running) return NextResponse.json({ ok: false, running: false, message: '진행 중인 전송이 없습니다.' })
  running.abort = true
  try {
    running.ps.kill()
    // 자식 cscript 가 남아있을 수 있어 강제 종료까지 시도
    try { spawn('taskkill', ['/PID', String(running.ps.pid), '/T', '/F'], { windowsHide: true }) } catch { /* noop */ }
    return NextResponse.json({ ok: true, running: true, message: 'SAP 전송을 긴급정지했습니다.\nSAP 화면 상태를 직접 확인해주세요(일부만 반영되었을 수 있음).' })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : '정지 실패' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    // 배차일자: YYYY-MM-DD 또는 YYYY.MM.DD → SAP 형식 YYYY.MM.DD
    const rawDate = String(body?.date ?? '').trim()
    const wrdat = rawDate.replace(/-/g, '.')
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(wrdat)) return NextResponse.json({ error: 'date(YYYY-MM-DD) 필요' }, { status: 400 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = Array.isArray(body?.items) ? body.items : []
    const rows = items
      .map(r => ({ deliveryNo: String(r?.deliveryNo ?? '').trim(), vehicleNo: String(r?.vehicleNo ?? '').trim() }))
      .filter(r => r.deliveryNo && r.vehicleNo)
    if (rows.length === 0) return NextResponse.json({ error: '전송할 배차 건이 없습니다.' }, { status: 400 })

    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {})
    // 입력 파일: 납품번호<TAB>차량번호<TAB>배차일자
    const tsv = '납품번호\t차량번호\t배차일자\r\n' + rows.map(r => `${r.deliveryNo}\t${r.vehicleNo}\t${wrdat}`).join('\r\n') + '\r\n'
    await fs.writeFile(IN, tsv, 'utf8')
    await fs.unlink(OUT).catch(() => {})

    const vbs = path.join(process.cwd(), VBS_NAME)
    let vbsExists = false
    try { await fs.access(vbs); vbsExists = true } catch { /* 아직 없음 */ }

    if (!vbsExists) {
      return NextResponse.json({
        ok: false, pending: true, count: rows.length, date: wrdat,
        message: `전송 파일 준비됨(${rows.length}건, 배차일자 ${wrdat}).\n전송 VBS(${VBS_NAME})가 없어 실제 SAP 전송은 대기 중입니다.`,
      })
    }

    const r = await runVbs(vbs)
    if (r.aborted) {
      return NextResponse.json({
        ok: false, aborted: true,
        message: '긴급정지로 SAP 전송을 중단했습니다.\n중단 시점까지 반영된 건이 있을 수 있으니 SAP 화면을 확인해주세요.',
        log: r.stdout.slice(-800),
      })
    }
    if (r.timedOut) {
      return NextResponse.json({
        error: 'SAP 전송이 5분 내에 끝나지 않아 중단했습니다.\n\n확인사항:\n① SAP 화면에 팝업/대화상자가 떠 있으면 닫아주세요\n② SAP Logon 로그인 유지 확인\n③ C:\\temp\\vads_send.log 에서 마지막 단계 확인',
        timedOut: true, log: r.stdout.slice(-800),
      }, { status: 504 })
    }
    let result = ''
    try { result = await fs.readFile(OUT, 'utf8') } catch { /* 결과 파일 없을 수 있음 */ }
    // 결과 TSV: 납품번호<TAB>결과  (OK / 사유)
    let okCnt = 0, failCnt = 0
    const fails: string[] = []
    if (result) {
      for (const line of result.split(/\r?\n/).slice(1)) {
        if (!line.trim()) continue
        const [dn, res] = line.split('\t')
        if ((res || '').trim().toUpperCase() === 'OK') okCnt++
        else { failCnt++; if (fails.length < 10) fails.push(`${dn}:${(res || '').trim()}`) }
      }
    }
    return NextResponse.json({
      ok: true, count: rows.length, date: wrdat, okCount: okCnt, failCount: failCnt, fails,
      message: result ? `SAP 전송: 성공 ${okCnt} · 실패 ${failCnt}${fails.length ? ' (' + fails.join(', ') + ')' : ''}` : `SAP 전송 실행됨(${rows.length}건, ${wrdat}).`,
      log: r.stdout.slice(-400),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'SAP 전송 중 오류' }, { status: 500 })
  }
}
