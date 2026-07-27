import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import iconv from 'iconv-lite'

const SAP_TIMEOUT_MS = 90 * 1000 // 90초

interface ImportBody {
  uploadType?: 'PREV_DELIVERY' | 'SAME_DAY_DELIVERY'
  installDate?: string
  plant?: string        // ZRLEJ56700 선택화면 S_RWERKS-LOW (플랜트)
  carrierCode?: string  // S_CARCD-LOW
}

async function runScript(
  scriptPath: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  // VBScript로 SAP 자동화 (PowerShell COM 호출 이슈 회피)
  // cscript는 32-bit COM 사용하여 SAP GUI 안정적 접근
  const isVbs = scriptPath.toLowerCase().endsWith('.vbs')

  let exe: string, exeArgs: string[]
  if (isVbs) {
    // SysWOW64\cscript.exe = 32-bit (SAP GUI 32-bit 호환)
    const cscript32 = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'SysWOW64', 'cscript.exe'
    )
    exe = fsSync.existsSync(cscript32) ? cscript32 : 'cscript.exe'
    exeArgs = ['//NoLogo', scriptPath, ...args]
  } else {
    // PowerShell fallback
    const ps32 = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
    )
    exe = fsSync.existsSync(ps32) ? ps32 : 'powershell.exe'
    exeArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]
  }
  console.log('[sap-import] exe:', exe, exeArgs)

  return new Promise((resolve, reject) => {
    const ps = spawn(exe, exeArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    // cscript/powershell stdout is CP949 on Korean Windows — buffer raw bytes,
    // decode once at the end so multi-byte chars aren't split across chunks.
    const outChunks: Buffer[] = []
    const errChunks: Buffer[] = []
    ps.stdout?.on('data', (d: Buffer) => { outChunks.push(d) })
    ps.stderr?.on('data', (d: Buffer) => { errChunks.push(d) })

    const decode = (chunks: Buffer[]): string => {
      const buf = Buffer.concat(chunks)
      try { return iconv.decode(buf, 'cp949') }
      catch { return buf.toString('utf8') }
    }

    const timer = setTimeout(() => {
      ps.kill()
      reject(new Error(`SAP 자동화 타임아웃 (${SAP_TIMEOUT_MS / 1000}s)`))
    }, SAP_TIMEOUT_MS)

    ps.on('error', (err) => { clearTimeout(timer); reject(err) })
    ps.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout: decode(outChunks), stderr: decode(errChunks) })
    })
  })
}

