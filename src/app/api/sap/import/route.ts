import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'

const SAP_TIMEOUT_MS = 90 * 1000 // 90초

interface ImportBody {
  uploadType?: 'PREV_DELIVERY' | 'SAME_DAY_DELIVERY'
  installDate?: string
  shippingPoint?: string
  carrierCode?: string
}

async function runPowerShell(
  scriptPath: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      ...args,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    })

    let stdout = '', stderr = ''
    ps.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    ps.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      ps.kill()
      reject(new Error(`SAP 자동화 타임아웃 (${SAP_TIMEOUT_MS / 1000}s)`))
    }, SAP_TIMEOUT_MS)

    ps.on('error', (err) => { clearTimeout(timer); reject(err) })
    ps.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

export async function POST(request: NextRequest) {
  try {
    const body: ImportBody = await request.json().catch(() => ({}))
    const uploadType = body.uploadType ?? 'PREV_DELIVERY'
    const installDate = body.installDate ?? new Date().toISOString().slice(0, 10)
    const shippingPoint = body.shippingPoint ?? 'a062'
    const carrierCode = body.carrierCode ?? 'CA06E'

    // PowerShell 스크립트 위치 (server.js 실행 폴더 기준)
    const scriptPath = path.join(process.cwd(), 'download-sap.ps1')
    try {
      await fs.access(scriptPath)
    } catch {
      return NextResponse.json({
        error: 'download-sap.ps1 파일을 찾을 수 없습니다. 설치를 확인해주세요.'
      }, { status: 500 })
    }

    // SAP 다운로드 폴더
    const downloadDir = path.join(os.homedir(), 'Desktop', '배차진행정보')
    await fs.mkdir(downloadDir, { recursive: true })

    // 실행 전 파일 목록
    const beforeEntries = await fs.readdir(downloadDir).catch(() => [])
    const beforeXlsx = new Set(beforeEntries.filter(f => f.toLowerCase().endsWith('.xlsx')))

    console.log('[sap-import] PowerShell 실행:', scriptPath)
    const { code, stdout, stderr } = await runPowerShell(scriptPath, [
      '-ShippingPoint', shippingPoint,
      '-CarrierCode', carrierCode,
    ])

    console.log('[sap-import] PowerShell 종료 code=', code)
    if (stdout) console.log('[sap-import] stdout:', stdout.slice(0, 500))
    if (stderr) console.warn('[sap-import] stderr:', stderr.slice(0, 500))

    // 실행 결과 검사 (PowerShell 자체는 exit 0이지만 SAP GUI 없으면 실패할 수 있음)
    if (code !== 0) {
      return NextResponse.json({
        error: `SAP 자동화 실패 (exit ${code}): ${stderr.slice(0, 200) || stdout.slice(0, 200)}`,
        stdout, stderr,
      }, { status: 500 })
    }

    // 새 파일 찾기
    const afterEntries = await fs.readdir(downloadDir)
    const newFiles = afterEntries.filter(f =>
      f.toLowerCase().endsWith('.xlsx') && !beforeXlsx.has(f)
    )

    if (newFiles.length === 0) {
      return NextResponse.json({
        error: 'SAP에서 다운로드된 파일을 찾을 수 없습니다. SAP 로그인 상태를 확인해주세요.',
        stdout, stderr,
      }, { status: 500 })
    }

    // 가장 최근 파일
    const filesWithStat = await Promise.all(newFiles.map(async (f) => {
      const fullPath = path.join(downloadDir, f)
      const stat = await fs.stat(fullPath)
      return { name: f, path: fullPath, mtime: stat.mtimeMs }
    }))
    filesWithStat.sort((a, b) => b.mtime - a.mtime)
    const newFile = filesWithStat[0]
    console.log('[sap-import] 새 파일:', newFile.name)

    // 같은 서버의 upload API 호출하여 처리
    const buffer = await fs.readFile(newFile.path)
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const formData = new FormData()
    formData.append('file', blob, newFile.name)
    formData.append('uploadType', uploadType)
    formData.append('installDate', installDate)

    const port = process.env.PORT || '3000'
    const uploadRes = await fetch(`http://127.0.0.1:${port}/api/delivery/upload`, {
      method: 'POST',
      body: formData,
    })
    const uploadData = await uploadRes.json()

    if (!uploadRes.ok) {
      return NextResponse.json({
        error: uploadData.error || '업로드 실패',
        sapFile: newFile.name,
      }, { status: 500 })
    }

    // 처리 완료 → processed 폴더로 이동 (watcher 중복 처리 방지)
    try {
      const processedDir = path.join(downloadDir, 'processed')
      await fs.mkdir(processedDir, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      await fs.rename(newFile.path, path.join(processedDir, `${ts}_${newFile.name}`))
    } catch (e) {
      console.warn('[sap-import] processed 이동 실패:', e)
    }

    return NextResponse.json({
      sapDownloadedFile: newFile.name,
      ...uploadData,
    })
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'SAP 가져오기 중 오류'
    }, { status: 500 })
  }
}
