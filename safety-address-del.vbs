' VADS address lookup by DELIVERY (ZRLEK51030) - delivery-number variant of safety-address.vbs
' ---------------------------------------------------------------------------------
' Same transaction/flow as safety-address.vbs, but the selection is keyed on the
' DELIVERY field (S_VBELN2) instead of the Sales Order field (S_VBELN1).
'   tcode zrlek51030 -> S_VBELN2 (Delivery) multi-select: enter deliveries -> apply -> F8 ->
'   on the result grid, for each group's first row: VSTEL cell -> FU5 -> read STREET -> back.
'
' Input : C:\temp\safety_deliveries.txt  (one DELIVERY number per line; digits)
' Output: C:\temp\safety_address.tsv      (UTF-8 no BOM; columns: Delivery <TAB> Street <TAB> Materials)
' Debug : C:\temp\safety_debug.log
'
' NOTE: If a fetch returns 0 rows, the delivery multi-select button id is likely different.
'       Try one of these for VALU_BTN (first match wins in your GUI recording):
'         wnd[0]/usr/btn%_S_VBELN2_%_APP_%-VALU_PUSH   (assumed here)
'         wnd[0]/usr/btn%_S_VBELN_%_APP_%-VALU_PUSH
'       (Sales-order variant uses S_VBELN1.) Everything else is identical.
'
' ASCII-only source. Korean address DATA comes from SAP (COM strings), written UTF-8.

Option Explicit

Dim IN_PATH, OUT_PATH, DBG_PATH, BATCH
IN_PATH  = "C:\temp\safety_deliveries.txt"
OUT_PATH = "C:\temp\safety_address.tsv"
DBG_PATH = "C:\temp\safety_debug.log"
BATCH    = 5

Dim VALU_BTN, TBL_BASE, GRID_ID, MAT_CANDS
VALU_BTN = "wnd[0]/usr/btn%_S_VBELN2_%_APP_%-VALU_PUSH"   ' Delivery multi-select (S_VBELN2)
TBL_BASE = "wnd[1]/usr/tabsTAB_STRIP/tabpSIVA/ssubSCREEN_HEADER:SAPLALDB:3010/tblSAPLALDBSINGLE/ctxtRSCSEL_255-SLOW_I"
GRID_ID  = "wnd[0]/shellcont/shell/shellcont/shell"
' Candidate column IDs for the material code on the main result grid (first match wins).
MAT_CANDS = Array("MATNR", "MATERIAL", "MATERIALNO", "MATERIAL_NO", "ZMATNR", "MATNR_LONG")

' Delivery column is auto-detected: values that look like a delivery no. (10-digit starting with 7).
' In this system zrlek51030's "VBELN" cell is the Sales Order, so we must find the real delivery column.
Dim DEL_COL : DEL_COL = ""

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
Log "Deliveries: " & nDel

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
st.WriteText "Delivery" & vbTab & "Street" & vbTab & "Materials" & vbTab & "Reason" & vbCrLf

Dim seenOut : Set seenOut = CreateObject("Scripting.Dictionary")
Dim total, b, lo, hi, firstBatch, rows, dumped, dumpedMain, MAT_COL
firstBatch = True : dumped = False : dumpedMain = False : MAT_COL = "" : rows = 0

' ---- put ALL deliveries on the clipboard and upload at once (Shift+F12) ------
' Typing 5 per screen means one round trip per 5 deliveries (100 -> 20 trips).
' The multi-select dialog has "Upload from Clipboard" (Shift+F12 = sendVKey 24),
' which takes the whole list in one shot. Falls back to the old batching if it fails.
Dim delList, di
delList = ""
For di = 0 To nDel - 1
    If Len(delList) > 0 Then delList = delList & vbCrLf
    delList = delList & dels(di)
