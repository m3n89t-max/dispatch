' VADS delivery pull (ZLLEK52060 - dispatch progress board)
' ---------------------------------------------------------------------------------
' Pull next-day (tomorrow; skip Sunday -> Monday) deliveries for carrier "e".
' Reads BOTH the delivery number (VBELN) and the assigned vehicle (Vehicle Regis. No.).
'   - vehicle column is auto-detected: the grid column whose values look like a Korean
'     plate (contains a Hangul syllable + a digit, no '*'). "L106ECPT" (unassigned) and
'     other ASCII codes are treated as empty (unassigned).
'
' Output: C:\temp\vads_deliveries.tsv   (header: Delivery<TAB>Vehicle ; UTF-8 no BOM)
' Debug : C:\temp\vads_deliveries.log   (progress + column dump)
' ASCII-only source.

Option Explicit

Dim OUT_PATH, DBG_PATH, CARRIER, GRID_ID
OUT_PATH = "C:\temp\vads_deliveries.tsv"
DBG_PATH = "C:\temp\vads_deliveries.log"
CARRIER  = "e"
GRID_ID  = "wnd[0]/shellcont/shell/shellcont[1]/shell"

' next day (day-before dispatch); if Sunday, move to Monday
Dim tw, WRDAT
tw = DateAdd("d", 1, Date)
If Weekday(tw, vbSunday) = 1 Then tw = DateAdd("d", 1, tw)
WRDAT = Year(tw) & "." & Right("0" & Month(tw), 2) & "." & Right("0" & Day(tw), 2)

Dim dbg : Set dbg = CreateObject("ADODB.Stream")
dbg.Type = 2 : dbg.Charset = "utf-8" : dbg.Open
Sub Log(s) : dbg.WriteText s & vbCrLf : WScript.Echo s : End Sub
Sub SaveUtf8(strm, path)
    On Error Resume Next
    strm.Position = 0 : strm.Type = 1 : strm.Position = 3
    Dim b : b = strm.Read
    Dim o : Set o = CreateObject("ADODB.Stream")
    o.Type = 1 : o.Open : o.Write b : o.SaveToFile path, 2 : o.Close
    On Error Goto 0
End Sub

' Hangul-plate heuristic: has a Hangul syllable AND a digit, and no '*'
Function LooksLikePlate(s)
    LooksLikePlate = False
    s = Trim(CStr(s))
    If Len(s) = 0 Then Exit Function
    If InStr(s, "*") > 0 Then Exit Function
    Dim i, code, hasK, hasD
    hasK = False : hasD = False
    For i = 1 To Len(s)
        code = AscW(Mid(s, i, 1))
        If code < 0 Then code = code + 65536
        ' Hangul syllables U+AC00..U+D7A3 = 44032..55203 (decimal; &HD7A3 literal is a NEGATIVE Integer in VBScript)
        If code >= 44032 And code <= 55203 Then hasK = True
        If code >= 48 And code <= 57 Then hasD = True
    Next
    LooksLikePlate = (hasK And hasD)
End Function

' Free-text Korean remark: has Hangul, length >= 4, no '*', not a plate, not an address (Jeju/Seogwi start)
Function LooksLikeRemark(s)
    LooksLikeRemark = False
    s = Trim(CStr(s))
    If Len(s) < 4 Then Exit Function
    If InStr(s, "*") > 0 Then Exit Function
    If LooksLikePlate(s) Then Exit Function
    Dim head : head = Left(s, 2)
    If head = ChrW(&HC81C) & ChrW(&HC8FC) Then Exit Function  ' Jeju
    If head = ChrW(&HC11C) & ChrW(&HAD6C) Then Exit Function  ' Seogwi
    Dim i, code, hasK
    hasK = False
    For i = 1 To Len(s)
        code = AscW(Mid(s, i, 1))
        If code < 0 Then code = code + 65536
        If code >= 44032 And code <= 55203 Then hasK = True   ' Hangul U+AC00..U+D7A3 (decimal)
    Next
    LooksLikeRemark = hasK
End Function

' collapse tabs/CR/LF so remark stays on one TSV cell
Function Clean(s)
    s = CStr(s)
    s = Replace(s, vbTab, " ")
    s = Replace(s, vbCr, " ")
    s = Replace(s, vbLf, " ")
    Clean = Trim(s)
End Function

