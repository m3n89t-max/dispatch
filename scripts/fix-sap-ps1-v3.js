// download-sap.ps1 v3
// - PowerShell 5.x 호환 syntax (ternary 제거)
// - 콘솔 출력 인코딩 UTF-8 설정 (한글 정상 표시)
const fs = require('fs');

const ps1 = `# SAP 배차 진행정보 자동 다운로드 (ZRLEK51270)
# 인코딩: UTF-8 with BOM
# 호환: PowerShell 5.x / 7+

# 콘솔 출력 인코딩을 UTF-8로 설정 (한글 깨짐 방지)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 | Out-Null
} catch {}

param(
    [string]$ShippingPoint = "a062",
    [string]$CarrierCode = "CA06E"
)

$ErrorActionPreference = 'Continue'

$DownloadDir = Join-Path $env:USERPROFILE "Desktop\\배차진행정보"
if (-not (Test-Path -LiteralPath $DownloadDir)) {
    New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
}
$Today = Get-Date -Format "yyyyMMdd"
$FileName = "dispatch_$Today.xlsx"

# PowerShell 5.x 호환: ternary 대신 if-else
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

# 1) SAP GUI 연결 - 여러 방법 시도
Write-Host "[1/5] SAP GUI 연결 시도..."

$SapGuiAuto = $null

# 방법 1: VBScript GetObject 방식 (녹화된 VBS와 동일)
try {
    Add-Type -AssemblyName Microsoft.VisualBasic
    $SapGuiAuto = [Microsoft.VisualBasic.Interaction]::GetObject($null, "SAPGUI")
    Write-Host "      OK (GetObject)" -ForegroundColor Green
} catch {
    Write-Host "      방법1 (GetObject) 실패: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 방법 2: GetActiveObject (PowerShell 5.x)
if ($null -eq $SapGuiAuto) {
    try {
        $SapGuiAuto = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SAPGUI")
        Write-Host "      OK (Marshal.GetActiveObject)" -ForegroundColor Green
    } catch {
        Write-Host "      방법2 (GetActiveObject) 실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 방법 3: SapROTWr
if ($null -eq $SapGuiAuto) {
    try {
        $rot = New-Object -ComObject "SapROTWr.SapROTWrapper"
        $SapGuiAuto = $rot.GetROTEntry("SAPGUI")
        Write-Host "      OK (SapROTWr)" -ForegroundColor Green
    } catch {
        Write-Host "      방법3 (SapROTWr) 실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if ($null -eq $SapGuiAuto) {
    Write-Host ""
    Write-Host "[오류] SAP GUI에 접근할 수 없습니다." -ForegroundColor Red
    Write-Host "       체크리스트:" -ForegroundColor Yellow
    Write-Host "         1. SAP GUI 실행 중 (Logon Pad 아닌 실제 SAP 창)"
    Write-Host "         2. SAP Logon Options - Accessibility - Scripting 활성화"
    Write-Host "         3. SAP 서버 설정에서 sapgui/user_scripting = TRUE"
    Write-Host "         4. 관리자 권한 매칭 (UAC 없이 둘 다 일반 사용자)"
    Write-Host ""
    Read-Host "Enter로 종료"
    exit 1
}

# Scripting Engine
try {
    $application = $SapGuiAuto.GetScriptingEngine()
} catch {
    try {
        $application = $SapGuiAuto.GetScriptingEngine
    } catch {
        Write-Host "[오류] GetScriptingEngine 실패: $($_.Exception.Message)" -ForegroundColor Red
        Read-Host "Enter로 종료"
        exit 1
    }
}

if ($application.Children.Count -eq 0) {
    Write-Host "[오류] SAP 연결이 없습니다." -ForegroundColor Red
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
        Write-Host "      경로/파일명 설정 완료"
    } catch {
        Write-Host "      [참고] 파일명 자동 입력 ID 못 찾음" -ForegroundColor Yellow
    }
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
    Write-Host " 다운로드 완료" -ForegroundColor Green
    Write-Host "   $savedFile" -ForegroundColor Green
    Write-Host "   $([math]::Round($size,1)) KB" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[안내] 자동 저장 결과 확인 안됨." -ForegroundColor Yellow
    Write-Host "       $DownloadDir 폴더 확인" -ForegroundColor Yellow
}

Write-Host ""
exit 0
`;

// PowerShell 5.x는 param이 첫 번째 코드여야 함 - 잠깐, try{} 블록이 param 앞에 있으면 안됨!
// param 다음에 [Console]... 설정해야

const fixed = ps1.replace(
  /^# SAP 배차 진행정보 자동 다운로드 \(ZRLEK51270\)[\s\S]*?param\(/m,
  `# SAP 배차 진행정보 자동 다운로드 (ZRLEK51270)
# 인코딩: UTF-8 with BOM
# 호환: PowerShell 5.x / 7+

param(`
).replace(
  /\$ErrorActionPreference = 'Continue'\n/,
  `$ErrorActionPreference = 'Continue'

# 콘솔 출력 인코딩을 UTF-8로 설정 (한글 깨짐 방지)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 | Out-Null
} catch {}

`
);

const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
const body = Buffer.from(fixed, 'utf8');
const final = Buffer.concat([bom, body]);

const targets = [
    'D:\\제주배차시스템_standalone_20260605\\download-sap.ps1',
    'c:\\Users\\m3n89\\Desktop\\Dispatch\\dispatch\\.next\\standalone\\Desktop\\Dispatch\\dispatch\\download-sap.ps1',
];

for (const t of targets) {
    try {
        fs.writeFileSync(t, final);
        console.log('✓ UTF-8 BOM 저장:', t, '(' + final.length + ' bytes)');
    } catch (e) {
        console.log('✗ 실패:', t, e.message);
    }
}

// 검증: param 위치
const check = fs.readFileSync(targets[1], 'utf8').replace(/^﻿/, '');
const lines = check.split(/\r?\n/);
const paramLine = lines.findIndex(l => l.trim().startsWith('param('));
const consoleLine = lines.findIndex(l => l.includes('OutputEncoding = [System.Text.Encoding]::UTF8'));
console.log('\\nparam 라인 번호:', paramLine + 1);
console.log('Console 설정 라인:', consoleLine + 1);
console.log(consoleLine > paramLine ? '✓ param이 Console 설정 앞에 있음' : '✗ 순서 문제');

// 첫 30줄 미리보기
console.log('\n=== 첫 30줄 ===');
lines.slice(0, 30).forEach((l, i) => console.log(((i+1)+':').padStart(4) + ' ' + l));
