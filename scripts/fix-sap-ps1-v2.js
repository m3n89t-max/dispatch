// download-sap.ps1 - SAP GUI 접근 방법 다중화 + 더 자세한 진단
const fs = require('fs');

const ps1 = `# SAP 배차 진행정보 자동 다운로드 (ZRLEK51270)
# 인코딩: UTF-8 with BOM
# PowerShell 5.x / 7+ 호환

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

Write-Host "========================================"
Write-Host " SAP 배차 진행정보 자동 다운로드"
Write-Host "========================================"
Write-Host " PowerShell:     $($PSVersionTable.PSVersion)"
Write-Host " PS Edition:     $($PSVersionTable.PSEdition)"
Write-Host " Architecture:   $([Environment]::Is64BitProcess ? '64-bit' : '32-bit')"
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

# 방법 2: GetActiveObject (PowerShell 5.x만 동작)
if ($null -eq $SapGuiAuto) {
    try {
        $SapGuiAuto = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SAPGUI")
        Write-Host "      OK (Marshal.GetActiveObject)" -ForegroundColor Green
    } catch {
        Write-Host "      방법2 (GetActiveObject) 실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 방법 3: SapROTWr.SapROTWrapper (SAP 공식 헬퍼)
if ($null -eq $SapGuiAuto) {
    try {
        $SapGuiAuto = New-Object -ComObject "SapROTWr.SapROTWrapper"
        $SapGuiAuto = $SapGuiAuto.GetROTEntry("SAPGUI")
        Write-Host "      OK (SapROTWr)" -ForegroundColor Green
    } catch {
        Write-Host "      방법3 (SapROTWr) 실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if ($null -eq $SapGuiAuto) {
    Write-Host ""
    Write-Host "[오류] SAP GUI에 접근할 수 없습니다." -ForegroundColor Red
    Write-Host "       체크리스트:" -ForegroundColor Yellow
    Write-Host "         1. SAP GUI가 실행 중인지 (Logon Pad 아님, 실제 SAP 창)"
    Write-Host "         2. SAP Logon Options -> Accessibility & Scripting -> Scripting 활성화"
    Write-Host "         3. PowerShell 64-bit + SAP GUI 64-bit (또는 둘 다 32-bit) 매칭"
    Write-Host "         4. 관리자 권한 PowerShell이면 SAP GUI도 관리자 권한이어야 함"
    Write-Host ""
    Read-Host "Enter로 종료"
    exit 1
}

# Scripting Engine 가져오기
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

# Connection / Session 가져오기
if ($application.Children.Count -eq 0) {
    Write-Host "[오류] SAP 연결이 없습니다. SAP에 로그인 후 다시 실행하세요." -ForegroundColor Red
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

# 3) 파라미터 입력
Write-Host "[3/5] 파라미터 입력..."
$session.findById("wnd[0]/usr/ctxtS_VSTEL-LOW").text = $ShippingPoint
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").text = $CarrierCode
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").setFocus()
$session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").caretPosition = 5
Write-Host "      OK"

# 4) 실행
Write-Host "[4/5] 조회 실행 (F8)..."
$session.findById("wnd[0]").sendVKey(8)
Start-Sleep -Seconds 3
Write-Host "      OK"

# 5) 엑셀 export
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

# 결과 확인
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

const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
const body = Buffer.from(ps1, 'utf8');
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