export async function POST(request: NextRequest) {
  const debugLog = path.join(os.homedir(), 'Desktop', 'sap-import-debug.log')
  const dbg: string[] = []
  const logLine = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`
    dbg.push(line)
    console.log(line)
  }
  const flushDebug = async () => {
    try { await fs.writeFile(debugLog, dbg.join('\n') + '\n', 'utf8') } catch {}
  }

  try {
    const body: ImportBody = await request.json().catch(() => ({}))
    const uploadType = body.uploadType ?? 'PREV_DELIVERY'
    const installDate = body.installDate ?? new Date().toISOString().slice(0, 10)
    const plant = body.plant ?? 'L106'        // ZRLEJ56700: S_RWERKS-LOW
    const carrierCode = body.carrierCode ?? 'CA06E'

    logLine(`[sap-import] 시작 cwd=${process.cwd()} home=${os.homedir()}`)
    logLine(`[sap-import] body: uploadType=${uploadType} installDate=${installDate} plant=${plant} cc=${carrierCode}`)

    // 스크립트 위치 — VBS 우선 (PowerShell보다 SAP COM 안정적)
    let scriptPath = path.join(process.cwd(), 'download-sap.vbs')
    try {
      await fs.access(scriptPath)
    } catch {
      // VBS 없으면 ps1 fallback
      scriptPath = path.join(process.cwd(), 'download-sap.ps1')
      try {
        await fs.access(scriptPath)
      } catch {
        logLine(`[sap-import] FATAL: download-sap.vbs/ps1 둘 다 cwd=${process.cwd()}에서 못 찾음`)
        await flushDebug()
        return NextResponse.json({
          error: 'download-sap.vbs/ps1 파일을 찾을 수 없습니다.',
          debug: debugLog,
        }, { status: 500 })
      }
    }
    logLine(`[sap-import] script: ${scriptPath}`)

    // SAP 다운로드/감시 폴더 — C:\temp (DRM 예외 임시경로, SAP가 ZRLEJ56700.xlsx를 떨굼)
    const downloadDir = 'C:\\temp'
    try {
      const st = await fs.stat(downloadDir)
      if (!st.isDirectory()) {
        const bakPath = `${downloadDir}.bak_${Date.now()}`
        await fs.rename(downloadDir, bakPath)
        logLine(`[sap-import] 같은 이름 파일 발견 → ${bakPath}로 이동`)
        await fs.mkdir(downloadDir, { recursive: true })
        logLine(`[sap-import] downloadDir 새로 생성: ${downloadDir}`)
      } else {
        logLine(`[sap-import] downloadDir 이미 존재: ${downloadDir}`)
      }
    } catch {
      try {
        await fs.mkdir(downloadDir, { recursive: true })
        logLine(`[sap-import] downloadDir 새로 생성: ${downloadDir}`)
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code
        if (code !== 'EEXIST') {
          logLine(`[sap-import] mkdir 실패: ${code} ${e instanceof Error ? e.message : ''}`)
          await flushDebug()
          throw e
        }
        logLine(`[sap-import] mkdir EEXIST 무시: ${downloadDir}`)
      }
    }

    // watcher와 충돌 방지: lock 파일 생성 (watcher는 lock 있으면 처리 스킵)
    const lockFile = path.join(downloadDir, '.sap-import.lock')
    await fs.writeFile(lockFile, Date.now().toString()).catch(() => {})

    try {
      // 실행 전 파일 목록
      const beforeEntries = await fs.readdir(downloadDir).catch(() => [])
      // SAP ZRLEJ56700 export (고정 파일명) 또는 구버전 EXPORT_YYYYMMDD_HHMMSS.xlsx
      const isSapXlsx = (f: string) => /^ZRLEJ56700\.xlsx$/i.test(f) || /^EXPORT_\d{8}_\d{6}\.xlsx$/i.test(f)
      const beforeXlsx = new Set(beforeEntries.filter(isSapXlsx))
      logLine(`[sap-import] 실행 전 SAP xlsx: ${[...beforeXlsx].join(', ') || '(없음)'}`)

      const isVbs = scriptPath.toLowerCase().endsWith('.vbs')
      // ZRLEJ56700: 선택화면은 플랜트(S_RWERKS) + 캐리어(S_CARCD)만, 날짜 파라미터 없음
      // VBS: 위치 인자, PS1: 명명된 인자
      const args = isVbs
        ? [plant, carrierCode]
        : ['-Plant', plant, '-CarrierCode', carrierCode]
      logLine(`[sap-import] runScript 시작 args=${JSON.stringify(args)}`)
      const t0 = Date.now()
      const { code, stdout, stderr } = await runScript(scriptPath, args)
      logLine(`[sap-import] runScript 종료 code=${code} 소요=${Date.now() - t0}ms`)
      logLine(`[sap-import] === VBS STDOUT ===\n${stdout || '(empty)'}`)
      logLine(`[sap-import] === VBS STDERR ===\n${stderr || '(empty)'}`)

      if (code !== 0) {
        await flushDebug()
        return NextResponse.json({
          error: `SAP 자동화 실패 (exit ${code}): ${stderr.slice(0, 200) || stdout.slice(0, 200)}`,
          stdout, stderr, debug: debugLog,
        }, { status: 500 })
      }

      // 새 파일 찾기 — downloadDir + processed/ 양쪽 모두 검색 (watcher가 이미 옮긴 케이스 대응)
      const processedDir = path.join(downloadDir, 'processed')
      const afterEntries = await fs.readdir(downloadDir).catch(() => [])
      const processedEntries = await fs.readdir(processedDir).catch(() => [])
      logLine(`[sap-import] 실행 후 downloadDir: ${afterEntries.join(', ')}`)
      logLine(`[sap-import] processedDir: ${processedEntries.join(', ')}`)

      const newInDownload = afterEntries
        .filter(f => isSapXlsx(f) && !beforeXlsx.has(f))
        .map(f => ({ name: f, dir: downloadDir, original: f }))

      // processed/는 watcher가 prefix(timestamp)를 붙임 — original 이름 추출
      const newInProcessed = processedEntries
        .filter(f => f.toLowerCase().endsWith('.xlsx'))
        .map(f => {
          // "2026-06-09T08-30-15_EXPORT_20260609_080515.xlsx" → "EXPORT_20260609_080515.xlsx"
          const m = f.match(/^\d{4}-\d{2}-\d{2}T[\d-]+_(.+\.xlsx)$/i)
          const original = m ? m[1] : f
          return { name: f, dir: processedDir, original }
        })
        .filter(x => isSapXlsx(x.original) && !beforeXlsx.has(x.original))

      const allNew = [...newInDownload, ...newInProcessed]
      logLine(`[sap-import] newInDownload=${newInDownload.length} newInProcessed=${newInProcessed.length}`)

      if (allNew.length === 0) {
        // 추가 안전망: 최근 5분 내 mtime의 .xlsx 파일도 검색 (검색 전 폴더에 이미 있던 파일이 갱신된 경우)
        const recentFiles = await Promise.all(
          afterEntries
            .filter(isSapXlsx)
            .map(async f => {
              try {
                const st = await fs.stat(path.join(downloadDir, f))
                return { name: f, mtime: st.mtimeMs }
              } catch { return null }
            })
        )
        const recent = recentFiles
          .filter((x): x is { name: string; mtime: number } => x !== null)
          .filter(x => Date.now() - x.mtime < 5 * 60 * 1000)
          .sort((a, b) => b.mtime - a.mtime)
        logLine(`[sap-import] 최근 5분 내 SAP xlsx: ${recent.map(r => r.name).join(', ') || '(없음)'}`)
        if (recent.length > 0) {
          allNew.push({ name: recent[0].name, dir: downloadDir, original: recent[0].name })
          logLine(`[sap-import] 안전망 사용: ${recent[0].name}`)
        }
      }

      if (allNew.length === 0) {
        await flushDebug()
        return NextResponse.json({
          error: 'SAP에서 다운로드된 파일을 찾을 수 없습니다. SAP 로그인 상태를 확인해주세요.',
          stdout, stderr, debug: debugLog,
        }, { status: 500 })
      }

      // 가장 최근 파일 (downloadDir 우선, 같으면 processed/)
      const filesWithStat = await Promise.all(allNew.map(async (x) => {
        const fullPath = path.join(x.dir, x.name)
        const stat = await fs.stat(fullPath)
        return { name: x.name, originalName: x.original, path: fullPath, mtime: stat.mtimeMs, fromProcessed: x.dir === processedDir }
      }))
      filesWithStat.sort((a, b) => b.mtime - a.mtime)
      const newFile = filesWithStat[0]
      logLine(`[sap-import] 선택된 파일: ${newFile.name} fromProcessed=${newFile.fromProcessed}`)

      // watcher가 이미 처리한 경우 — 업로드 재실행 없이 그 결과를 그대로 반환
      if (newFile.fromProcessed) {
        await flushDebug()
        return NextResponse.json({
          sapDownloadedFile: newFile.originalName,
          message: 'watcher가 이미 처리했습니다. /api/delivery/records 에서 최근 업로드를 확인하세요.',
          debug: debugLog,
        })
      }

      // 같은 서버의 upload API 호출하여 처리
      const buffer = await fs.readFile(newFile.path)
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const formData = new FormData()
      formData.append('file', blob, newFile.originalName)
      formData.append('uploadType', uploadType)
      formData.append('installDate', installDate)

      const port = process.env.PORT || '3000'
      logLine(`[sap-import] /api/delivery/upload 호출 (port=${port})`)
      const uploadRes = await fetch(`http://127.0.0.1:${port}/api/delivery/upload`, {
        method: 'POST',
        body: formData,
      })
      const uploadData = await uploadRes.json()
      logLine(`[sap-import] upload 응답 status=${uploadRes.status} totalRows=${uploadData.totalRows ?? '?'}`)

      if (!uploadRes.ok) {
        await flushDebug()
        return NextResponse.json({
          error: uploadData.error || '업로드 실패',
          sapFile: newFile.originalName,
          debug: debugLog,
        }, { status: 500 })
      }

      // 처리 완료 → processed 폴더로 이동
      try {
        await fs.mkdir(processedDir, { recursive: true })
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        await fs.rename(newFile.path, path.join(processedDir, `${ts}_${newFile.originalName}`))
      } catch (e) {
        logLine(`[sap-import] processed 이동 실패: ${e}`)
      }

      logLine(`[sap-import] 완료 ✓`)
      await flushDebug()
      return NextResponse.json({
        sapDownloadedFile: newFile.originalName,
        ...uploadData,
      })
    } finally {
      // lock 해제 (성공/실패 모두)
      await fs.unlink(lockFile).catch(() => {})
    }
  } catch (e) {
    logLine(`[sap-import] EXCEPTION: ${e instanceof Error ? e.stack || e.message : String(e)}`)
    await flushDebug()
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'SAP 가져오기 중 오류',
      debug: debugLog,
    }, { status: 500 })
  }
}
