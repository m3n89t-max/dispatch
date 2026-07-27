' Safety dispatch data lookup (ZRLEK51270) - ALV direct read
' ---------------------------------------------------------------------------------
' For the 2F+ safety list: query zrlek51270 by Sales Order (S_VGBEL multi-select,
' shipping point S_VSTEL=a062) and read the result ALV grid directly (no FU5).
' Provides Vehicle Number / Delivery / model(UNCOB or Material) / Promise time.
'
' Per the recording:
'   tcode zrlek51270 -> S_VSTEL-LOW = "a062" -> S_VGBEL multi-select (5 sales orders,
'   txtRSCSEL cells) -> apply(btn[8]) -> F8. Result is a normal ALV grid.
'
' This first version reads ALL columns and dumps the column titles to the debug log
' so the exact field names can be confirmed; it can then be trimmed to needed columns.
'
' Input : C:\temp\safety_orders2f.txt   (2F Sales Orders, one per line; written by app)
' Output: C:\temp\safety_dispatch.tsv    (UTF-8 no BOM; header = ALV column titles)
' Debug : C:\temp\safety_dispatch_debug.log
'
' ASCII-only source.

Option Explicit

Dim IN_PATH, OUT_PATH, DBG_PATH, BATCH, SHIPPING
IN_PATH  = "C:\temp\safety_orders2f.txt"
OUT_PATH = "C:\temp\safety_dispatch.tsv"
DBG_PATH = "C:\temp\safety_dispatch_debug.log"
BATCH    = 5
SHIPPING = "a062"

Dim SHIP_FIELD, VALU_BTN, TBL_BASE, GRID_ID, GRID_FOUND
SHIP_FIELD = "wnd[0]/usr/ctxtS_VSTEL-LOW"
VALU_BTN   = "wnd[0]/usr/btn%_S_VGBEL_%_APP_%-VALU_PUSH"
TBL_BASE   = "wnd[1]/usr/tabsTAB_STRIP/tabpSIVA/ssubSCREEN_HEADER:SAPLALDB:3010/tblSAPLALDBSINGLE/txtRSCSEL_255-SLOW_I"
GRID_ID    = "wnd[0]/shellcont/shell/shellcont/shell"
GRID_FOUND = ""

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

' ---- read sales orders -------------------------------------------------------
If Not fso.FileExists(IN_PATH) Then Log "[ERROR] no input: " & IN_PATH : SaveStream dbg, DBG_PATH : WScript.Quit 1
Dim seenIn, ords(), nOrd, tin, raw, num
Set seenIn = CreateObject("Scripting.Dictionary")
ReDim ords(5000) : nOrd = 0
Set tin = fso.OpenTextFile(IN_PATH, 1)
Do Until tin.AtEndOfStream
    raw = tin.ReadLine : num = OnlyDigits(raw)
    If Len(num) > 0 And Not seenIn.Exists(num) Then seenIn.Add num, True : ords(nOrd) = num : nOrd = nOrd + 1
Loop
tin.Close
If nOrd = 0 Then Log "[ERROR] no orders" : SaveStream dbg, DBG_PATH : WScript.Quit 1
Log "SalesOrders(2F): " & nOrd

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
session.findById("wnd[0]/tbar[0]/okcd").text = "zrlek51270"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 700
On Error Resume Next
session.findById(SHIP_FIELD).text = SHIPPING        ' shipping point a062
session.findById(SHIP_FIELD).setFocus
session.findById(SHIP_FIELD).caretPosition = Len(SHIPPING)
On Error Goto 0

' ---- output stream -----------------------------------------------------------
Dim st : Set st = CreateObject("ADODB.Stream")
st.Type = 2 : st.Charset = "utf-8" : st.Open

Dim b, lo, hi, firstBatch, headerWritten, totalRows
firstBatch = True : headerWritten = False : totalRows = 0

b = 0
Do While b < nOrd
    lo = b : hi = b + BATCH - 1
    If hi > nOrd - 1 Then hi = nOrd - 1
    Log "--- batch " & lo & ".." & hi & " ---"

    On Error Resume Next
    session.findById(VALU_BTN).press
    If Err.Number <> 0 Then Log "[ERROR] S_VGBEL button not found: " & VALU_BTN : On Error Goto 0 : Exit Do
    If Not firstBatch Then session.findById("wnd[1]/tbar[0]/btn[16]").press   ' delete all
    Err.Clear
    Dim i, k : k = 0
    For i = lo To hi
        session.findById(TBL_BASE & "[1," & k & "]").text = ords(i)
        k = k + 1
    Next
    session.findById("wnd[1]/tbar[0]/btn[8]").press
    WScript.Sleep 300
    session.findById("wnd[0]").sendVKey 8
    WScript.Sleep 1000
    On Error Goto 0

    totalRows = totalRows + ReadGridAllColumns(session, st, headerWritten)

    On Error Resume Next
    session.findById("wnd[0]").sendVKey 15
    WScript.Sleep 300
    On Error Goto 0

    firstBatch = False
    b = b + BATCH
