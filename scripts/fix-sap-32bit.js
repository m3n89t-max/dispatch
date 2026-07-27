// SAP 자동화를 32-bit PowerShell로 실행하도록 변경
// (SAP GUI는 대부분 32-bit이라 64-bit PowerShell에서 COM 접근 불가)
const fs = require('fs');
const iconv = require('iconv-lite');

// ─── download-sap.bat: 32-bit PowerShell 명시 호출 ───
const downloadBatContent = [
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
  '',
  'rem 32-bit PowerShell 명시 호출 (SAP GUI 32-bit 호환)',
  'set "PS32=%SystemRoot%\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe"',
  'if exist "%PS32%" (',
  '    "%PS32%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-sap.ps1"',
  ') else (',
  '    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-sap.ps1"',
  ')',
  '',
  'echo.',
  'pause',
  ''
].join('\r\n');

const cp949 = iconv.encode(downloadBatContent, 'cp949');
['D:\\제주배차시스템_standalone_20260605\\download-sap.bat',
 'c:\\Users\\m3n89\\Desktop\\Dispatch\\dispatch\\.next\\standalone\\Desktop\\Dispatch\\dispatch\\download-sap.bat'].forEach(p => {
  try { fs.writeFileSync(p, cp949); console.log('✓ download-sap.bat:', p); }
  catch (e) { console.log('✗', p, e.message); }
});

