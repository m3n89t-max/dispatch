' VADS dispatch send (ZLLEK52060 - write assigned vehicle back to SAP)
' ---------------------------------------------------------------------------------
' Flow (exactly as recorded in SAP):
'   1) zllek52060 -> PA_WRDAT=date, SO_HCARR-LOW=e
'   2) delivery multi-select: btn%_SO_VBELN_%_APP_%-VALU_PUSH -> paste list from
'      clipboard (wnd[1]/tbar[0]/btn[24]) -> wnd[1] F8   => report limited to our rows
'   3) run report (wnd[0] F8)
'   4) CLEAR pass : modifyCell r,"CARNO","" + triggerModified   (wipe old vehicles)
'   5) SET   pass : modifyCell r,"CARNO",<plate from UI> + triggerModified
'   6) save = sendVKey 11 -> confirm wnd[1]/usr/btnBUTTON_1
'
' Input : C:\temp\dispatch_send.tsv   (UTF-8, header, Delivery<TAB>Vehicle<TAB>Date YYYY.MM.DD)
' Output: C:\temp\dispatch_send_result.tsv  (UTF-8, header, Delivery<TAB>Result)
' Debug : C:\temp\vads_send.log
' ASCII-only source.

Option Explicit

Dim IN_PATH, OUT_PATH, DBG_PATH, DEL_PATH, CARRIER, GRID_ID, VALU_BTN, PASTE_BTN
IN_PATH   = "C:\temp\dispatch_send.tsv"
OUT_PATH  = "C:\temp\dispatch_send_result.tsv"
DBG_PATH  = "C:\temp\vads_send.log"
DEL_PATH  = "C:\temp\vads_send_dels.txt"
CARRIER   = "e"
GRID_ID   = "wnd[0]/shellcont/shell/shellcont[1]/shell"
VALU_BTN  = "wnd[0]/usr/btn%_SO_VBELN_%_APP_%-VALU_PUSH"
PASTE_BTN = "wnd[1]/tbar[0]/btn[24]"

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
Sub Fail(msg)
    Log "[ERROR] " & msg
    SaveUtf8 dbg, DBG_PATH
    WScript.Quit 1
End Sub

Function OnlyDigits(s)
    Dim i, ch, o : o = ""
    For i = 1 To Len(s)
        ch = Mid(s, i, 1)
        If ch >= "0" And ch <= "9" Then o = o & ch
    Next
    OnlyDigits = o
End Function

Function GetCell(grid, row, col)
    Dim v : v = ""
    On Error Resume Next
    v = grid.GetCellValue(row, col)
    If Err.Number <> 0 Then Err.Clear : v = ""
    On Error Goto 0
    GetCell = Trim(CStr(v))
End Function

' ---- read input (UTF-8) ------------------------------------------------------
Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FileExists(IN_PATH) Then Fail "input not found: " & IN_PATH

Dim rs, txt
Set rs = CreateObject("ADODB.Stream")
rs.Type = 2 : rs.Charset = "utf-8" : rs.Open
rs.LoadFromFile IN_PATH
txt = rs.ReadText
rs.Close

Dim lines, li, parts, dn, veh, WRDAT, delList
Dim want  : Set want  = CreateObject("Scripting.Dictionary")   ' delivery -> vehicle
Dim order : Set order = CreateObject("Scripting.Dictionary")   ' delivery -> result
txt = Replace(txt, vbCrLf, vbLf)
txt = Replace(txt, vbCr, vbLf)
lines = Split(txt, vbLf)
WRDAT = "" : delList = ""
For li = 0 To UBound(lines)
    If Len(Trim(lines(li))) > 0 Then
        parts = Split(lines(li), vbTab)
        If UBound(parts) >= 1 Then
            dn = OnlyDigits(parts(0))
            veh = Trim(parts(1))
            If Len(dn) >= 7 And Len(veh) > 0 Then      ' header row has no digits -> skipped
                If Not want.Exists(dn) Then
                    want.Add dn, veh
                    order.Add dn, "NOT_FOUND"
                    If Len(delList) > 0 Then delList = delList & vbCrLf
                    delList = delList & dn
                End If
                If Len(WRDAT) = 0 And UBound(parts) >= 2 Then WRDAT = Trim(parts(2))
            End If
        End If
    End If
