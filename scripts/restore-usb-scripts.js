// USB에 모든 사용자 스크립트 복원 (CP949 + CRLF)
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const USB_DIR = 'D:\\제주배차시스템_standalone_20260605';

function writeCP949(filePath, content) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  fs.writeFileSync(filePath, iconv.encode(normalized, 'cp949'));
  console.log('  ✓', path.basename(filePath));
}

function writeUTF8(filePath, content) {
  fs.writeFileSync(filePath, content);
  console.log('  ✓', path.basename(filePath));
}

// ──────────── start.bat ────────────
const startBat = [
  '@echo off',
  'chcp 65001 >nul',
  'title 제주 배차 자동화 시스템',
  'setlocal enabledelayedexpansion',
  '',
  'echo ========================================',
  'echo  제주 배차 자동화 시스템',
  'echo ========================================',
  'echo.',
  '',
  'set "LOCAL_DIR=C:\\dispatch_app"',
  'set "LOCAL_DB=%LOCAL_DIR%\\dispatch.db"',
  'set "SERVER_DB=Z:\\제주물류센터자동화\\dispatch.db"',
  '',
  'echo [0/6] Node.js 확인 중...',
  'where node >nul 2>&1',
  'if errorlevel 1 ( echo [오류] Node.js 없음 ^& pause ^& exit /b 1 )',
  "for /f \"tokens=*\" %%v in ('node --version') do echo      Node.js %%v",
  '',
  'echo [1/6] 서버 연결 중...',
  'net use Z: \\\\23.20.121.23\\common /persistent:yes >nul 2>&1',
  'if errorlevel 1 net use Z: \\\\23.20.121.23\\common >nul 2>&1',
  'set "OFFLINE=0"',
  'if not exist "Z:\\" (',
  '    echo [경고] 서버 연결 실패 - 오프라인 모드',
  '    set "OFFLINE=1"',
  ') else (',
  '    echo      Z: 연결 OK',
  ')',
  '',
  'echo [2/6] 로컬 DB 폴더 준비',
  'if not exist "%LOCAL_DIR%" mkdir "%LOCAL_DIR%"',
  '',
  'echo [3/6] DB 동기화',
  'if "!OFFLINE!"=="0" if exist "%SERVER_DB%" (',
  '    copy /Y "%SERVER_DB%" "%LOCAL_DB%" >nul',
  '    for %%F in ("%LOCAL_DB%") do echo      서버 DB -^> 로컬: %%~zF bytes',
  '    goto SETENV',
  ')',
  'if not exist "%LOCAL_DB%" (',
  '    if exist "%~dp0seed\\dispatch.db" (',
  '        copy /Y "%~dp0seed\\dispatch.db" "%LOCAL_DB%" >nul',
  '        echo      시드 DB -^> 로컬 복사',
  '        if "!OFFLINE!"=="0" (',
  '            if not exist "Z:\\제주물류센터자동화" mkdir "Z:\\제주물류센터자동화"',
  '            copy /Y "%~dp0seed\\dispatch.db" "%SERVER_DB%" >nul',
  '        )',
  '    )',
  ')',
  '',
  ':SETENV',
  'set "DATABASE_URL=file:C:/dispatch_app/dispatch.db"',
  '',
  'echo [4/6] 기사 데이터 sync',
  'cd /d "%~dp0"',
  'node init-drivers.js',
  '',
  'echo [5/6] SAP 폴더 감시 watcher 시작 (백그라운드)',
  'start "SAP-Watcher" /MIN cmd /c "cd /d %~dp0 && node watch-sap-folder.js"',
  'echo      바탕화면\\배차진행정보\\ 폴더 감시 중',
  '',
  'echo [6/6] 앱 시작',
  'echo.',
  'echo  접속 주소: http://localhost:3000',
  'echo  종료: Ctrl+C',
  'echo ========================================',
  'echo.',
  '',
  'set "NEXTAUTH_SECRET=dispatch-secret-key-change-in-production"',
  'set "PORT=3000"',
  'set "HOSTNAME=0.0.0.0"',
  'node run-server.js',
  'set EXITCODE=%ERRORLEVEL%',
  '',
  'echo.',
  'echo ========================================',
  'taskkill /F /FI "WINDOWTITLE eq SAP-Watcher*" >nul 2>&1',
  'if "!OFFLINE!"=="0" if exist "%LOCAL_DB%" (',
  '    copy /Y "%LOCAL_DB%" "%SERVER_DB%" >nul',
  '    if errorlevel 1 ( echo  [경고] sync 실패 ) else ( echo  [OK] 서버 sync 완료 )',
  ')',
  'echo  서버 종료 (exit: %EXITCODE%^)',
  'echo ========================================',
  'pause',
  ''
].join('\n');
writeCP949(path.join(USB_DIR, 'start.bat'), startBat);

