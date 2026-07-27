// PowerShell 대신 VBScript로 SAP 자동화
// 녹화된 VBS와 동일한 GetObject 방식 → SapROTWr의 PS COM 호출 이슈 회피
//
// 2026-06 ZRLEJ56700 전환:
//   - tcode: zrlej56700
//   - 선택화면: S_RWERKS-LOW(플랜트) + S_CARCD-LOW(캐리어), 날짜 파라미터 없음
//   - export: ALV toolbar "EXDL"(스프레드시트) → wnd[1] 확인 → Windows 저장 다이얼로그
//   - 저장 파일명은 watcher 패턴 EXPORT_YYYYMMDD_HHMMSS.xlsx 으로 C:\temp 에 저장
const fs = require('fs');
const iconv = require('iconv-lite');

const targets = {
    usb: 'D:\\제주배차시스템_standalone_20260605',
    local: 'c:\\Users\\m3n89\\Desktop\\Dispatch\\dispatch\\.next\\standalone\\Desktop\\Dispatch\\dispatch',
    cwd: 'c:\\Users\\m3n89\\Desktop\\Dispatch\\dispatch',  // dev 서버 cwd
};

// ─── 1. download-sap.vbs (CP949) ───
// CP949: cscript 한국어 Windows에서 안정적
const vbs = `' SAP 배차 진행정보 자동 다운로드 (ZRLEJ56700)
' VBScript - PowerShell COM 호출 우회

Dim Plant, CarrierCode
Plant = "L106"        ' S_RWERKS-LOW (플랜트)
CarrierCode = "CA06E" ' S_CARCD-LOW (캐리어)

' 명령줄 인자 처리
If WScript.Arguments.Count >= 1 Then Plant = WScript.Arguments(0)
If WScript.Arguments.Count >= 2 Then CarrierCode = WScript.Arguments(1)

' 다운로드/감시 폴더: C:\\temp (DRM 예외 임시경로, ASCII라 저장 다이얼로그 경로 입력 안정적)
Dim shellObj, DownloadDir, FileName
Set shellObj = CreateObject("WScript.Shell")
DownloadDir = "C:\\temp"

' 폴더 생성 (이미 있어도 무시)
Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")
On Error Resume Next
fso.CreateFolder(DownloadDir)
Err.Clear
On Error Goto 0

' 파일명: SAP EXDL 기본 저장명 = ZRLEJ56700.xlsx (고정, 매번 덮어쓰기)
FileName = "ZRLEJ56700.xlsx"

WScript.Echo "========================================"
WScript.Echo " SAP 배차 진행정보 자동 다운로드 (ZRLEJ56700)"
WScript.Echo "========================================"
WScript.Echo " Plant:        " & Plant
WScript.Echo " Carrier Code: " & CarrierCode
WScript.Echo " 저장 폴더:    " & DownloadDir
WScript.Echo " 파일명:       " & FileName
WScript.Echo "========================================"
WScript.Echo ""

' SAP GUI 연결 (VBScript GetObject - 가장 안정적)
WScript.Echo "[1/5] SAP GUI 연결..."

On Error Resume Next
Dim SapGuiAuto
Set SapGuiAuto = GetObject("SAPGUI")
If Err.Number <> 0 Then
    WScript.Echo "[오류] GetObject(""SAPGUI"") 실패: " & Err.Description
    WScript.Echo "       SAP가 실행 중이고 로그인 상태인지 확인하세요."
    WScript.Quit 1
End If

Dim application
Set application = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Then
    WScript.Echo "[오류] GetScriptingEngine 실패: " & Err.Description
    WScript.Quit 1
End If
On Error Goto 0

If application.Children.Count = 0 Then
    WScript.Echo "[오류] SAP 연결이 없습니다 (Children=0)."
    WScript.Echo "       SAP Easy Access 화면이 떠 있는지 확인."
    WScript.Echo "       SAP 서버측 sapgui/user_scripting=TRUE 확인."
    WScript.Quit 1
End If

Dim connection
Set connection = application.Children(0)
If connection.Children.Count = 0 Then
    WScript.Echo "[오류] SAP 세션이 없습니다."
    WScript.Quit 1
End If

Dim session
Set session = connection.Children(0)
WScript.Echo "      OK"

' 트랜잭션 호출
WScript.Echo "[2/5] 트랜잭션 호출 (zrlej56700)..."
session.findById("wnd[0]/tbar[0]/okcd").text = "zrlej56700"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 800
WScript.Echo "      OK"

' 파라미터 입력 (녹화 기준: S_RWERKS-LOW=플랜트, S_CARCD-LOW=캐리어)
WScript.Echo "[3/5] 파라미터 입력..."
session.findById("wnd[0]/usr/ctxtS_RWERKS-LOW").text = Plant
session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").text = CarrierCode
session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").setFocus
session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").caretPosition = 5
WScript.Echo "      OK (S_RWERKS=" & Plant & ", S_CARCD=" & CarrierCode & ")"

' 조회 (F8)
WScript.Echo "[4/5] 조회 실행 (F8)..."
session.findById("wnd[0]").sendVKey 8
WScript.Sleep 4000
WScript.Echo "      OK"

' Export → ALV toolbar "EXDL" (스프레드시트)
WScript.Echo "[5/5] 엑셀 export (EXDL)..."
On Error Resume Next
session.findById("wnd[0]/shellcont/shell/shellcont/shell").pressToolbarButton "EXDL"
If Err.Number <> 0 Then
    ' 레이아웃에 따라 shell 경로가 다를 수 있음 → 대체 경로 시도
    Err.Clear
    session.findById("wnd[0]/shellcont/shell/shellcont[1]/shell").pressToolbarButton "EXDL"
End If
Err.Clear
On Error Goto 0
WScript.Sleep 1500

' SAP 포맷/확인 다이얼로그 (녹화: wnd[1]/tbar[0]/btn[0])
On Error Resume Next
session.findById("wnd[1]/tbar[0]/btn[0]").press
Err.Clear
On Error Goto 0
WScript.Sleep 2000

' Windows "다른 이름으로 저장" 다이얼로그 → 전체 경로(C:\\temp\\ZRLEJ56700.xlsx) 직접 입력
' (C:\\temp는 ASCII라 SendKeys 안정적, DRM 예외 경로)
WScript.Echo "      파일 저장: " & DownloadDir & "\\" & FileName
shellObj.SendKeys "^a"
WScript.Sleep 300
shellObj.SendKeys DownloadDir & "\\" & FileName
WScript.Sleep 600
shellObj.SendKeys "{ENTER}"
WScript.Sleep 2000
' "이미 있습니다 - 바꾸시겠습니까?" → 예 (항상 덮어쓰기)
WScript.Echo "      덮어쓰기 → 예"
shellObj.SendKeys "%Y"
WScript.Sleep 300
shellObj.SendKeys "{ENTER}"
WScript.Sleep 1500
WScript.Echo "      OK"

' SAP 메인 화면 복귀 (Shift+F3 ×2)
WScript.Echo "      SAP 메인 화면 복귀"
WScript.Sleep 1500
On Error Resume Next
session.findById("wnd[0]").sendVKey 15
Err.Clear
WScript.Sleep 1200
session.findById("wnd[0]").sendVKey 15
Err.Clear
' 안전망 - /n 으로 메인 메뉴 강제 이동
session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
Err.Clear
session.findById("wnd[0]").sendVKey 0
Err.Clear
On Error Goto 0
WScript.Sleep 1500
WScript.Echo "      → 메인 화면 복귀 완료"

' 결과 확인
WScript.Sleep 2000
Dim savedFile
savedFile = DownloadDir & "\\" & FileName
If fso.FileExists(savedFile) Then
    Dim fileObj
    Set fileObj = fso.GetFile(savedFile)
    WScript.Echo ""
    WScript.Echo "========================================"
    WScript.Echo " 다운로드 완료"
    WScript.Echo "   " & savedFile
    WScript.Echo "   " & Round(fileObj.Size / 1024, 1) & " KB"
    WScript.Echo "========================================"
Else
    WScript.Echo "[안내] 파일 자동 저장 결과 확인 안됨 - C:\\temp 폴더와 저장 다이얼로그를 확인하세요"
End If

WScript.Quit 0
`;

// VBS는 CP949로 저장 (한국어 Windows cscript 호환)
const cp949 = iconv.encode(vbs, 'cp949');
for (const [name, dir] of Object.entries(targets)) {
    try {
        fs.writeFileSync(`${dir}\\download-sap.vbs`, cp949);
        console.log(`✓ download-sap.vbs (CP949): ${dir} (${cp949.length} bytes)`);
    } catch (e) { console.log(`✗ ${name}: ${e.message}`); }
}

// ─── 2. download-sap.bat (cscript로 VBS 호출 - 자동 모드, pause 없음) ───
const bat = `@echo off
chcp 949 >nul
title SAP 배차 진행정보 자동 다운로드
cd /d "%~dp0"
cscript //NoLogo "%~dp0download-sap.vbs" > "%USERPROFILE%\\Desktop\\sap-debug.log" 2>&1
exit /b %ERRORLEVEL%
`;

const batBytes = iconv.encode(bat.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'cp949');
for (const [name, dir] of Object.entries(targets)) {
    try {
        fs.writeFileSync(`${dir}\\download-sap.bat`, batBytes);
        console.log(`✓ download-sap.bat (CP949): ${dir}`);
    } catch (e) { console.log(`✗ ${name}: ${e.message}`); }
}