Next
If want.Count = 0 Then Fail "no delivery/vehicle rows in input"

If Len(WRDAT) = 0 Then
    Dim tw : tw = DateAdd("d", 1, Date)
    If Weekday(tw, vbSunday) = 1 Then tw = DateAdd("d", 1, tw)
    WRDAT = Year(tw) & "." & Right("0" & Month(tw), 2) & "." & Right("0" & Day(tw), 2)
End If
Log "input rows=" & want.Count & " WRDAT=" & WRDAT & " CARRIER=" & CARRIER

' ---- put delivery list on the clipboard (for SAP multi-select paste) ---------
Dim ts : Set ts = fso.CreateTextFile(DEL_PATH, True, False)   ' ASCII digits only
ts.Write delList
ts.Close
Dim sh : Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c clip < """ & DEL_PATH & """", 0, True
Log "clipboard loaded with " & want.Count & " delivery numbers"

' ---- connect SAP -------------------------------------------------------------
On Error Resume Next
Dim SapGuiAuto, application, connection, session
Set SapGuiAuto = GetObject("SAPGUI")
If Err.Number <> 0 Then Fail "GetObject(SAPGUI): " & Err.Description
Set application = SapGuiAuto.GetScriptingEngine
If application.Children.Count = 0 Then Fail "no connection"
Set connection = application.Children(0)
If connection.Children.Count = 0 Then Fail "no session"
Set session = connection.Children(0)
On Error Goto 0

' ---- selection screen --------------------------------------------------------
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
session.findById("wnd[0]/usr/ctxtSO_VBELN-LOW").setFocus
session.findById("wnd[0]/usr/ctxtSO_VBELN-LOW").caretPosition = 0
On Error Goto 0

' delivery multi-select -> paste from clipboard -> execute dialog (btn[8])
On Error Resume Next
Err.Clear
session.findById(VALU_BTN).press
If Err.Number <> 0 Then Fail "multi-select button not found (" & VALU_BTN & "): " & Err.Description
WScript.Sleep 600
session.findById(PASTE_BTN).press
If Err.Number <> 0 Then
    Err.Clear
    Log "[WARN] paste button " & PASTE_BTN & " failed - trying wnd[1]/tbar[0]/btn[23]"
    session.findById("wnd[1]/tbar[0]/btn[23]").press
    If Err.Number <> 0 Then Fail "clipboard paste button not found in selection dialog: " & Err.Description
End If
WScript.Sleep 600
Err.Clear
session.findById("wnd[1]/tbar[0]/btn[8]").press      ' execute selection dialog
If Err.Number <> 0 Then Err.Clear : session.findById("wnd[1]").sendVKey 8
On Error Goto 0
WScript.Sleep 800
Log "delivery list pasted into selection"

' ---- run report --------------------------------------------------------------
session.findById("wnd[0]").sendVKey 8
WScript.Sleep 2000

Dim grid, total, vis
On Error Resume Next
Set grid = session.findById(GRID_ID)
total = grid.RowCount
vis = grid.VisibleRowCount
On Error Goto 0
If grid Is Nothing Or Not IsNumeric(total) Then Fail "no result grid after execute"
If total <= 0 Then Fail "no rows for the pasted deliveries (date " & WRDAT & ")"
If Not IsNumeric(vis) Or vis < 1 Then vis = 15
Log "grid rows=" & total

' ---- helper: make sure row rr is loaded/visible ------------------------------
Dim loadedUntil : loadedUntil = -1
Sub EnsureRow(g, rr, visRows)
    If rr > loadedUntil Then
        On Error Resume Next
        g.firstVisibleRow = rr
        WScript.Sleep 30
        Dim top : top = g.firstVisibleRow
        If Err.Number <> 0 Or Not IsNumeric(top) Then top = rr
        On Error Goto 0
        loadedUntil = top + visRows - 1
        If loadedUntil < rr Then loadedUntil = rr
    End If
