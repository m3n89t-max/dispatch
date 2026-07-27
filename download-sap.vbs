' SAP dispatch auto-import (ZRLEJ56700) - ALV DIRECT READ (no Excel export, DRM-safe)
' ---------------------------------------------------------------------------------
' Reads the ALV grid cells directly via SAP GUI Scripting and writes a TAB-separated
' table straight to C:\temp\ZRLEJ56700.xlsx as UTF-16LE. No EXDL, no Save-As dialog,
' no DRM-encrypted xlsx. The Next.js upload parser already auto-detects UTF-16/TSV.
'
' SPEED: the report has ~85 columns. Reading every cell of every row is tens of
'        thousands of COM round-trips and overruns the 90s server timeout. So we only
'        call GetCellValue for the ~13 columns the parser actually uses (matched by
'        column title AND by the parser's fixed positions); skipped columns are left
'        blank but keep their slot, so BOTH name-matching and fixed-position parsing
'        still work. Rows are streamed to the file (no O(n^2) string building).
'
' Fallback: if the ALV grid cannot be read (no rows / not a GuiGridView) it falls
'           back to the legacy EXDL export so behaviour is never worse than before.
'
' NOTE: keep this file ASCII-only. Korean DATA from SAP is fine (read as COM strings,
'       written as UTF-16); only literal text in this script must stay ASCII.

Option Explicit

Dim Plant, CarrierCode
Plant = "L106"          ' S_RWERKS-LOW (Plant)
CarrierCode = "CA06E"   ' S_CARCD-LOW (Carrier)
If WScript.Arguments.Count >= 1 Then Plant = WScript.Arguments(0)
If WScript.Arguments.Count >= 2 Then CarrierCode = WScript.Arguments(1)

Dim DownloadDir, FileName, SavePath
DownloadDir = "C:\temp"
FileName = "ZRLEJ56700.xlsx"
SavePath = DownloadDir & "\" & FileName

Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")
On Error Resume Next
fso.CreateFolder(DownloadDir)
On Error Goto 0

WScript.Echo "========================================"
WScript.Echo " SAP ZRLEJ56700 - ALV direct read (fast)"
WScript.Echo "   Plant=" & Plant & "  Carrier=" & CarrierCode
WScript.Echo "   Save = " & SavePath
WScript.Echo "========================================"

' ---- 1) Connect to running SAP GUI session ----------------------------------
WScript.Echo "[1/5] Connect SAP GUI..."
On Error Resume Next
Dim SapGuiAuto, app, connection, session
Set SapGuiAuto = GetObject("SAPGUI")
If Err.Number <> 0 Then
    WScript.Echo "[ERROR] GetObject(SAPGUI) failed: " & Err.Description
    WScript.Echo "        Make sure SAP Logon is open and logged in."
    WScript.Quit 1
End If
Set app = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Then
    WScript.Echo "[ERROR] GetScriptingEngine failed: " & Err.Description
    WScript.Quit 1
End If
On Error Goto 0
If app.Children.Count = 0 Then
    WScript.Echo "[ERROR] No SAP connection (Children=0). Open SAP Easy Access."
    WScript.Quit 1
End If
Set connection = app.Children(0)
If connection.Children.Count = 0 Then
    WScript.Echo "[ERROR] No SAP session."
    WScript.Quit 1
End If
Set session = connection.Children(0)
WScript.Echo "      OK"

' ---- 2) Open transaction -----------------------------------------------------
WScript.Echo "[2/5] Transaction zrlej56700..."
On Error Resume Next
session.findById("wnd[0]").maximize
On Error Goto 0
GoToMain session   ' Shift+F3 to SAP main (Easy Access) before starting
session.findById("wnd[0]/tbar[0]/okcd").text = "zrlej56700"
session.findById("wnd[0]").sendVKey 0
WScript.Sleep 800
WScript.Echo "      OK"

