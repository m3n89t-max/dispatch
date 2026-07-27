' Safety address lookup (ZRLEK51030) - faithful to the SAP recording
' ---------------------------------------------------------------------------------
' Mirrors the user's recording, only adding the minimum needed to save results:
'   tcode zrlek51030 -> S_VBELN2 multi-select: enter 5 Sales Orders -> apply -> F8 ->
'   on the result grid, for each group's first row: VSTEL cell -> FU5
'   (Ship-to Party Display) -> read STREET -> Shift+F3 back -> next group ->
'   end of batch: Shift+F3 back to selection -> next 5 (delete-all first).
'
' Input : C:\temp\safety_deliveries.txt  (one Sales Order per line; 7-10 digits)
' Output: C:\temp\safety_address.tsv      (UTF-8 no BOM; columns: Delivery <TAB> Street)
' Debug : C:\temp\safety_debug.log        (progress + first detail-grid columns)
'
' ASCII-only source. Korean address DATA comes from SAP (COM strings), written UTF-8.

Option Explicit

Dim IN_PATH, OUT_PATH, DBG_PATH, BATCH
IN_PATH  = "C:\temp\safety_deliveries.txt"
OUT_PATH = "C:\temp\safety_address.tsv"
DBG_PATH = "C:\temp\safety_debug.log"
BATCH    = 5

Dim VALU_BTN, TBL_BASE, GRID_ID
VALU_BTN = "wnd[0]/usr/btn%_S_VBELN1_%_APP_%-VALU_PUSH"   ' Sales Order multi-select (per recording)
TBL_BASE = "wnd[1]/usr/tabsTAB_STRIP/tabpSIVA/ssubSCREEN_HEADER:SAPLALDB:3010/tblSAPLALDBSINGLE/ctxtRSCSEL_255-SLOW_I"
GRID_ID  = "wnd[0]/shellcont/shell/shellcont/shell"

Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")

Dim dbg : Set dbg = CreateObject("ADODB.Stream")
dbg.Type = 2 : dbg.Charset = "utf-8" : dbg.Open
Sub Log(s) : dbg.WriteText s & vbCrLf : WScript.Echo s : End Sub
Sub SaveStream(strm, path)
    On Error Resume Next
    strm.Position = 0 : strm.Type = 1 : strm.Position = 3
    Dim b : b = strm.Read
    Dim o : Set o = CreateObject("ADODB.Stream")
    o.Type = 1 : o.Open : o.Write b : o.SaveToFile path, 2 : o.Close
    On Error Goto 0
End Sub

' ---- read deliveries ---------------------------------------------------------
If Not fso.FileExists(IN_PATH) Then Log "[ERROR] no input: " & IN_PATH : SaveStream dbg, DBG_PATH : WScript.Quit 1
Dim seenIn, dels(), nDel, tin, raw, num
Set seenIn = CreateObject("Scripting.Dictionary")
ReDim dels(5000) : nDel = 0
Set tin = fso.OpenTextFile(IN_PATH, 1)
Do Until tin.AtEndOfStream
    raw = tin.ReadLine : num = OnlyDigits(raw)
    If Len(num) > 0 And Not seenIn.Exists(num) Then seenIn.Add num, True : dels(nDel) = num : nDel = nDel + 1
Loop
tin.Close
If nDel = 0 Then Log "[ERROR] no numbers" : SaveStream dbg, DBG_PATH : WScript.Quit 1
Log "SalesOrders: " & nDel

' ---- connect SAP -------------------------------------------------------------
On Error Resume Next
Dim SapGuiAuto, app, connection, session
Set SapGuiAuto = GetObject("SAPGUI")
If Err.Number <> 0 Then Log "[ERROR] GetObject(SAPGUI): " & Err.Description : SaveStream dbg, DBG_PATH : WScript.Quit 1
Set app = SapGuiAuto.GetScriptingEngine
On Error Goto 0
If app.Children.Count = 0 Then Log "[ERROR] no connection" : SaveStream dbg, DBG_PATH : WScript.Quit 1
Set connection = app.Children(0)
If connection.Children.Count = 0 Then Log "[ERROR] no session" : SaveStream dbg, DBG_PATH : WScript.Quit 1
Set session = connection.Children(0)