Next
Dim CLIP_PATH : CLIP_PATH = "C:\temp\safety_del_clip.txt"
On Error Resume Next
Dim tclip : Set tclip = fso.CreateTextFile(CLIP_PATH, True, False)
tclip.Write delList
tclip.Close
Dim shc : Set shc = CreateObject("WScript.Shell")
shc.Run "cmd /c clip < """ & CLIP_PATH & """", 0, True
If Err.Number <> 0 Then Err.Clear
On Error Goto 0
Log "clipboard loaded with " & nDel & " deliveries"

Dim bulkOK : bulkOK = False
On Error Resume Next
Err.Clear
session.findById(VALU_BTN).press
If Err.Number = 0 Then
    WScript.Sleep 600
    Err.Clear
    session.findById("wnd[1]/tbar[0]/btn[16]").press      ' delete all (start clean)
    Err.Clear
    session.findById("wnd[1]").sendVKey 24                ' Shift+F12 = Upload from Clipboard
    WScript.Sleep 1000
    If Err.Number = 0 Then
        Err.Clear
        session.findById("wnd[1]/tbar[0]/btn[8]").press   ' copy/apply selection
        WScript.Sleep 500
        If Err.Number = 0 Then bulkOK = True
    End If
End If
If Err.Number <> 0 Then Err.Clear
On Error Goto 0

If bulkOK Then
    On Error Resume Next
    session.findById("wnd[0]").sendVKey 8
    WScript.Sleep 1800
    On Error Goto 0
    rows = ReadBatch(session, st, seenOut, dumped, dumpedMain, MAT_COL)
    Log "bulk clipboard upload OK: rows=" & rows
End If

If Not bulkOK Then Log "[WARN] clipboard upload failed -> fallback to " & BATCH & " per batch"
b = 0
Do While b < nDel And Not bulkOK
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

    rows = rows + ReadBatch(session, st, seenOut, dumped, dumpedMain, MAT_COL)

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

Function ReadBatch(sess, stream, seenOut, ByRef dumped, ByRef dumpedMain, ByRef matCol)
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

    If Not dumpedMain Then
        DumpMainCols grid
        matCol = ResolveMatCol(grid)
        Log "[MAIN] material column = " & matCol
        DEL_COL = ResolveDelCol(grid)
        Log "[MAIN] delivery column = " & DEL_COL & " (empty -> fallback VBELN)"
        dumpedMain = True
    End If

    Dim delcol : delcol = "VBELN"
    If Len(DEL_COL) > 0 Then delcol = DEL_COL

    Dim starts(), sdel(), ns, rr, dv, prev, loadedUntil, actualTop, curDel, mat, rsn
    Dim matByDel : Set matByDel = CreateObject("Scripting.Dictionary")
    ' Order Reason (AUGRU). ZL4 = pre-visit (sa-jeon-bang-mun): counted as a visit, not an install.
    Dim rsnByDel : Set rsnByDel = CreateObject("Scripting.Dictionary")
    ReDim starts(total) : ReDim sdel(total) : ns = 0
    prev = Chr(1) : loadedUntil = -1 : curDel = ""
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
        dv = GetCell(grid, rr, delcol)
        If Len(dv) > 0 Then curDel = dv
        If Len(dv) > 0 And dv <> prev Then
            prev = dv
            If Not seenOut.Exists(dv) Then starts(ns) = rr : sdel(ns) = dv : ns = ns + 1 : seenOut.Add dv, True
        End If
        If Len(curDel) > 0 Then
            rsn = UCase(Trim(GetCell(grid, rr, "AUGRU")))
            If Len(rsn) > 0 And Not rsnByDel.Exists(curDel) Then rsnByDel.Add curDel, rsn
        End If
        If Len(curDel) > 0 And Len(matCol) > 0 Then
            mat = Trim(GetCell(grid, rr, matCol))
            If Len(mat) > 0 Then
                If Not matByDel.Exists(curDel) Then matByDel.Add curDel, ""
                If InStr(";" & matByDel(curDel) & ";", ";" & mat & ";") = 0 Then _
                    matByDel(curDel) = matByDel(curDel) & IIf(Len(matByDel(curDel)) > 0, ";", "") & mat
            End If
        End If
    Next
    Log "  rows=" & total & " groups=" & ns

    Dim j, addr, mats
    For j = 0 To ns - 1
        rr = starts(j) : dv = sdel(j)
        On Error Resume Next
        grid.firstVisibleRow = rr
        grid.currentCellColumn = "VSTEL"
        grid.currentCellRow = rr
        grid.selectedRows = CStr(rr)
        grid.pressToolbarButton "FU5"
        WScript.Sleep 400
        On Error Goto 0

        addr = ReadStreet(sess, dumped)
        mats = ""
        If matByDel.Exists(dv) Then mats = matByDel(dv)
        Dim rsnOut : rsnOut = ""
        If rsnByDel.Exists(dv) Then rsnOut = rsnByDel(dv)
        stream.WriteText dv & vbTab & Clean(addr) & vbTab & Clean(mats) & vbTab & Clean(rsnOut) & vbCrLf
        ReadBatch = ReadBatch + 1

        On Error Resume Next
        sess.findById("wnd[0]").sendVKey 15
        WScript.Sleep 250
        Set grid = sess.findById(GRID_ID)
        On Error Goto 0
        If grid Is Nothing Then Exit For
    Next
End Function

Function ResolveMatCol(grid)
    ResolveMatCol = ""
    Dim coll, nc, i, cid, c
    On Error Resume Next
    Set coll = grid.ColumnOrder : nc = coll.Count
    On Error Goto 0
    If coll Is Nothing Or Not IsNumeric(nc) Then Exit Function
    For c = 0 To UBound(MAT_CANDS)
        For i = 0 To nc - 1
            On Error Resume Next
            cid = coll.ElementAt(i)
            If Err.Number <> 0 Then Err.Clear : cid = coll.Item(i)
            On Error Goto 0
            If UCase(CStr(cid)) = UCase(MAT_CANDS(c)) Then ResolveMatCol = CStr(cid) : Exit Function
        Next
    Next
End Function

' A delivery number looks like 10-digit starting with 7 (e.g., 7356354574).
Function LooksLikeDelivery(s)
    LooksLikeDelivery = False
    s = Trim(CStr(s))
    If Len(s) < 9 Or Len(s) > 12 Then Exit Function
    If Left(s, 1) <> "7" Then Exit Function
    Dim i, ch
    For i = 1 To Len(s)
        ch = Mid(s, i, 1)
        If ch < "0" Or ch > "9" Then Exit Function
    Next
    LooksLikeDelivery = True
End Function

' Find the delivery column = the grid column whose values look like delivery numbers (7-starting).
Function ResolveDelCol(grid)
    ResolveDelCol = ""
    Dim coll, nc, i, cid, r2, sampleRows, total, sc, best, bestScore
    On Error Resume Next
    Set coll = grid.ColumnOrder : nc = coll.Count
    total = grid.RowCount
    On Error Goto 0
    If coll Is Nothing Or Not IsNumeric(nc) Then Exit Function
    sampleRows = 25 : If IsNumeric(total) And sampleRows > total Then sampleRows = total
    best = "" : bestScore = 0
    For i = 0 To nc - 1
        On Error Resume Next
        cid = coll.ElementAt(i)
        If Err.Number <> 0 Then Err.Clear : cid = coll.Item(i)
        On Error Goto 0
        sc = 0
        For r2 = 0 To sampleRows - 1
            If LooksLikeDelivery(GetCell(grid, r2, cid)) Then sc = sc + 1
        Next
        If sc > bestScore Then bestScore = sc : best = CStr(cid)
    Next
    ResolveDelCol = best
End Function

Sub DumpMainCols(g)
    On Error Resume Next
    Dim coll, nc, i, cid, v
    Set coll = g.ColumnOrder : nc = coll.Count
    Log "[MAIN] columns=" & nc
    For i = 0 To nc - 1
        cid = coll.ElementAt(i)
        If Err.Number <> 0 Then Err.Clear : cid = coll.Item(i)
        v = g.GetCellValue(0, cid)
        If Err.Number <> 0 Then Err.Clear : v = ""
        Log "   " & cid & " = " & v
    Next
    On Error Goto 0
End Sub

Function IIf(cond, a, b)
    If cond Then IIf = a Else IIf = b
End Function

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
