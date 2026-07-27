# SAP 배차 진행정보 자동 다운로드 (ZRLEK51270)
# 녹화된 VBS를 기반으로 작성됨 (2026-06-08)
# 전제: 사용자가 이미 SAP에 로그인되어 있고, Scripting 활성화됨

param(
    [string]$ShippingPoint = "a062",
    [string]$CarrierCode = "CA06E"
)

$ErrorActionPreference = 'Stop'

# 다운로드 폴더 (watcher가 감시하는 곳)
$DownloadDir = Join-Path $env:USERPROFILE "Desktop\차량별배차진행정보"
if (-not (Test-Path $DownloadDir)) {
    New-Item -ItemType Directory -Force $DownloadDir | Out-Null
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
    Write-Host "[오류] SAP GUI가 실행 중이지 않습니다. SAP 로그인 후 다시 실행하세요." -ForegroundColor Red
    Read-Host "계속하려면 Enter"
    exit 1
}
$application = $SapGuiAuto.GetScriptingEngine
$connection = $application.Children(0)
$session = $connection.Children(0)
Write-Host "      OK"

# 2) 트랜잭션 ZRLEK51270 호출
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
Write-Host "      OK (S_VSTEL=$ShippingPoint, S_CARCD=$CarrierCode)"

# 4) F8 실행
Write-Host "[4/5] 조회 실행 (F8)..."
$session.findById("wnd[0]").sendVKey(8)
Start-Sleep -Seconds 3
Write-Host "      OK"

# 5) 엑셀로 export
Write-Host "[5/5] 엑셀로 export..."
try {
    $shell = $session.findById("wnd[0]/shellcont/shell/shellcont[1]/shell")
    $shell.pressToolbarContextButton("&MB_EXPORT")
    Start-Sleep -Milliseconds 500
    $shell.selectContextMenuItem("&XXL")
    Start-Sleep -Milliseconds 1000

    # 첫 번째 다이얼로그: 옵션 확인
    try {
        $session.findById("wnd[1]/tbar[0]/btn[20]").press()
    } catch {
        # btn[20]이 없으면 OK (btn[0]) 시도
        try { $session.findById("wnd[1]/tbar[0]/btn[0]").press() } catch {}
    }
    Start-Sleep -Milliseconds 1000

    # 두 번째 다이얼로그: 파일 저장 - 파일명/경로 설정
    try {
        # SAP 파일 저장 다이얼로그 표준 ID
        $session.findById("wnd[1]/usr/ctxtDY_PATH").text = $DownloadDir
        $session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = $FileName
        Write-Host "      파일명/경로 설정 완료"
    } catch {
        Write-Host "      [참고] 파일명 자동 입력 ID를 못 찾았습니다 (정상일 수 있음)"
        Write-Host "             SAP가 디폴트 경로에 저장하거나, 다이얼로그에서 수동 입력해주세요"
    }

    Start-Sleep -Milliseconds 300

    # 저장 (보통 Replace/Overwrite의 경우 추가 dialog가 뜰 수 있음)
    try {
        $session.findById("wnd[1]/tbar[0]/btn[0]").press()  # Save / Generate
    } catch {
        # 다른 dialog 일 수도
        try { $session.findById("wnd[1]/tbar[0]/btn[11]").press() } catch {}
    }
    Start-Sleep -Milliseconds 1500

    # 덮어쓰기 확인 dialog가 또 뜰 수 있음
    try {
        $session.findById("wnd[1]/tbar[0]/btn[0]").press()
    } catch {}

    Write-Host "      OK"
} catch {
    Write-Host "      [오류] export 단계 실패: $_" -ForegroundColor Red
    Write-Host "             SAP 화면에서 수동으로 List > Save > Local File 실행 후 $DownloadDir 에 저장하세요"
}

# 결과 확인
Start-Sleep -Seconds 2
$savedFile = Join-Path $DownloadDir $FileName
if (Test-Path $savedFile) {
    $size = (Get-Item $savedFile).Length / 1KB
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host " ✓ 다운로드 완료" -ForegroundColor Green
    Write-Host "   $savedFile ($([math]::Round($size,1)) KB)" -ForegroundColor Green
    Write-Host "   watcher가 자동으로 업로드합니다." -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[안내] 자동 저장 결과를 확인할 수 없습니다." -ForegroundColor Yellow
    Write-Host "       $DownloadDir 폴더에 파일이 생성됐는지 확인해주세요." -ForegroundColor Yellow
    Write-Host "       다른 위치에 저장됐다면 그 파일을 $DownloadDir 로 옮기면 watcher가 처리합니다." -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Enter로 종료"