Loop

If totalRows > 0 Then
    SaveStream st, OUT_PATH
    Log "OK: " & totalRows & " rows -> " & OUT_PATH
Else
    Log "[WARN] no rows"
End If
st.Close
SaveStream dbg, DBG_PATH
WScript.Quit 0


' ============================ FUNCTIONS ======================================

' Read every ALV column for every row (band-scroll for lazy load). Writes header
' (column titles) once, then rows. Returns rows written. Dumps titles to debug.
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

' Locate the result ALV grid across several candidate shell paths.
Function GetGrid(sess)
    Dim paths, p, g, rc
    paths = Array( _
        "wnd[0]/shellcont/shell/shellcont/shell", _
        "wnd[0]/shellcont/shell/shellcont[1]/shell", _
        "wnd[0]/shellcont/shell", _
        "wnd[0]/usr/cntlGRID1/shellcont/shell", _
        "wnd[0]/usr/cntlCONTAINER/shellcont/shell", _
        "wnd[0]/usr/cntlGRID/shellcont/shell")
    Set GetGrid = Nothing
    For Each p In paths
        Set g = Nothing
        On Error Resume Next
        Set g = sess.findById(p)
        On Error Goto 0
        If Not (g Is Nothing) Then
            rc = ""
            On Error Resume Next
            rc = g.RowCount
            On Error Goto 0
            If IsNumeric(rc) Then GRID_FOUND = p : Set GetGrid = g : Exit Function
        End If
    Next
End Function

' Diagnosis when no grid found: dump wnd[0] / usr control ids+types.
Sub DumpControls(sess)
    On Error Resume Next
    Dim w, i, c
    For Each w In Array("wnd[0]", "wnd[0]/usr")
        Dim o : Set o = sess.findById(w)
        If Not (o Is Nothing) Then
            Log "[DIAG] " & w & " children:"
            For i = 0 To o.Children.Count - 1
                Set c = o.Children(i)
                Log "   id=" & c.Id & " type=" & c.Type
            Next
        End If
    Next
    On Error Goto 0
End Sub

Function ReadGridAllColumns(sess, stream, ByRef headerWritten)
    ReadGridAllColumns = 0
    Dim grid, total, vis
    Set grid = GetGrid(sess)
    If grid Is Nothing Then Log "[WARN] no result grid (all candidate paths failed)" : DumpControls sess : Exit Function
    On Error Resume Next
    total = grid.RowCount
    vis = grid.VisibleRowCount
    On Error Goto 0
    Log "[GRID] path=" & GRID_FOUND & " rows=" & total
    If Not IsNumeric(total) Then Log "[WARN] grid has no RowCount (not a GuiGridView)" : Exit Function
    If total <= 0 Then Log "[INFO] empty result (rows=0)" : Exit Function
    If Not IsNumeric(vis) Or vis < 1 Then vis = 15

    Dim coll, nCols, i, colId()
    On Error Resume Next
    Set coll = grid.ColumnOrder
    nCols = coll.Count
    On Error Goto 0
    If nCols = 0 Then Exit Function
    ReDim colId(nCols - 1)
    For i = 0 To nCols - 1
        On Error Resume Next
        colId(i) = coll.ElementAt(i)
        If Err.Number <> 0 Then Err.Clear : colId(i) = coll.Item(i)
        On Error Goto 0
    Next

    If Not headerWritten Then
        Dim hdr, t
        hdr = ""
        Log "[COLUMNS] count=" & nCols
        For i = 0 To nCols - 1
            t = ""
            On Error Resume Next
            t = grid.GetDisplayedColumnTitle(colId(i))
            On Error Goto 0
            If Len(t) = 0 Then t = CStr(colId(i))
            Log "   [" & i & "] id=" & colId(i) & " title=" & t
            If i > 0 Then hdr = hdr & vbTab
            hdr = hdr & Clean(t)
        Next
        stream.WriteText hdr & vbCrLf
        headerWritten = True
    End If

    Dim loadedUntil, rr, actualTop, line, c, v
    loadedUntil = -1
    On Error Resume Next
    For rr = 0 To total - 1
        If rr > loadedUntil Then
            grid.firstVisibleRow = rr
            WScript.Sleep 40
            actualTop = grid.firstVisibleRow
            If Err.Number <> 0 Or Not IsNumeric(actualTop) Then actualTop = rr
            Err.Clear
            loadedUntil = actualTop + vis - 1
            If loadedUntil < rr Then loadedUntil = rr
        End If
        line = ""
        For c = 0 To nCols - 1
            v = grid.GetCellValue(rr, colId(c))
            If Err.Number <> 0 Then Err.Clear : v = ""
            If c > 0 Then line = line & vbTab
            line = line & Clean(v)
        Next
        stream.WriteText line & vbCrLf
        ReadGridAllColumns = ReadGridAllColumns + 1
    Next
    On Error Goto 0
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