// ──────────── download-sap.bat ────────────
const downloadBat = [
  '@echo off',
  'chcp 65001 >nul',
  'title SAP 배차 진행정보 자동 다운로드',
  '',
  'echo ========================================',
  'echo  SAP 배차 진행정보 자동 다운로드',
  'echo ========================================',
  'echo.',
  'echo  ▶ SAP에 이미 로그인되어 있어야 합니다',
  'echo.',
  'pause',
  '',
  'cd /d "%~dp0"',
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-sap.ps1"',
  '',
  'echo.',
  'pause',
  ''
].join('\n');
writeCP949(path.join(USB_DIR, 'download-sap.bat'), downloadBat);

// ──────────── reset-server-db.bat ────────────
const resetBat = [
  '@echo off',
  'chcp 65001 >nul',
  'title 서버 DB 초기화',
  'setlocal enabledelayedexpansion',
  '',
  'echo ========================================',
  'echo  서버 DB 초기화',
  'echo  Z:\\제주물류센터자동화\\dispatch.db ^<- 시드 DB로 재설정',
  'echo ========================================',
  'echo.',
  'echo [경고] 서버 데이터를 시드로 덮어씁니다 (백업 자동 생성)',
  'echo.',
  'set /p CONFIRM=계속하시겠습니까? (Y/N): ',
  'if /i not "!CONFIRM!"=="Y" ( pause ^& exit /b 0 )',
  '',
  'net use Z: \\\\23.20.121.23\\common /persistent:yes >nul 2>&1',
  'if errorlevel 1 net use Z: \\\\23.20.121.23\\common >nul 2>&1',
  'if not exist "Z:\\" ( echo [오류] Z: 매핑 실패 ^& pause ^& exit /b 1 )',
  'if not exist "Z:\\제주물류센터자동화" mkdir "Z:\\제주물류센터자동화"',
  '',
  'if exist "Z:\\제주물류센터자동화\\dispatch.db" (',
  "    for /f \"tokens=2 delims==\" %%a in ('wmic OS Get localdatetime /value') do set \"dt=%%a\"",
  '    set "ts=!dt:~0,8!_!dt:~8,6!"',
  '    copy /Y "Z:\\제주물류센터자동화\\dispatch.db" "Z:\\제주물류센터자동화\\dispatch_backup_!ts!.db" >nul',
  '    echo 백업: dispatch_backup_!ts!.db',
  ')',
  '',
  'copy /Y "%~dp0seed\\dispatch.db" "Z:\\제주물류센터자동화\\dispatch.db" >nul',
  'if errorlevel 1 ( echo [오류] 복사 실패 ^& pause ^& exit /b 1 )',
  '',
  'echo.',
  'echo ========================================',
  'echo  초기화 완료',
  'echo ========================================',
  'pause',
  ''
].join('\n');
writeCP949(path.join(USB_DIR, 'reset-server-db.bat'), resetBat);