On Error Resume Next
session.findById("wnd[0]").maximize
On Error Goto 0
GoToMain session   ' Shift+F3 to SAP main (Easy Access) before starting
session.findById("wnd[0]/tbar[0]/okcd").text = "zrlek51030"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 700

' ---- output stream -----------------------------------------------------------
Dim st : Set st = CreateObject("ADODB.Stream")
st.Type = 2 : st.Charset = "utf-8" : st.Open
st.WriteText "Delivery" & vbTab & "Street" & vbCrLf

Dim seenOut : Set seenOut = CreateObject("Scripting.Dictionary")
Dim total, b, lo, hi, firstBatch, rows, dumped
firstBatch = True : dumped = False : rows = 0

b = 0
Do While b < nDel
    lo = b : hi = b + BATCH - 1
    If hi > nDel - 1 Then hi = nDel - 1
    Log "--- batch " & lo & ".." & hi & " ---"

    ' open multi-select, (clear), fill, apply, run
    On Error Resume Next
    session.findById(VALU_BTN).press
    If Err.Number <> 0 Then
        Log "[ERROR] selection button not found: " & VALU_BTN
        On Error Goto 0 : Exit Do
    End If
    If Not firstBatch Then session.findById("wnd[1]/tbar[0]/btn[16]").press   ' delete all
    Err.Clear
    Dim i, k : k = 0
    For i = lo To hi
        session.findById(TBL_BASE & "[1," & k & "]").text = dels(i)
        k = k + 1
    Next
    session.findById("wnd[1]/tbar[0]/btn[8]").press
    WScript.Sleep 300
    session.findById("wnd[0]").sendVKey 8
    WScript.Sleep 900
    On Error Goto 0

    rows = rows + ReadBatch(session, st, seenOut, dumped)

    ' back to selection for next 5
    On Error Resume Next
    session.findById("wnd[0]").sendVKey 15
    WScript.Sleep 300
    On Error Goto 0

    firstBatch = False
    b = b + BATCH
Loop

If rows > 0 Then
    SaveStream st, OUT_PATH
    Log "OK: " & rows & " -> " & OUT_PATH
Else
    Log "[WARN] no rows"
End If
st.Close
SaveStream dbg, DBG_PATH
WScript.Quit 0


' ============================ FUNCTIONS ======================================

' On the result grid: FU5 each delivery group's first row, read STREET, back.
' Results can exceed one screen (recording scrolls), so bands are scrolled into view.
' Return to SAP main (Easy Access) with Shift+F3 before starting (1-2 times).
' Stops at main (SESSION_MANAGER/S000) to avoid an extra Shift+F3 logoff popup.
Sub GoToMain(sess)
    Dim k, cur
    For k = 1 To 2
        cur = ""
        On Error Resume Next
        cur = sess.Info.Transaction
        On Error Goto 0
        If cur = "SESSION_MANAGER" Or cur = "S000" Then Exit Sub
        On Error Resume Next
        sess.findById("wnd[0]").sendVKey 15
        WScript.Sleep 400
        On Error Goto 0
    Next
End Sub

