// standalone 폴더 완전 복원: 사용자 스크립트 + seed + stubs + 정리
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const inner = 'c:\\Users\\m3n89\\Desktop\\Dispatch\\dispatch\\.next\\standalone\\Desktop\\Dispatch\\dispatch';
const base = 'c:\\Users\\m3n89\\Desktop\\Dispatch\\dispatch';

function writeCP949(p, c) {
    const n = c.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    fs.writeFileSync(p, iconv.encode(n, 'cp949'));
    console.log('  ✓', path.basename(p), '(CP949)');
}
function writeUTF8BOM(p, c) {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    fs.writeFileSync(p, Buffer.concat([bom, Buffer.from(c, 'utf8')]));
    console.log('  ✓', path.basename(p), '(UTF-8 BOM)');
}
function writeUTF8(p, c) {
    fs.writeFileSync(p, c);
    console.log('  ✓', path.basename(p));
}
// .bat용: UTF-8(BOM 없음) + CRLF. chcp 65001과 짝 → 한글 echo + Node UTF-8 로그 둘 다 정상
function writeUTF8CRLF(p, c) {
    const n = c.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    fs.writeFileSync(p, Buffer.from(n, 'utf8'));
    console.log('  ✓', path.basename(p), '(UTF-8 CRLF)');
}

// ────── 1. 폴더/시드 ──────
console.log('\n[1] 폴더 + 시드 DB');
fs.mkdirSync(path.join(inner, 'seed'), { recursive: true });
fs.copyFileSync(path.join(base, 'prisma', 'dispatch.db'), path.join(inner, 'seed', 'dispatch.db'));
console.log('  ✓ seed/dispatch.db');

// node.exe 번들 (Node.js 미설치 PC 대응 — start.bat이 이 번들을 우선 사용)
console.log('\n[1.5] node.exe 번들');
try {
    fs.copyFileSync(process.execPath, path.join(inner, 'node.exe'));
    const mb = Math.round(fs.statSync(path.join(inner, 'node.exe')).size / 1024 / 1024);
    console.log(`  ✓ node.exe (${mb} MB) — ${process.version}`);
} catch (e) {
    console.log('  ✗ node.exe 복사 실패:', e.message);
}

// ────── 2. static + public ──────
console.log('\n[2] static + public');
const cpRecurse = (src, dst) => {
    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
};
cpRecurse(path.join(base, '.next', 'static'), path.join(inner, '.next', 'static'));
cpRecurse(path.join(base, 'public'), path.join(inner, 'public'));
console.log('  ✓ static + public');