Function GetCell(grid, row, col)
    Dim v : v = ""
    On Error Resume Next
    v = grid.GetCellValue(row, col)
    If Err.Number <> 0 Then Err.Clear : v = ""
    On Error Goto 0
    GetCell = Trim(CStr(v))
End Function

' Fallback: find best column by content (wantPlate=True -> vehicle plate, False -> remark). Returns "" if none.
Function ResolveByContent(grid, total, wantPlate)
    ResolveByContent = ""
    Dim coll, nc, ci, cid, r2, sr, sc, best, bestS
    On Error Resume Next
    Set coll = grid.ColumnOrder : nc = coll.Count
    On Error Goto 0
    If coll Is Nothing Or Not IsNumeric(nc) Then Exit Function
    best = "" : bestS = 0
    sr = 20 : If sr > total Then sr = total
    For ci = 0 To nc - 1
        On Error Resume Next
        cid = coll.ElementAt(ci)
        If Err.Number <> 0 Then Err.Clear : cid = coll.Item(ci)
        On Error Goto 0
        sc = 0
        For r2 = 0 To sr - 1
            Dim vv : vv = GetCell(grid, r2, cid)
            If wantPlate Then
                If LooksLikePlate(vv) Then sc = sc + 1
            Else
                If LooksLikeRemark(vv) Then sc = sc + 1
            End If
        Next
        If sc > bestS Then bestS = sc : best = CStr(cid)
    Next
    ResolveByContent = best
End Function

' ---- connect SAP -------------------------------------------------------------
On Error Resume Next
Dim SapGuiAuto, application, connection, session
Set SapGuiAuto = GetObject("SAPGUI")
If Err.Number <> 0 Then Log "[ERROR] GetObject(SAPGUI): " & Err.Description : SaveUtf8 dbg, DBG_PATH : WScript.Quit 1
Set application = SapGuiAuto.GetScriptingEngine
If application.Children.Count = 0 Then Log "[ERROR] no connection" : SaveUtf8 dbg, DBG_PATH : WScript.Quit 1
Set connection = application.Children(0)
If connection.Children.Count = 0 Then Log "[ERROR] no session" : SaveUtf8 dbg, DBG_PATH : WScript.Quit 1
Set session = connection.Children(0)
On Error Goto 0

' ---- run zllek52060 ----------------------------------------------------------
session.findById("wnd[0]").maximize
session.findById("wnd[0]/tbar[0]/okcd").text = "zllek52060"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 600

' verify we entered the transaction - abort at once on popup / missing authorization
Dim sbar, modal, probe
On Error Resume Next
sbar = "" : sbar = session.findById("wnd[0]/sbar").text
modal = "" : modal = session.findById("wnd[1]").text
On Error Goto 0
If Len(sbar) > 0 Then Log "[sbar] " & sbar
If Len(modal) > 0 Then Fail "SAP popup is blocking the screen: [" & modal & "] - close it and retry"
On Error Resume Next
Err.Clear
probe = session.findById("wnd[0]/usr/ctxtPA_WRDAT").text
If Err.Number <> 0 Then
    Err.Clear
    On Error Goto 0
    Fail "zllek52060 selection screen not available (no authorization or transaction missing). sbar=" & sbar
End If
On Error Goto 0

session.findById("wnd[0]/usr/ctxtPA_WRDAT").text = WRDAT
session.findById("wnd[0]/usr/ctxtSO_HCARR-LOW").text = CARRIER
On Error Resume Next
session.findById("wnd[0]/usr/ctxtSO_HCARR-LOW").setFocus
session.findById("wnd[0]/usr/ctxtSO_HCARR-LOW").caretPosition = 1
On Error Goto 0
session.findById("wnd[0]").sendVKey 8
WScript.Sleep 1200
Log "WRDAT=" & WRDAT & " CARRIER=" & CARRIER

' ---- result grid -------------------------------------------------------------
Dim grid, total, vis
On Error Resume Next
Set grid = session.findById(GRID_ID)
total = grid.RowCount
vis = grid.VisibleRowCount
On Error Goto 0
If grid Is Nothing Or Not IsNumeric(total) Then Log "[ERROR] no result grid" : SaveUtf8 dbg, DBG_PATH : WScript.Quit 1
If total <= 0 Then Log "[WARN] empty result" : SaveUtf8 dbg, DBG_PATH : WScript.Quit 0
If Not IsNumeric(vis) Or vis < 1 Then vis = 15
Log "rows=" & total