' ---- 3) Selection screen: Plant + Carrier ------------------------------------
WScript.Echo "[3/5] Parameters..."
session.findById("wnd[0]/usr/ctxtS_RWERKS-LOW").text = Plant
session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").text = CarrierCode
session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").setFocus
session.findById("wnd[0]/usr/ctxtS_CARCD-LOW").caretPosition = Len(CarrierCode)
WScript.Echo "      OK (S_RWERKS=" & Plant & ", S_CARCD=" & CarrierCode & ")"

' ---- 4) Execute (F8) ---------------------------------------------------------
WScript.Echo "[4/5] Execute (F8)..."
session.findById("wnd[0]").sendVKey 8
WScript.Sleep 3000
WScript.Echo "      OK"

' ---- 5) Read ALV grid directly (primary) -------------------------------------
WScript.Echo "[5/5] Read ALV grid directly (needed columns only)..."
Dim t0, rowCount
t0 = Timer
rowCount = DumpAlvToFile(session, SavePath)

If rowCount > 0 Then
    WScript.Echo "      ALV direct read OK: " & rowCount & " data rows in " & _
                 FormatNumber(Timer - t0, 1) & "s -> " & SavePath
    BackToMain session
    ShowResult SavePath
    WScript.Quit 0
End If

' ---- Fallback: legacy EXDL spreadsheet export --------------------------------
WScript.Echo "      ALV read empty (rc=" & rowCount & ") -> fallback to EXDL export"
ExdlExport session, DownloadDir, FileName
BackToMain session
ShowResult SavePath
WScript.Quit 0


' ============================ FUNCTIONS ======================================

' Locate the result ALV grid control (layout-dependent shell path).
' Return to SAP main (Easy Access) with Shift+F3 before starting (1-2 times).
' Checks the current transaction first and stops at main (SESSION_MANAGER/S000)
' so it never sends an extra Shift+F3 that would pop the logoff dialog.
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

Function GetGrid(sess)
    Dim g
    Set g = Nothing
    On Error Resume Next
    Set g = sess.findById("wnd[0]/shellcont/shell/shellcont/shell")
    If g Is Nothing Then Set g = sess.findById("wnd[0]/shellcont/shell/shellcont[1]/shell")
    If g Is Nothing Then Set g = sess.findById("wnd[0]/usr/cntlGRID1/shellcont/shell")
    On Error Goto 0
    Set GetGrid = g
End Function