End Sub

' ---- PASS 1: BULK clear of existing vehicles --------------------------------
' Clearing row by row with modifyCell is slow -> use SAP's own bulk cancel instead.
'   sendVKey 20 = Shift+F8 (select all) -> sendVKey 19 = Shift+F7 (cancel assign) -> confirm
On Error Resume Next
Err.Clear
session.findById("wnd[0]").sendVKey 20
WScript.Sleep 800
session.findById("wnd[0]").sendVKey 19
WScript.Sleep 1200
session.findById("wnd[1]/usr/btnBUTTON_1").press      ' confirm cancel
If Err.Number <> 0 Then Err.Clear
WScript.Sleep 800
session.findById("wnd[1]/tbar[0]/btn[0]").press       ' any leftover modal
If Err.Number <> 0 Then Err.Clear
On Error Goto 0
WScript.Sleep 1000
Log "bulk clear done (selectAll + assign cancel)"

' the grid may refresh after the cancel - re-acquire it
On Error Resume Next
Set grid = session.findById(GRID_ID)
Dim total2 : total2 = grid.RowCount
If IsNumeric(total2) And total2 > 0 Then total = total2
On Error Goto 0
Log "grid rows after clear=" & total
Dim rr

' ---- PASS 2: write the vehicle assigned in our UI ---------------------------
loadedUntil = -1
Dim del, plate, applied, errs
applied = 0 : errs = 0
For rr = 0 To total - 1
    EnsureRow grid, rr, vis
    del = OnlyDigits(GetCell(grid, rr, "VBELN"))
    If Len(del) >= 7 Then
        If want.Exists(del) Then
            plate = want.Item(del)
            On Error Resume Next
            Err.Clear
            grid.setCurrentCell rr, "CARNO"
            grid.modifyCell rr, "CARNO", plate
            grid.triggerModified
            If Err.Number <> 0 Then
                order.Item(del) = "EDIT_ERR:" & Err.Description
                errs = errs + 1
                Err.Clear
            Else
                order.Item(del) = "OK"
                applied = applied + 1
            End If
            On Error Goto 0
        End If
    End If
Next
Log "applied=" & applied & " editErrors=" & errs

' ---- save (Ctrl+S) + confirm popup ------------------------------------------
' dispatch done = Ctrl+S (save) -> Yes (confirm) -> Shift+F3 (exit)
Dim saved : saved = False
If applied > 0 Then
    On Error Resume Next
    session.findById("wnd[0]").sendVKey 11            ' Ctrl+S save
    WScript.Sleep 1500
    Err.Clear
    session.findById("wnd[1]/usr/btnBUTTON_1").press  ' Yes
    If Err.Number <> 0 Then Err.Clear
    WScript.Sleep 1000
    On Error Goto 0
    saved = True
    Log "saved (Ctrl+S + Yes)"
Else
    Log "[WARN] nothing applied -> skip save"
End If

Dim k
If Not saved Then
    For Each k In order.Keys
        If order.Item(k) = "OK" Then order.Item(k) = "NOT_SAVED"
    Next
End If

' ---- write result ------------------------------------------------------------
Dim st : Set st = CreateObject("ADODB.Stream")
st.Type = 2 : st.Charset = "utf-8" : st.Open
st.WriteText "Delivery" & vbTab & "Result" & vbCrLf
For Each k In order.Keys
    st.WriteText k & vbTab & order.Item(k) & vbCrLf
Next
SaveUtf8 st, OUT_PATH
st.Close
Log "OK: applied " & applied & " of " & want.Count & " -> " & OUT_PATH

' ---- exit transaction --------------------------------------------------------
On Error Resume Next
session.findById("wnd[0]/tbar[0]/btn[3]").press
WScript.Sleep 300
session.findById("wnd[1]/usr/btnSPOP-OPTION1").press
WScript.Sleep 300
session.findById("wnd[0]").sendVKey 15
On Error Goto 0

SaveUtf8 dbg, DBG_PATH
WScript.Quit 0
