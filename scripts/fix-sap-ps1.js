// download-sap.ps1을 UTF-8 with BOM으로 재저장
// PowerShell 5.x는 BOM 없는 UTF-8을 CP949로 해석해서 한글 깨짐
const fs = require('fs');

const ps1 = `# SAP 배차 진행정보 자동 다운로드 (ZRLEK51270)
# 인코딩: UTF-8 with BOM (PowerShell 5.x 한글 호환)

param(
    [string]$ShippingPoint = "a062",
    [string]$CarrierCode = "CA06E"
)

$ErrorActionPreference = 'Continue'

# 다운로드 폴더 (한글)
$DownloadDir = Join-Path $env:USERPROFILE "Desktop\\배차진행정보"
if (-not (Test-Path -LiteralPath $DownloadDir)) {
    New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
}
$Today = Get-Date -Format "yyyyMMdd"
$FileName = "dispatch_$Today.xlsx"

Write-Host "========================================"
Write-Host " SAP 배차 진행정보 자동 다운로드"
Write-Host "========================================"
Write-Host " Shipping Point: $ShippingPoint"
Write-Host " Carrier Code:   $CarrierCode"
Write-Host " 저장 폴더:      $DownloadDir"
Write-Host " 파일명:         $FileName"
Write-Host "========================================"
Write-Host ""

# 1) SAP GUI 연결
Write-Host "[1/5] SAP GUI 연결..."
try {
    $SapGuiAuto = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SAPGUI")
} catch {
    Write-Host "[오류] SAP GUI가 실행 중이지 않습니다." -ForegroundColor Red
    Write-Host "       SAP에 로그인 후 다시 실행하세요." -ForegroundColor Yellow
    Read-Host "Enter로 종료"
    exit 1
}
$application = $SapGuiAuto.GetScriptingEngine
$connection = $application.Children(0)
$session = $connection.Children(0)
Write-Host "      OK"

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

# 4) F8 실행
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

    # 1차 다이얼로그 (옵션 확인)
    try { $session.findById("wnd[1]/tbar[0]/btn[20]").press() } catch {
        try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {}
    }
    Start-Sleep -Milliseconds 1200

    # 2차 다이얼로그 (파일 저장 - 파일명/경로)
    try {
        $session.findById("wnd[1]/usr/ctxtDY_PATH").text = $DownloadDir
        $session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = $FileName
        Write-Host "      경로/파일명 설정 완료"
    } catch {
        Write-Host "      [참고] 파일명 자동 입력 ID 못 찾음 (디폴트 경로 사용)" -ForegroundColor Yellow
    }
    Start-Sleep -Milliseconds 300

    # 저장
    try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {
        try { $session.findById("wnd[1]/tbar[0]/btn[11]").press() } catch {}
    }
    Start-Sleep -Milliseconds 1500

    # 덮어쓰기 dialog
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
    Write-Host "[안내] 자동 저장 결과를 확인할 수 없습니다." -ForegroundColor Yellow
    Write-Host "       $DownloadDir 폴더 확인" -ForegroundColor Yellow
    Write-Host "       또는 SAP 화면에서 수동 저장하셔도 watcher가 처리합니다." -ForegroundColor Yellow
}

Write-Host ""
exit 0
`;

// UTF-8 with BOM으로 저장 (\\uFEFF prefix)
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

// 검증: 첫 3바이트가 BOM인지
const verify = fs.readFileSync(targets[0]);
console.log('첫 3바이트:',
    verify[0].toString(16).toUpperCase(),
    verify[1].toString(16).toUpperCase(),
    verify[2].toString(16).toUpperCase(),
    (verify[0] === 0xEF && verify[1] === 0xBB && verify[2] === 0xBF) ? '✓ UTF-8 BOM' : '✗ BOM 없음');