// ──────────── check-server-db.bat ────────────
const checkBat = [
  '@echo off',
  'chcp 65001 >nul',
  'title 서버 DB 진단',
  'setlocal enabledelayedexpansion',
  '',
  'echo ========================================',
  'echo  서버 DB 진단',
  'echo ========================================',
  '',
  'net use Z: \\\\23.20.121.23\\common /persistent:yes >nul 2>&1',
  'if errorlevel 1 net use Z: \\\\23.20.121.23\\common >nul 2>&1',
  'if not exist "Z:\\" ( echo [오류] Z: 매핑 실패 ^& pause ^& exit /b 1 )',
  '',
  'if exist "Z:\\제주물류센터자동화\\dispatch.db" (',
  '    for %%F in ("Z:\\제주물류센터자동화\\dispatch.db") do echo 파일: %%~zF bytes, %%~tF',
  ') else (',
  '    echo [경고] 서버 DB 없음',
  '    pause ^& exit /b 1',
  ')',
  '',
  'if not exist "%TEMP%\\dispatch_check" mkdir "%TEMP%\\dispatch_check"',
  'copy /Y "Z:\\제주물류센터자동화\\dispatch.db" "%TEMP%\\dispatch_check\\db.db" >nul',
  '',
  'cd /d "%~dp0"',
  "node -e \"const{createClient}=require('@libsql/client');const c=createClient({url:'file:'+process.env.TEMP.replace(/\\\\/g,'/')+'/dispatch_check/db.db'});(async()=>{try{const cnt=await c.execute('SELECT COUNT(*) AS n FROM Driver');console.log('기사 수:',cnt.rows[0].n);const all=await c.execute('SELECT teamCode,teamName,vehicleNumber,status FROM Driver ORDER BY teamName');all.rows.forEach((d,i)=>console.log(' '+String(i+1).padStart(2)+' | '+d.teamCode+' | '+d.teamName+' | '+(d.vehicleNumber||'NULL')+' | '+d.status));}catch(e){console.error('오류:',e.message);}})();\"",
  '',
  'del "%TEMP%\\dispatch_check\\db.db" >nul 2>&1',
  'echo ========================================',
  'pause',
  ''
].join('\n');
writeCP949(path.join(USB_DIR, 'check-server-db.bat'), checkBat);

// ──────────── download-sap.ps1 (UTF-8) ────────────
const downloadPs1 = `# SAP 배차 진행정보 자동 다운로드 (ZRLEK51270)
# 녹화된 VBS 기반 (2026-06-08)

param(
    [string]$ShippingPoint = "a062",
    [string]$CarrierCode = "CA06E"
)

$ErrorActionPreference = 'Stop'
$DownloadDir = Join-Path $env:USERPROFILE "Desktop\\배차진행정보"
if (-not (Test-Path $DownloadDir)) { New-Item -ItemType Directory -Force $DownloadDir | Out-Null }
$Today = Get-Date -Format "yyyyMMdd"
$FileName = "dispatch_$Today.xlsx"

Write-Host "========================================"
Write-Host " SAP 배차 진행정보 자동 다운로드"
Write-Host "========================================"
Write-Host " Shipping Point: $ShippingPoint"
Write-Host " Carrier Code:   $CarrierCode"
Write-Host " 저장 폴더:      $DownloadDir"
Write-Host "========================================"

Write-Host "[1/5] SAP GUI 연결..."
try {
    $SapGuiAuto = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SAPGUI")
} catch {
    Write-Host "[오류] SAP GUI가 실행 중이지 않습니다." -ForegroundColor Red
    exit 1
}
$application = $SapGuiAuto.GetScriptingEngine
$connection = $application.Children(0)
$session = $connection.Children(0)
Write-Host "      OK"

Write-Host "[2/5] 트랜잭션 호출..."
$session.findById("wnd[0]").maximize()
$session.findById("wnd[0]/tbar[0]/okcd").text = "zrlek51270"
$session.findById("wnd[0]").sendVKey(0)
Start-Sleep -Milliseconds 800
Write-Host "      OK"

Write-Host "[3/5] 파라미터 입력..."
$session.findById("wnd[0]/usr/ctxtS_VSTEL-LOW").text = $ShippingPoint
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").text = $CarrierCode
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").setFocus()
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").caretPosition = 5
Write-Host "      OK"

Write-Host "[4/5] 조회 실행 (F8)..."
$session.findById("wnd[0]").sendVKey(8)
Start-Sleep -Seconds 3
Write-Host "      OK"

Write-Host "[5/5] 엑셀로 export..."
try {
    $shell = $session.findById("wnd[0]/shellcont/shell/shellcont[1]/shell")
    $shell.pressToolbarContextButton("&MB_EXPORT")
    Start-Sleep -Milliseconds 500
    $shell.selectContextMenuItem("&XXL")
    Start-Sleep -Milliseconds 1000
    try { $session.findById("wnd[1]/tbar[0]/btn[20]").press() } catch { try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {} }
    Start-Sleep -Milliseconds 1000
    try {
        $session.findById("wnd[1]/usr/ctxtDY_PATH").text = $DownloadDir
        $session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = $FileName
    } catch {}
    Start-Sleep -Milliseconds 300
    try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch { try { $session.findById("wnd[1]/tbar[0]/btn[11]").press() } catch {} }
    Start-Sleep -Milliseconds 1500
    try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {}
    Write-Host "      OK"
} catch {
    Write-Host "      [오류] $_" -ForegroundColor Red
}

Start-Sleep -Seconds 2
$savedFile = Join-Path $DownloadDir $FileName
if (Test-Path $savedFile) {
    Write-Host ""
    Write-Host "✓ 다운로드 완료: $savedFile" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[안내] 파일 자동 저장 결과를 확인할 수 없습니다." -ForegroundColor Yellow
    Write-Host "       $DownloadDir 폴더 확인" -ForegroundColor Yellow
}
`;
writeUTF8(path.join(USB_DIR, 'download-sap.ps1'), downloadPs1);