' Read the ALV grid and STREAM it to a UTF-16 TSV file.
' Returns the number of DATA rows written, 0 if empty, or -1 if not a grid
' (in which case no file is created and the caller falls back to EXDL).
Function DumpAlvToFile(sess, path)
    DumpAlvToFile = -1

    Dim grid
    Set grid = GetGrid(sess)
    If grid Is Nothing Then Exit Function

    Dim total, vis
    On Error Resume Next
    total = grid.RowCount
    If Err.Number <> 0 Then Err.Clear : On Error Goto 0 : Exit Function  ' not a GuiGridView
    vis = grid.VisibleRowCount
    On Error Goto 0
    If vis < 1 Then vis = 1
    If total <= 0 Then DumpAlvToFile = 0 : Exit Function

    ' --- column metadata (one-time) ---
    Dim coll, nCols, i
    On Error Resume Next
    Set coll = grid.ColumnOrder
    nCols = coll.Count
    On Error Goto 0
    If nCols = 0 Then Exit Function

    Dim colId(), readCol(), needed, t, anyRead
    ReDim colId(nCols - 1)
    ReDim readCol(nCols - 1)
    Set needed = BuildNeededDict()
    anyRead = False

    Dim hdr, outTitle
    hdr = ""
    On Error Resume Next
    For i = 0 To nCols - 1
        colId(i) = coll.ElementAt(i)
        If Err.Number <> 0 Then Err.Clear : colId(i) = coll.Item(i)
        t = grid.GetDisplayedColumnTitle(colId(i))
        If Err.Number <> 0 Then Err.Clear : t = ""

        ' read this column if it is the first column (the Delivery key), its title
        ' matches a needed name, or it sits at a parser fixed position.
        readCol(i) = (i = 0) Or needed.Exists(NormName(t)) Or IsFixedIdx(i)
        If readCol(i) Then anyRead = True

        ' Header label fed to the Next.js parser:
        '   col 0 = the Delivery number (the dispatch unit key) -> force "Delivery"
        '           so the parser keys on it instead of Freight Order.
        '   any "Freight Order" column -> blank header so the parser never keys on
        '           it (business rule: Freight Order is NOT the delivery unit here).
        '   other read columns -> their real title (for name-based mapping).
        '   skipped columns -> blank slot (keeps column positions intact).
        If i = 0 Then
            outTitle = "Delivery"
        ElseIf NormName(t) = "freightorder" Then
            outTitle = ""
        ElseIf readCol(i) Then
            outTitle = Clean(t)
        Else
            outTitle = ""
        End If

        If i > 0 Then hdr = hdr & vbTab
        hdr = hdr & outTitle
    Next
    On Error Goto 0
    ' safety: if nothing matched (unexpected), read everything so we never lose data
    If Not anyRead Then
        For i = 0 To nCols - 1 : readCol(i) = True : Next
    End If

    ' --- write rows as UTF-8 WITHOUT BOM --------------------------------------
    ' A BOM (UTF-16 or UTF-8) would prepend U+FEFF to the first cell, turning the
    ' col-0 header "Delivery" into a non-matching token and silently reverting the
    ' delivery key back to Freight Order. ADODB.Stream emits clean UTF-8 (no BOM).
    Dim useAdo, st, f
    useAdo = True
    On Error Resume Next
    Set st = CreateObject("ADODB.Stream")
    If Err.Number <> 0 Then useAdo = False : Err.Clear
    On Error Goto 0
    If useAdo Then
        st.Type = 2 : st.Charset = "utf-8" : st.Open
        st.WriteText hdr & vbCrLf
    Else
        ' fallback: FSO UTF-16 (note: the col-0 BOM caveat above may then apply)
        WScript.Echo "      [WARN] ADODB.Stream unavailable -> UTF-16 fallback"
        Set f = fso.CreateTextFile(path, True, True)
        f.WriteLine hdr
    End If

    Dim loadedUntil, rr, actualTop, line, c, v, dataRows
    dataRows = 0
    loadedUntil = -1
    On Error Resume Next
    For rr = 0 To total - 1
        ' ALV lazy-loads only visible rows: scroll a band into view when needed.
        If rr > loadedUntil Then
            grid.firstVisibleRow = rr
            WScript.Sleep 40
            actualTop = grid.firstVisibleRow
            If Err.Number <> 0 Or actualTop < 0 Then actualTop = rr
            Err.Clear
            loadedUntil = actualTop + vis - 1
            If loadedUntil < rr Then loadedUntil = rr
        End If

        line = ""
        For c = 0 To nCols - 1
            If c > 0 Then line = line & vbTab
            If readCol(c) Then
                v = grid.GetCellValue(rr, colId(c))
                If Err.Number <> 0 Then Err.Clear : v = ""
                line = line & Clean(v)
            End If
        Next
        If useAdo Then st.WriteText line & vbCrLf Else f.WriteLine line
        dataRows = dataRows + 1
    Next
    On Error Goto 0

    If useAdo Then
        ' strip the UTF-8 BOM (first 3 bytes) then save the raw bytes
        st.Position = 0 : st.Type = 1 : st.Position = 3
        Dim bin, out
        bin = st.Read
        Set out = CreateObject("ADODB.Stream")
        out.Type = 1 : out.Open : out.Write bin
        out.SaveToFile path, 2     ' adSaveCreateOverWrite
        out.Close : st.Close
    Else
        f.Close
    End If

    DumpAlvToFile = dataRows
End Function