Function ReadBatch(sess, stream, seenOut, ByRef dumped)
    ReadBatch = 0
    Dim grid, total, vis
    On Error Resume Next
    Set grid = sess.findById(GRID_ID)
    total = grid.RowCount
    vis = grid.VisibleRowCount
    On Error Goto 0
    If grid Is Nothing Or Not IsNumeric(total) Then Log "[WARN] no result grid" : Exit Function
    If total <= 0 Then Log "[INFO] empty result" : Exit Function
    If Not IsNumeric(vis) Or vis < 1 Then vis = 15

    ' phase 1: collect the first row of each delivery group (scroll bands to load rows)
    Dim starts(), sdel(), ns, rr, dv, prev, loadedUntil, actualTop
    ReDim starts(total) : ReDim sdel(total) : ns = 0
    prev = Chr(1) : loadedUntil = -1
    For rr = 0 To total - 1
        If rr > loadedUntil Then
            On Error Resume Next
            grid.firstVisibleRow = rr
            WScript.Sleep 40
            actualTop = grid.firstVisibleRow
            If Err.Number <> 0 Or Not IsNumeric(actualTop) Then actualTop = rr
            On Error Goto 0
            loadedUntil = actualTop + vis - 1
            If loadedUntil < rr Then loadedUntil = rr
        End If
        dv = GetCell(grid, rr, "VBELN")
        If Len(dv) > 0 And dv <> prev Then
            prev = dv
            If Not seenOut.Exists(dv) Then starts(ns) = rr : sdel(ns) = dv : ns = ns + 1 : seenOut.Add dv, True
        End If
    Next
    Log "  rows=" & total & " groups=" & ns

    ' phase 2: FU5 each group-start row (Ship-to Party Display), read STREET
    Dim j, addr
    For j = 0 To ns - 1
        rr = starts(j) : dv = sdel(j)
        On Error Resume Next
        grid.firstVisibleRow = rr          ' make the row visible before selecting
        grid.currentCellColumn = "VSTEL"
        grid.currentCellRow = rr
        grid.selectedRows = CStr(rr)
        grid.pressToolbarButton "FU5"
        WScript.Sleep 400
        On Error Goto 0

        addr = ReadStreet(sess, dumped)
        stream.WriteText dv & vbTab & Clean(addr) & vbCrLf
        ReadBatch = ReadBatch + 1

        On Error Resume Next
        sess.findById("wnd[0]").sendVKey 15   ' back to result grid
        WScript.Sleep 250
        Set grid = sess.findById(GRID_ID)
        On Error Goto 0
        If grid Is Nothing Then Exit For
    Next
End Function

' Read STREET from the Ship-to detail grid (same shell path, per recording).
Function ReadStreet(sess, ByRef dumped)
    ReadStreet = ""
    Dim g
    On Error Resume Next
    Set g = sess.findById(GRID_ID)
    On Error Goto 0
    If g Is Nothing Then Exit Function

    If Not dumped Then DumpFirstRow g : dumped = True

    Dim r, v
    For r = 0 To 4
        v = GetCell(g, r, "STREET")
        If Len(Trim(v)) > 0 Then ReadStreet = v : Exit Function
    Next
End Function

' One-time dump of the detail grid's columns (so the address field can be confirmed).
Sub DumpFirstRow(g)
    On Error Resume Next
    Dim coll, nc, i, cid, v
    Set coll = g.ColumnOrder : nc = coll.Count
    Log "[DETAIL] columns=" & nc
    For i = 0 To nc - 1
        cid = coll.ElementAt(i)
        If Err.Number <> 0 Then Err.Clear : cid = coll.Item(i)
        v = g.GetCellValue(0, cid)
        If Err.Number <> 0 Then Err.Clear : v = ""
        Log "   " & cid & " = " & v
    Next
    On Error Goto 0
End Sub

Function GetCell(grid, row, col)
    Dim v : v = ""
    On Error Resume Next
    v = grid.GetCellValue(row, col)
    If Err.Number <> 0 Then Err.Clear : v = ""
    On Error Goto 0
    GetCell = CStr(v)
End Function

Function OnlyDigits(s)
    Dim i, ch, o : o = ""
    For i = 1 To Len(s)
        ch = Mid(s, i, 1)
        If ch >= "0" And ch <= "9" Then o = o & ch
    Next
    OnlyDigits = o
End Function

Function Clean(s)
    Dim t : t = CStr(s)
    t = Replace(t, vbTab, " ") : t = Replace(t, vbCrLf, " ")
    t = Replace(t, vbCr, " ") : t = Replace(t, vbLf, " ")
    Clean = t
End Function