// ────── 3. Prisma stub 패키지 ──────
console.log('\n[3] Prisma Turbopack stub');
const stubBase = path.join(inner, 'node_modules', '@prisma');
[
    { name: 'client-d5b0ac7f1bdbd673', target: '@prisma/client' },
    { name: 'adapter-libsql-73a975704edd8439', target: '@prisma/adapter-libsql' },
].forEach(({ name, target }) => {
    const dir = path.join(stubBase, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'),
        JSON.stringify({ name: `@prisma/${name}`, version: '1.0.0', main: 'index.js' }));
    fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = require("${target}");`);
    console.log('  ✓ stub:', name);
});

// ────── 4. .env ──────
console.log('\n[4] .env');
// dev .env에서 KAKAO_REST_API_KEY 읽어 standalone에 전파
let kakaoRestKey = '';
try {
    const devEnv = fs.readFileSync(path.join(base, '.env'), 'utf8');
    const m = devEnv.match(/^KAKAO_REST_API_KEY=(.+)$/m);
    if (m) kakaoRestKey = m[1].trim();
} catch {}
writeUTF8(path.join(inner, '.env'), `# DATABASE_URL은 start.bat / run-server.js에서 동적 설정
# DATABASE_URL="file:C:/dispatch_app/dispatch.db"

NEXTAUTH_SECRET="dispatch-secret-key-change-in-production"

# 카카오 Local REST API (서버 사이드 도로명→우편번호 변환)
KAKAO_REST_API_KEY=${kakaoRestKey}
`);

// ────── 5. run-server.js ──────
console.log('\n[5] run-server.js');
writeUTF8(path.join(inner, 'run-server.js'), `// Server wrapper - DATABASE_URL 한글 경로 자동 fallback + download-sap.ps1을 ASCII 경로로 복사
const fs = require('fs');
const path = require('path');

const LOCAL_DIR = 'C:\\\\dispatch_app';
const LOCAL_DB = LOCAL_DIR + '\\\\dispatch.db';
const LOCAL_URL = 'file:C:/dispatch_app/dispatch.db';

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function urlToPath(url) {
    if (!url || !url.startsWith('file:')) return null;
    return url.replace(/^file:(?:\\/\\/\\/)?/, '').replace(/^\\//, '').replace(/\\//g, '\\\\');
}
function hasKorean(s) { return /[ㄱ-ㆎ가-힣]/.test(s); }

let dbUrl = process.env.DATABASE_URL || LOCAL_URL;
let originalServerPath = null;

if (hasKorean(dbUrl)) {
    console.log('[wrapper] ⚠ DATABASE_URL 한글 포함 - 로컬 ASCII 경로로 fallback');
    originalServerPath = urlToPath(dbUrl);
    if (originalServerPath && fs.existsSync(originalServerPath)) {
        ensureDir(LOCAL_DIR);
        try { fs.copyFileSync(originalServerPath, LOCAL_DB); console.log('[wrapper] 서버 DB → 로컬:', LOCAL_DB); }
        catch (e) { console.warn('[wrapper] 복사 실패:', e.message); }
    }
    dbUrl = LOCAL_URL;
}

if (dbUrl === LOCAL_URL && !fs.existsSync(LOCAL_DB)) {
    const seedPath = path.join(__dirname, 'seed', 'dispatch.db');
    if (fs.existsSync(seedPath)) {
        ensureDir(LOCAL_DIR);
        fs.copyFileSync(seedPath, LOCAL_DB);
        console.log('[wrapper] 시드 DB → 로컬 복사');
    }
}

process.env.DATABASE_URL = dbUrl;
console.log('[wrapper] DATABASE_URL:', dbUrl);

const dbPath = urlToPath(dbUrl);
if (dbPath) {
    try { const stat = fs.statSync(dbPath); console.log('[wrapper] DB:', dbPath, '(' + stat.size + ' bytes)'); }
    catch (e) { console.warn('[wrapper] DB 접근 불가:', dbPath); }
}

function syncBack() {
    if (originalServerPath && fs.existsSync(LOCAL_DB)) {
        try { fs.copyFileSync(LOCAL_DB, originalServerPath); console.log('[wrapper] 로컬 → 서버 sync'); }
        catch (e) { console.warn('[wrapper] sync 실패:', e.message); }
    }
}
process.on('SIGINT', () => { syncBack(); process.exit(0); });
process.on('SIGTERM', () => { syncBack(); process.exit(0); });
process.on('exit', syncBack);

if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'dispatch-secret-key-change-in-production';
if (!process.env.PORT) process.env.PORT = '3000';
if (!process.env.HOSTNAME) process.env.HOSTNAME = '0.0.0.0';

// download-sap.ps1을 C:\\dispatch_app\\로 복사 (한글 경로 회피)
try {
    const src = path.join(__dirname, 'download-sap.ps1');
    if (fs.existsSync(src)) {
        ensureDir(LOCAL_DIR);
        const dst = path.join(LOCAL_DIR, 'download-sap.ps1');
        fs.copyFileSync(src, dst);
        process.env.SAP_SCRIPT_PATH = dst;
        console.log('[wrapper] download-sap.ps1 → ASCII 경로 복사:', dst);
    }
} catch (e) { console.warn('[wrapper] PS1 복사 실패:', e.message); }

console.log('[wrapper] server.js 시작...');
require('./server.js');
`);

// ────── 6. start.bat (CP949) ──────
console.log('\n[6] start.bat');
writeUTF8CRLF(path.join(inner, 'start.bat'), `@echo off
chcp 65001 >nul
title 제주 배차 자동화 시스템
setlocal enabledelayedexpansion

echo ========================================
echo  제주 배차 자동화 시스템
echo ========================================
echo.

set "LOCAL_DIR=C:\\dispatch_app"
set "LOCAL_DB=%LOCAL_DIR%\\dispatch.db"
set "SHARE_DIR=Z:\\dispatch"
set "SHARE_DB=%SHARE_DIR%\\dispatch.db"
set "OLD_DB=Z:\\제주물류센터자동화\\dispatch.db"

echo [0/5] Node.js 확인 중...
rem 번들 node.exe 우선 사용 (Node.js 미설치 PC 대응), 없으면 시스템 node
set "NODE=%~dp0node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" --version >nul 2>&1
if errorlevel 1 ( echo [오류] Node 실행 불가 ^(번들 node.exe 누락 + 시스템 Node 없음^) & pause & exit /b 1 )
for /f "tokens=*" %%v in ('"%NODE%" --version') do echo      Node %%v

echo [1/5] 공유폴더(23.20.121.23) 연결...
net use Z: \\\\23.20.121.23\\common /persistent:yes >nul 2>&1
if errorlevel 1 net use Z: \\\\23.20.121.23\\common >nul 2>&1

echo [2/5] 공유 DB 준비
if not exist "Z:\\" goto USELOCAL
echo      연결 OK - 공유 DB 사용 ^(모든 PC 공통^)
if not exist "%SHARE_DIR%" mkdir "%SHARE_DIR%"
if not exist "%SHARE_DB%" if exist "%OLD_DB%" copy /Y "%OLD_DB%" "%SHARE_DB%" >nul
if not exist "%SHARE_DB%" if exist "%~dp0seed\\dispatch.db" copy /Y "%~dp0seed\\dispatch.db" "%SHARE_DB%" >nul
set "DATABASE_URL=file:Z:/dispatch/dispatch.db"
goto DBREADY
:USELOCAL
echo [경고] 공유폴더 연결 실패 - 로컬 DB 사용 ^(이 PC 전용, 데이터 미공유^)
if not exist "%LOCAL_DIR%" mkdir "%LOCAL_DIR%"
if not exist "%LOCAL_DB%" if exist "%~dp0seed\\dispatch.db" copy /Y "%~dp0seed\\dispatch.db" "%LOCAL_DB%" >nul
set "DATABASE_URL=file:C:/dispatch_app/dispatch.db"
:DBREADY

echo [3/5] 기사 데이터 동기화...
cd /d "%~dp0"
"%NODE%" init-drivers.js

echo [4/5] SAP 폴더 감시 watcher (백그라운드)
start "SAP-Watcher" /MIN /D "%~dp0" "%NODE%" watch-sap-folder.js

echo [5/5] 앱 시작
echo.
echo  이 PC: http://localhost:3000
echo  다른 PC에서 접속할 주소 (아래 IPv4 사용 → http://IPv4:3000):
ipconfig | findstr /c:"IPv4"
echo  종료: Ctrl+C
echo ========================================
echo.

set "NEXTAUTH_SECRET=dispatch-secret-key-change-in-production"
set "PORT=3000"
set "HOSTNAME=0.0.0.0"
"%NODE%" run-server.js
set EXITCODE=%ERRORLEVEL%

echo.
taskkill /F /FI "WINDOWTITLE eq SAP-Watcher*" >nul 2>&1
echo 서버 종료 (exit: %EXITCODE%^)
pause
`);

// ────── 7. download-sap.bat (CP949, 32-bit PowerShell) ──────
console.log('\n[7] download-sap.bat');
writeCP949(path.join(inner, 'download-sap.bat'), `@echo off
chcp 65001 >nul
title SAP 배차 진행정보 자동 다운로드

echo ========================================
echo  SAP 배차 진행정보 자동 다운로드
echo ========================================
echo  ▶ SAP에 이미 로그인되어 있어야 합니다
echo.
pause

cd /d "%~dp0"

rem 32-bit PowerShell 명시 (SAP GUI 32-bit COM 호환)
set "PS32=%SystemRoot%\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe"
if exist "%PS32%" (
    "%PS32%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-sap.ps1"
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-sap.ps1"
)

echo.
pause
`);

// ────── 8. reset-server-db.bat (CP949) ──────
console.log('\n[8] reset-server-db.bat');
writeUTF8CRLF(path.join(inner, 'reset-server-db.bat'), `@echo off
chcp 65001 >nul
title 서버 DB 초기화
setlocal enabledelayedexpansion

echo ========================================
echo  서버 DB 초기화 (시드로 재설정)
echo ========================================
echo.
set /p CONFIRM=계속하시겠습니까? (Y/N):
if /i not "!CONFIRM!"=="Y" ( pause & exit /b 0 )

net use Z: \\\\23.20.121.23\\common /persistent:yes >nul 2>&1
if not exist "Z:\\" ( echo [오류] Z: 매핑 실패 & pause & exit /b 1 )
if not exist "Z:\\dispatch" mkdir "Z:\\dispatch"

if exist "Z:\\dispatch\\dispatch.db" (
    for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
    copy /Y "Z:\\dispatch\\dispatch.db" "Z:\\dispatch\\dispatch_backup_!dt:~0,8!_!dt:~8,6!.db" >nul
    echo 백업 완료
)
copy /Y "%~dp0seed\\dispatch.db" "Z:\\dispatch\\dispatch.db" >nul
echo 초기화 완료
pause
`);

// ────── 9. check-server-db.bat (CP949) ──────
console.log('\n[9] check-server-db.bat');
writeUTF8CRLF(path.join(inner, 'check-server-db.bat'), `@echo off
chcp 65001 >nul
title 서버 DB 진단
setlocal enabledelayedexpansion

net use Z: \\\\23.20.121.23\\common /persistent:yes >nul 2>&1
if not exist "Z:\\" ( echo [오류] Z: 매핑 실패 & pause & exit /b 1 )

if not exist "Z:\\dispatch\\dispatch.db" ( echo [경고] DB 없음 & pause & exit /b 1 )

if not exist "%TEMP%\\dispatch_check" mkdir "%TEMP%\\dispatch_check"
copy /Y "Z:\\dispatch\\dispatch.db" "%TEMP%\\dispatch_check\\db.db" >nul

cd /d "%~dp0"
node -e "const{createClient}=require('@libsql/client');const c=createClient({url:'file:'+process.env.TEMP.replace(/\\\\\\\\/g,'/')+'/dispatch_check/db.db'});(async()=>{try{const cnt=await c.execute('SELECT COUNT(*) AS n FROM Driver');console.log('기사 수:',cnt.rows[0].n);const all=await c.execute('SELECT teamCode,teamName,vehicleNumber FROM Driver ORDER BY teamName');all.rows.forEach((d,i)=>console.log(' '+String(i+1).padStart(2)+' | '+d.teamCode+' | '+d.teamName+' | '+(d.vehicleNumber||'NULL')));}catch(e){console.error(e.message);}})();"

del "%TEMP%\\dispatch_check\\db.db" >nul 2>&1
pause
`);

// ────── 10. watch-sap-folder.js ──────
console.log('\n[10] watch-sap-folder.js');
writeUTF8(path.join(inner, 'watch-sap-folder.js'), `// C:\\temp 폴더 감시 + 자동 업로드 (SAP ZRLEJ56700 저장 위치, DRM 예외 임시경로)
const fs = require('fs');
const path = require('path');
const os = require('os');

const WATCH_DIR = 'C:\\\\temp';
const PROCESSED_DIR = path.join(WATCH_DIR, 'processed');
const LOCK_FILE = path.join(WATCH_DIR, '.sap-import.lock');
const SERVER_URL = process.env.WATCHER_SERVER_URL || 'http://localhost:3000';
const LOCK_MAX_AGE_MS = 5 * 60 * 1000;

fs.mkdirSync(WATCH_DIR, { recursive: true });
fs.mkdirSync(PROCESSED_DIR, { recursive: true });
const processing = new Set();

function pickUploadType(f) { return /SAMEDAY|SAME_DAY|당일/i.test(f) ? 'SAME_DAY_DELIVERY' : 'PREV_DELIVERY'; }
function pickInstallDate(f) {
    const m = f.match(/(20\\d{2})[-_.]?(\\d{2})[-_.]?(\\d{2})/);
    if (m) return \`\${m[1]}-\${m[2]}-\${m[3]}\`;
    return new Date().toISOString().slice(0, 10);
}

async function upload(fp, name) {
    const buf = fs.readFileSync(fp);
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fd = new FormData();
    fd.append('file', blob, name);
    fd.append('uploadType', pickUploadType(name));
    fd.append('installDate', pickInstallDate(name));
    const res = await fetch(\`\${SERVER_URL}/api/delivery/upload\`, { method: 'POST', body: fd });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || \`HTTP \${res.status}\`);
    return data;
}

async function scan() {
    try {
        const ls = fs.statSync(LOCK_FILE);
        if (Date.now() - ls.mtimeMs < LOCK_MAX_AGE_MS) return;
        try { fs.unlinkSync(LOCK_FILE); } catch {}
    } catch {}
    let entries;
    try { entries = fs.readdirSync(WATCH_DIR, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (!e.isFile() || (!/^ZRLEJ56700\\.xlsx$/i.test(e.name) && !/^EXPORT_\\d{8}_\\d{6}\\.xlsx$/i.test(e.name)) || processing.has(e.name)) continue;
        const full = path.join(WATCH_DIR, e.name);
        let stat; try { stat = fs.statSync(full); } catch { continue; }
        if (Date.now() - stat.mtimeMs < 1500 || stat.size === 0) continue;
        processing.add(e.name);
        console.log(\`[watcher] 새 파일: \${e.name}\`);
        try {
            const data = await upload(full, e.name);
            console.log(\`[watcher] 완료: \${data.totalRows ?? 0}행, \${data.deliveryCount ?? 0}건\`);
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            fs.renameSync(full, path.join(PROCESSED_DIR, \`\${ts}_\${e.name}\`));
        } catch (err) {
            console.error(\`[watcher] 실패: \${err.message}\`);
            try { fs.renameSync(full, full + '.failed'); } catch {}
        } finally { processing.delete(e.name); }
    }
}

console.log('[watcher] 시작 -', WATCH_DIR);
setInterval(scan, 2000);
scan();
`);

// ────── 11. init-drivers.js ──────
console.log('\n[11] init-drivers.js');
writeUTF8(path.join(inner, 'init-drivers.js'), `// 시드 DB의 기사 데이터를 서버 DB에 동기화 (teamCode 기준)
const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

async function main() {
    const serverUrl = process.env.DATABASE_URL;
    if (!serverUrl) { console.log('[init-drivers] DATABASE_URL 미설정'); process.exit(0); }
    const seedPath = path.join(__dirname, 'seed', 'dispatch.db');
    if (!fs.existsSync(seedPath)) { console.log('[init-drivers] seed 없음'); process.exit(0); }
    const server = createClient({ url: serverUrl });
    const seed = createClient({ url: 'file:' + seedPath.replace(/\\\\/g, '/') });
    try {
        const seedRes = await seed.execute('SELECT * FROM Driver');
        if (!seedRes.rows.length) return;
        let serverByCode = new Map();
        try {
            const r = await server.execute('SELECT teamCode, teamName, vehicleNumber FROM Driver');
            r.rows.forEach(d => serverByCode.set(d.teamCode, { teamName: d.teamName, vehicleNumber: d.vehicleNumber }));
        } catch {}
        const cols = seedRes.columns;
        const insertSql = 'INSERT INTO Driver (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')';
        let i = 0, r = 0, u = 0, s = 0;
        for (const row of seedRes.rows) {
            const code = row.teamCode, name = row.teamName, plate = row.vehicleNumber;
            if (!serverByCode.has(code)) {
                try { await server.execute({ sql: insertSql, args: cols.map(c => row[c]) }); i++; console.log('  + 추가:', name); }
                catch (e) { console.error('  ✗ 추가:', name, e.message); }
            } else {
                const srv = serverByCode.get(code);
                if (srv.teamName !== name && srv.vehicleNumber !== plate) {
                    await server.execute({ sql: 'UPDATE Driver SET teamName=?, vehicleNumber=?, updatedAt=CURRENT_TIMESTAMP WHERE teamCode=?', args: [name, plate, code] });
                    r++; console.log('  ↻ 개명+차량:', srv.teamName, '→', name);
                } else if (srv.teamName !== name) {
                    await server.execute({ sql: 'UPDATE Driver SET teamName=?, updatedAt=CURRENT_TIMESTAMP WHERE teamCode=?', args: [name, code] });
                    r++; console.log('  ↻ 개명:', srv.teamName, '→', name);
                } else if (srv.vehicleNumber !== plate) {
                    await server.execute({ sql: 'UPDATE Driver SET vehicleNumber=?, updatedAt=CURRENT_TIMESTAMP WHERE teamCode=?', args: [plate, code] });
                    u++; console.log('  ↻ 차량:', name);
                } else s++;
            }
        }
        console.log('[init-drivers] 추가 ' + i + ' / 개명 ' + r + ' / 차량 ' + u + ' / 동일 ' + s);
    } catch (e) { console.error('[init-drivers]', e.message); process.exit(1); }
}
main();
`);

// ────── 12. download-sap.ps1 (UTF-8 BOM, 32-bit 자가 재호출) ──────
console.log('\n[12] download-sap.ps1');
writeUTF8BOM(path.join(inner, 'download-sap.ps1'), `# SAP 배차 진행정보 자동 다운로드 (ZRLEJ56700)
# 32-bit PowerShell + UTF-8 BOM (SAP GUI 32-bit 호환)

param(
    [string]$Plant = "L106",
    [string]$CarrierCode = "CA06E"
)

$ErrorActionPreference = 'Continue'

# 64-bit이면 32-bit로 자가 재호출
if ([Environment]::Is64BitProcess) {
    $ps32 = "$env:SystemRoot\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe"
    if (Test-Path $ps32) {
        Write-Host "[안내] 64-bit -> 32-bit PowerShell로 재실행..." -ForegroundColor Cyan
        & $ps32 -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Plant $Plant -CarrierCode $CarrierCode
        exit $LASTEXITCODE
    }
}

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 | Out-Null
} catch {}

$DownloadDir = "C:\\temp"
if (-not (Test-Path -LiteralPath $DownloadDir)) {
    New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
}
$FileName = "ZRLEJ56700.xlsx"
$arch = if ([Environment]::Is64BitProcess) { '64-bit' } else { '32-bit' }

Write-Host "========================================"
Write-Host " SAP 배차 진행정보 자동 다운로드 (ZRLEJ56700)"
Write-Host "========================================"
Write-Host " PowerShell:     $($PSVersionTable.PSVersion) ($arch)"
Write-Host " Plant:          $Plant"
Write-Host " Carrier Code:   $CarrierCode"
Write-Host " 저장 폴더:      $DownloadDir"
Write-Host " 파일명:         $FileName"
Write-Host "========================================"
Write-Host ""

Write-Host "[1/5] SAP GUI 연결..."
$SapGuiAuto = $null
try {
    Add-Type -AssemblyName Microsoft.VisualBasic
    $SapGuiAuto = [Microsoft.VisualBasic.Interaction]::GetObject($null, "SAPGUI")
    Write-Host "      OK (GetObject)" -ForegroundColor Green
} catch {
    Write-Host "      방법1 실패: $($_.Exception.Message)" -ForegroundColor Yellow
}
if ($null -eq $SapGuiAuto) {
    try {
        $SapGuiAuto = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SAPGUI")
        Write-Host "      OK (GetActiveObject)" -ForegroundColor Green
    } catch {
        Write-Host "      방법2 실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
if ($null -eq $SapGuiAuto) {
    try {
        $rot = New-Object -ComObject "SapROTWr.SapROTWrapper"
        $SapGuiAuto = $rot.GetROTEntry("SAPGUI")
        Write-Host "      OK (SapROTWr)" -ForegroundColor Green
    } catch {
        Write-Host "      방법3 실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
if ($null -eq $SapGuiAuto) {
    Write-Host "[오류] SAP GUI 접근 실패" -ForegroundColor Red
    Read-Host "Enter로 종료"
    exit 1
}

try { $application = $SapGuiAuto.GetScriptingEngine() }
catch { try { $application = $SapGuiAuto.GetScriptingEngine } catch { Write-Host "[오류] GetScriptingEngine" -ForegroundColor Red; Read-Host; exit 1 } }

if ($application.Children.Count -eq 0) {
    Write-Host "[오류] SAP 연결 없음 (Children=0). SAP 로그인 확인" -ForegroundColor Red
    Read-Host "Enter로 종료"
    exit 1
}
$connection = $application.Children(0)
if ($connection.Children.Count -eq 0) {
    Write-Host "[오류] SAP 세션 없음" -ForegroundColor Red
    Read-Host "Enter로 종료"
    exit 1
}
$session = $connection.Children(0)
Write-Host "      세션 OK" -ForegroundColor Green

Write-Host "[2/5] 트랜잭션 호출..."
$session.findById("wnd[0]").maximize()
$session.findById("wnd[0]/tbar[0]/okcd").text = "zrlej56700"
$session.findById("wnd[0]").sendVKey(0)
Start-Sleep -Milliseconds 800
Write-Host "      OK"

Write-Host "[3/5] 파라미터 입력..."
$session.findById("wnd[0]/usr/ctxtS_RWERKS-LOW").text = $Plant
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").text = $CarrierCode
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").setFocus()
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").caretPosition = 5
Write-Host "      OK"

Write-Host "[4/5] 조회 실행 (F8)..."
$session.findById("wnd[0]").sendVKey(8)
Start-Sleep -Seconds 3
Write-Host "      OK"

Write-Host "[5/5] 엑셀 export (EXDL)..."
try {
    try { $session.findById("wnd[0]/shellcont/shell/shellcont/shell").pressToolbarButton("EXDL") }
    catch { $session.findById("wnd[0]/shellcont/shell/shellcont[1]/shell").pressToolbarButton("EXDL") }
    Start-Sleep -Milliseconds 1500
    try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {}
    Start-Sleep -Milliseconds 1500
    # SAP 저장 다이얼로그(있으면) 경로/파일명 지정 후 저장
    try {
        $session.findById("wnd[1]/usr/ctxtDY_PATH").text = $DownloadDir
        $session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = $FileName
        $session.findById("wnd[1]/tbar[0]/btn[0]").press()
    } catch {}
    Start-Sleep -Milliseconds 1500
    # 덮어쓰기 확인
    try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {}
    Write-Host "      OK"
} catch {
    Write-Host "      [오류] $($_.Exception.Message)" -ForegroundColor Red
}

Start-Sleep -Seconds 2
$saved = Join-Path $DownloadDir $FileName
if (Test-Path -LiteralPath $saved) {
    Write-Host "✓ 다운로드 완료: $saved" -ForegroundColor Green
} else {
    Write-Host "[안내] $DownloadDir 폴더 확인" -ForegroundColor Yellow
}
exit 0
`);

// ────── 13. 용량 정리 ──────
console.log('\n[13] 용량 정리');
const prismaDir = path.join(stubBase);
['studio-core', 'dev', 'fetch-engine', 'engines', 'query-plan-executor',
 'streams-local', 'get-platform', 'adapter-pg', 'engines-version', 'config']
.forEach(n => {
    const p = path.join(prismaDir, n);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
});
const runtimeDir = path.join(prismaDir, 'client', 'runtime');
if (fs.existsSync(runtimeDir)) {
    ['sqlserver', 'cockroachdb', 'postgresql', 'mysql'].forEach(pat => {
        fs.readdirSync(runtimeDir).filter(f => f.includes(pat)).forEach(f => {
            fs.rmSync(path.join(runtimeDir, f), { force: true });
        });
    });
}
function rmFilesRecurse(dir, predicate) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) rmFilesRecurse(p, predicate);
        else if (predicate(e.name)) try { fs.rmSync(p, { force: true }); } catch {}
    }
}
rmFilesRecurse(inner, n => n.endsWith('.map') || n.endsWith('.d.ts'));

// ────── 14. 결과 ──────
const total = (function calc(d) {
    let s = 0;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) s += calc(p);
        else s += fs.statSync(p).size;
    }
    return s;
})(inner) / 1024 / 1024;

console.log('\\n========================================');
console.log('standalone 크기: ' + total.toFixed(1) + ' MB');
console.log('========================================');