' Known technical columns in zllek52060 (verified via column dump 2026-07):
'   VBELN=Delivery ; CARNO=Vehicle Regis.No ; REMARK_I=Remark(Incl.Ship-toComment) ; DRIVER=driver ; CELLNO=phone
Dim bestCol, remCol
bestCol = "CARNO"
remCol  = "REMARK_I"

' dump columns (first row) for verification/fallback
Dim coll, nc, ci, cid, sample, hasVeh, hasRem
On Error Resume Next
Set coll = grid.ColumnOrder : nc = coll.Count
On Error Goto 0
hasVeh = False : hasRem = False
If Not (coll Is Nothing) And IsNumeric(nc) Then
    Log "[cols] count=" & nc
    For ci = 0 To nc - 1
        On Error Resume Next
        cid = coll.ElementAt(ci)
        If Err.Number <> 0 Then Err.Clear : cid = coll.Item(ci)
        On Error Goto 0
        sample = GetCell(grid, 0, cid)
        Log "   [col] " & cid & " = " & sample
        If CStr(cid) = bestCol Then hasVeh = True
        If CStr(cid) = remCol Then hasRem = True
    Next
End If
' fallback to content heuristic only if the fixed column is missing
If Not hasVeh Then bestCol = ResolveByContent(grid, total, True)
If Not hasRem Then remCol = ResolveByContent(grid, total, False)
Log "[vehicle column] " & bestCol
Log "[remark column] " & remCol

' ---- read Delivery + Vehicle + Remark for all rows --------------------------
Dim st : Set st = CreateObject("ADODB.Stream")
st.Type = 2 : st.Charset = "utf-8" : st.Open
st.WriteText "Delivery" & vbTab & "Vehicle" & vbTab & "Remark" & vbCrLf

Dim seen : Set seen = CreateObject("Scripting.Dictionary")
Dim rr, del, veh, rmk, loadedUntil, actualTop, n, nVeh, nRem
loadedUntil = -1 : n = 0 : nVeh = 0 : nRem = 0
For rr = 0 To total - 1
    If rr > loadedUntil Then
        On Error Resume Next
        grid.firstVisibleRow = rr
        WScript.Sleep 25
        actualTop = grid.firstVisibleRow
        If Err.Number <> 0 Or Not IsNumeric(actualTop) Then actualTop = rr
        On Error Goto 0
        loadedUntil = actualTop + vis - 1
        If loadedUntil < rr Then loadedUntil = rr
    End If
    del = GetCell(grid, rr, "VBELN")
    del = OnlyDigits(del)
    If Len(del) >= 7 And Not seen.Exists(del) Then
        seen.Add del, True
        veh = ""
        If Len(bestCol) > 0 Then
            veh = GetCell(grid, rr, bestCol)
            If Not LooksLikePlate(veh) Then veh = ""    ' L106ECPT / ASCII -> unassigned
        End If
        rmk = ""
        If Len(remCol) > 0 Then rmk = Clean(GetCell(grid, rr, remCol))
        ' first few rows: dump raw values so we can see exactly what SAP returned
        If n < 3 Then Log "   [row " & rr & "] del=" & del & " veh=[" & veh & "] rmk=[" & rmk & "]"
        If Len(veh) > 0 Then nVeh = nVeh + 1
        If Len(rmk) > 0 Then nRem = nRem + 1
        st.WriteText del & vbTab & veh & vbTab & rmk & vbCrLf
        n = n + 1
    End If
Next
SaveUtf8 st, OUT_PATH
st.Close
Log "OK: " & n & " deliveries (vehicle=" & nVeh & ", remark=" & nRem & ") -> " & OUT_PATH

' ---- exit transaction (recording) -------------------------------------------
On Error Resume Next
session.findById("wnd[0]/tbar[0]/btn[3]").press
WScript.Sleep 200
session.findById("wnd[1]/usr/btnSPOP-OPTION1").press
WScript.Sleep 200
session.findById("wnd[0]").sendVKey 15
On Error Goto 0

SaveUtf8 dbg, DBG_PATH
WScript.Quit 0

Function OnlyDigits(s)
    Dim i, ch, o : o = ""
    For i = 1 To Len(s)
        ch = Mid(s, i, 1)
        If ch >= "0" And ch <= "9" Then o = o & ch
    Next
    OnlyDigits = o
End Function