// ─── download-sap.ps1: 64-bit이면 32-bit으로 자가 재호출 ───
const ps1 = `# SAP 배차 진행정보 자동 다운로드 (ZRLEK51270)
# 32-bit PowerShell + UTF-8 BOM
# SAP GUI(32-bit)와 호환 위해 32-bit로 실행 필요

param(
    [string]$ShippingPoint = "a062",
    [string]$CarrierCode = "CA06E"
)

$ErrorActionPreference = 'Continue'

# 64-bit PowerShell이면 32-bit로 자가 재호출
if ([Environment]::Is64BitProcess) {
    $ps32 = "$env:SystemRoot\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe"
    if (Test-Path $ps32) {
        Write-Host "[안내] 64-bit -> 32-bit PowerShell로 재실행..." -ForegroundColor Cyan
        & $ps32 -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath \`
            -ShippingPoint $ShippingPoint -CarrierCode $CarrierCode
        exit $LASTEXITCODE
    } else {
        Write-Host "[경고] 32-bit PowerShell 없음 - 64-bit으로 계속 시도" -ForegroundColor Yellow
    }
}

# 콘솔 출력 인코딩 UTF-8
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 | Out-Null
} catch {}

$DownloadDir = Join-Path $env:USERPROFILE "Desktop\\배차진행정보"
if (-not (Test-Path -LiteralPath $DownloadDir)) {
    New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
}
$Today = Get-Date -Format "yyyyMMdd"
$FileName = "dispatch_$Today.xlsx"
$arch = if ([Environment]::Is64BitProcess) { '64-bit' } else { '32-bit' }

Write-Host "========================================"
Write-Host " SAP 배차 진행정보 자동 다운로드"
Write-Host "========================================"
Write-Host " PowerShell:     $($PSVersionTable.PSVersion)"
Write-Host " Architecture:   $arch"
Write-Host " Shipping Point: $ShippingPoint"
Write-Host " Carrier Code:   $CarrierCode"
Write-Host " 저장 폴더:      $DownloadDir"
Write-Host " 파일명:         $FileName"
Write-Host "========================================"
Write-Host ""

Write-Host "[1/5] SAP GUI 연결 시도..."
$SapGuiAuto = $null

# 방법 1: GetObject (VBScript 방식 - 32-bit에서 가장 잘 동작)
try {
    Add-Type -AssemblyName Microsoft.VisualBasic
    $SapGuiAuto = [Microsoft.VisualBasic.Interaction]::GetObject($null, "SAPGUI")
    Write-Host "      OK (GetObject)" -ForegroundColor Green
} catch {
    Write-Host "      방법1 실패: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 방법 2: GetActiveObject
if ($null -eq $SapGuiAuto) {
    try {
        $SapGuiAuto = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SAPGUI")
        Write-Host "      OK (GetActiveObject)" -ForegroundColor Green
    } catch {
        Write-Host "      방법2 실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 방법 3: SapROTWr
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
    Write-Host ""
    Write-Host "[오류] SAP GUI에 접근할 수 없습니다." -ForegroundColor Red
    Read-Host "Enter로 종료"
    exit 1
}

try {
    $application = $SapGuiAuto.GetScriptingEngine()
} catch {
    try { $application = $SapGuiAuto.GetScriptingEngine }
    catch {
        Write-Host "[오류] GetScriptingEngine 실패" -ForegroundColor Red
        Read-Host "Enter로 종료"
        exit 1
    }
}

if ($application.Children.Count -eq 0) {
    Write-Host "[오류] SAP 연결이 없습니다 (Children=0). SAP 로그인 후 다시 실행하세요." -ForegroundColor Red
    Read-Host "Enter로 종료"
    exit 1
}

$connection = $application.Children(0)
if ($connection.Children.Count -eq 0) {
    Write-Host "[오류] SAP 세션이 없습니다." -ForegroundColor Red
    Read-Host "Enter로 종료"
    exit 1
}

$session = $connection.Children(0)
Write-Host "      세션 OK: $($session.Info.SystemName)" -ForegroundColor Green

# 2) 트랜잭션
Write-Host "[2/5] 트랜잭션 호출..."
$session.findById("wnd[0]").maximize()
$session.findById("wnd[0]/tbar[0]/okcd").text = "zrlek51270"
$session.findById("wnd[0]").sendVKey(0)
Start-Sleep -Milliseconds 800
Write-Host "      OK"

# 3) 파라미터
Write-Host "[3/5] 파라미터 입력..."
$session.findById("wnd[0]/usr/ctxtS_VSTEL-LOW").text = $ShippingPoint
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").text = $CarrierCode
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").setFocus()
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").caretPosition = 5
Write-Host "      OK"

# 4) F8
Write-Host "[4/5] 조회 실행 (F8)..."
$session.findById("wnd[0]").sendVKey(8)
Start-Sleep -Seconds 3
Write-Host "      OK"

# 5) Export
Write-Host "[5/5] 엑셀로 export..."
try {
    $shell = $session.findById("wnd[0]/shellcont/shell/shellcont[1]/shell")
    $shell.pressToolbarContextButton("&MB_EXPORT")
    Start-Sleep -Milliseconds 500
    $shell.selectContextMenuItem("&XXL")
    Start-Sleep -Milliseconds 1200
    try { $session.findById("wnd[1]/tbar[0]/btn[20]").press() } catch {
        try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {}
    }
    Start-Sleep -Milliseconds 1200
    try {
        $session.findById("wnd[1]/usr/ctxtDY_PATH").text = $DownloadDir
        $session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = $FileName
    } catch {}
    Start-Sleep -Milliseconds 300
    try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {
        try { $session.findById("wnd[1]/tbar[0]/btn[11]").press() } catch {}
    }
    Start-Sleep -Milliseconds 1500
    try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {}
    Write-Host "      OK"
} catch {
    Write-Host "      [오류] $($_.Exception.Message)" -ForegroundColor Red
}

Start-Sleep -Seconds 2
$savedFile = Join-Path $DownloadDir $FileName
if (Test-Path -LiteralPath $savedFile) {
    $size = (Get-Item -LiteralPath $savedFile).Length / 1KB
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host " 다운로드 완료: $savedFile" -ForegroundColor Green
    Write-Host " 크기: $([math]::Round($size,1)) KB" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host "[안내] 자동 저장 결과 확인 안됨" -ForegroundColor Yellow
}

exit 0
`;

const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
const body = Buffer.from(ps1, 'utf8');
const final = Buffer.concat([bom, body]);

['D:\\제주배차시스템_standalone_20260605\\download-sap.ps1',
 'c:\\Users\\m3n89\\Desktop\\Dispatch\\dispatch\\.next\\standalone\\Desktop\\Dispatch\\dispatch\\download-sap.ps1'].forEach(p => {
  try { fs.writeFileSync(p, final); console.log('✓ download-sap.ps1 (UTF-8 BOM):', p); }
  catch (e) { console.log('✗', p, e.message); }
});