' Dictionary of normalized column names the upload parser cares about.
Function BuildNeededDict()
    Dim d, arr, k
    Set d = CreateObject("Scripting.Dictionary")
    arr = Array( _
        "uncob", "material", "qty", "quantity", "route", "soreason", _
        "salesdldate", "salesdltime", "requestdeliverydate", "requestdate", "deliverydate", _
        "shiptopostalcode", "postalcode", "shiptopostal", _
        "shiptoaddress", "address", _
        "vehiclenumberfull", "vehiclenumber", "deliverytruckno", _
        "freightorder", "deliveryno", "deliverynumber", "delivery", _
        "outbounddelivery", "shiptopartyname", _
        "pdastepstatus", "stepstatus", "pdastatus")
    For Each k In arr
        If Not d.Exists(k) Then d.Add k, True
    Next
    Set BuildNeededDict = d
End Function

' True if column index is a parser fixed position (0-based, export order):
'  4=Route 6=FreightOrder 10=Material 11=Qty 19=UNCOB 26=SOReason
'  43=DeliveryDate 44=SalesDLDate 46=RequestDeliveryDate 70=ShipToPartyName
'  72=ShipToPostalCode 73=ShipToAddress 84=Vehicle
Function IsFixedIdx(i)
    Select Case i
        Case 4, 6, 10, 11, 19, 22, 26, 43, 44, 46, 70, 72, 73, 84
            IsFixedIdx = True
        Case Else
            IsFixedIdx = False
    End Select
End Function

' Normalize a column title the same way the parser does:
' lower-case + remove spaces _ ( ) . - /
Function NormName(s)
    Dim t
    t = LCase(CStr(s))
    t = Replace(t, " ", "")
    t = Replace(t, vbTab, "")
    t = Replace(t, "_", "")
    t = Replace(t, "(", "")
    t = Replace(t, ")", "")
    t = Replace(t, ".", "")
    t = Replace(t, "-", "")
    t = Replace(t, "/", "")
    NormName = t
End Function

' Strip tab/newline from a cell so it cannot break the TSV grid.
Function Clean(s)
    Dim t
    t = CStr(s)
    t = Replace(t, vbTab, " ")
    t = Replace(t, vbCrLf, " ")
    t = Replace(t, vbCr, " ")
    t = Replace(t, vbLf, " ")
    Clean = t
End Function

' Return to SAP main screen (Shift+F3 x2).
Sub BackToMain(sess)
    Dim k
    For k = 1 To 2
        On Error Resume Next
        sess.findById("wnd[0]").sendVKey 15
        WScript.Sleep 300
        On Error Goto 0
    Next
End Sub

' Print saved-file info.
Sub ShowResult(path)
    Dim f
    If fso.FileExists(path) Then
        Set f = fso.GetFile(path)
        WScript.Echo "      Saved: " & path & " (" & Round(f.Size / 1024, 1) & " KB)"
    Else
        WScript.Echo "[WARN] Save not confirmed: " & path
    End If
End Sub

' Legacy fallback: EXDL spreadsheet export + Save-As dialog (may hit DRM).
Sub ExdlExport(sess, dir, fname)
    On Error Resume Next
    sess.findById("wnd[0]/shellcont/shell/shellcont/shell").pressToolbarButton "EXDL"
    If Err.Number <> 0 Then
        Err.Clear
        sess.findById("wnd[0]/shellcont/shell/shellcont[1]/shell").pressToolbarButton "EXDL"
    End If
    Err.Clear
    On Error Goto 0
    WScript.Sleep 1500

    On Error Resume Next
    sess.findById("wnd[1]/tbar[0]/btn[0]").press
    Err.Clear
    On Error Goto 0
    WScript.Sleep 1500

    ' SAP "save as" dialog with explicit path/filename fields (if present).
    On Error Resume Next
    sess.findById("wnd[1]/usr/ctxtDY_PATH").text = dir
    sess.findById("wnd[1]/usr/ctxtDY_FILENAME").text = fname
    sess.findById("wnd[1]/tbar[0]/btn[0]").press
    Err.Clear
    On Error Goto 0
    WScript.Sleep 1500

    ' Overwrite confirm.
    On Error Resume Next
    sess.findById("wnd[1]/tbar[0]/btn[0]").press
    Err.Clear
    On Error Goto 0
    WScript.Sleep 1500
End Sub