// ──────────── watch-sap-folder.js (UTF-8) ────────────
const watcherJs = `// 배차진행정보 폴더 감시 + 자동 업로드
const fs = require('fs');
const path = require('path');
const os = require('os');

const WATCH_DIR = path.join(os.homedir(), 'Desktop', '배차진행정보');
const PROCESSED_DIR = path.join(WATCH_DIR, 'processed');
const SERVER_URL = process.env.WATCHER_SERVER_URL || 'http://localhost:3000';
const POLL_MS = 2000;
const STABILITY_MS = 1500;

fs.mkdirSync(WATCH_DIR, { recursive: true });
fs.mkdirSync(PROCESSED_DIR, { recursive: true });

const processing = new Set();

function pickUploadType(fileName) {
  if (/SAMEDAY|SAME_DAY|당일/i.test(fileName)) return 'SAME_DAY_DELIVERY';
  return 'PREV_DELIVERY';
}

function pickInstallDate(fileName) {
  const m1 = fileName.match(/(20\\d{2})[-_.]?(\\d{2})[-_.]?(\\d{2})/);
  if (m1) return \`\${m1[1]}-\${m1[2]}-\${m1[3]}\`;
  return new Date().toISOString().slice(0, 10);
}

async function uploadFile(filePath, fileName) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('uploadType', pickUploadType(fileName));
  formData.append('installDate', pickInstallDate(fileName));

  const res = await fetch(\`\${SERVER_URL}/api/delivery/upload\`, { method: 'POST', body: formData });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || \`HTTP \${res.status}\`);
  return data;
}

async function scan() {
  let entries;
  try { entries = fs.readdirSync(WATCH_DIR, { withFileTypes: true }); } catch { return; }

  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith('.xlsx')) continue;
    if (processing.has(e.name)) continue;

    const full = path.join(WATCH_DIR, e.name);
    let stat; try { stat = fs.statSync(full); } catch { continue; }
    if (Date.now() - stat.mtimeMs < STABILITY_MS) continue;
    if (stat.size === 0) continue;

    processing.add(e.name);
    console.log(\`[watcher] 새 파일 감지: \${e.name} (\${(stat.size/1024).toFixed(1)} KB)\`);
    try {
      const data = await uploadFile(full, e.name);
      console.log(\`[watcher] 업로드 완료: \${data.totalRows ?? 0}행, \${data.deliveryCount ?? 0}건\`);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.renameSync(full, path.join(PROCESSED_DIR, \`\${ts}_\${e.name}\`));
    } catch (err) {
      console.error(\`[watcher] 업로드 실패 (\${e.name}): \${err.message}\`);
      try { fs.renameSync(full, full + '.failed'); } catch {}
    } finally {
      processing.delete(e.name);
    }
  }
}

console.log('========================================');
console.log(' SAP 엑셀 자동 업로드 watcher 시작');
console.log('========================================');
console.log(\` 감시 폴더: \${WATCH_DIR}\`);
console.log(\` 서버: \${SERVER_URL}\`);
console.log('========================================');
setInterval(scan, POLL_MS);
scan();
`;
writeUTF8(path.join(USB_DIR, 'watch-sap-folder.js'), watcherJs);

// ──────────── init-drivers.js (UTF-8) ────────────
const initDriversJs = `// 시드 DB의 기사 데이터를 서버 DB에 동기화 (teamCode 기준)
const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

async function main() {
  const serverUrl = process.env.DATABASE_URL;
  if (!serverUrl) { console.log('[init-drivers] DATABASE_URL 미설정 - 건너뜀'); process.exit(0); }
  const seedPath = path.join(__dirname, 'seed', 'dispatch.db');
  if (!fs.existsSync(seedPath)) { console.log('[init-drivers] seed/dispatch.db 없음 - 건너뜀'); process.exit(0); }

  const server = createClient({ url: serverUrl });
  const seedUrl = 'file:' + seedPath.replace(/\\\\/g, '/');
  const seed = createClient({ url: seedUrl });

  try {
    const seedRes = await seed.execute('SELECT * FROM Driver');
    if (seedRes.rows.length === 0) return;

    let serverByCode = new Map();
    try {
      const r = await server.execute('SELECT teamCode, teamName, vehicleNumber FROM Driver');
      r.rows.forEach(d => serverByCode.set(d.teamCode, { teamName: d.teamName, vehicleNumber: d.vehicleNumber }));
    } catch (e) { console.log('[init-drivers] 서버 Driver 읽기 실패:', e.message); }

    const cols = seedRes.columns;
    const insertSql = 'INSERT INTO Driver (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')';

    let inserted = 0, renamed = 0, updated = 0, skipped = 0;
    for (const row of seedRes.rows) {
      const code = row.teamCode, name = row.teamName, plate = row.vehicleNumber;
      if (!serverByCode.has(code)) {
        try {
          await server.execute({ sql: insertSql, args: cols.map(c => row[c]) });
          console.log('  + 추가:', name, '(' + code + ')');
          inserted++;
        } catch (e) { console.error('  ✗ 추가 실패:', name, e.message); }
      } else {
        const srv = serverByCode.get(code);
        const nameChanged = srv.teamName !== name, plateChanged = srv.vehicleNumber !== plate;
        if (nameChanged && plateChanged) {
          await server.execute({ sql: 'UPDATE Driver SET teamName = ?, vehicleNumber = ?, updatedAt = CURRENT_TIMESTAMP WHERE teamCode = ?', args: [name, plate, code] });
          console.log('  ↻ 개명+차량:', srv.teamName, '→', name); renamed++;
        } else if (nameChanged) {
          await server.execute({ sql: 'UPDATE Driver SET teamName = ?, updatedAt = CURRENT_TIMESTAMP WHERE teamCode = ?', args: [name, code] });
          console.log('  ↻ 개명:', srv.teamName, '→', name); renamed++;
        } else if (plateChanged) {
          await server.execute({ sql: 'UPDATE Driver SET vehicleNumber = ?, updatedAt = CURRENT_TIMESTAMP WHERE teamCode = ?', args: [plate, code] });
          console.log('  ↻ 차량:', name); updated++;
        } else skipped++;
      }
    }
    console.log('[init-drivers] 추가 ' + inserted + ' / 개명 ' + renamed + ' / 차량 ' + updated + ' / 동일 ' + skipped);
  } catch (e) { console.error('[init-drivers] 오류:', e.message); process.exit(1); }
}
main();
`;
writeUTF8(path.join(USB_DIR, 'init-drivers.js'), initDriversJs);

console.log('\n=== USB 복원 완료 ===');
