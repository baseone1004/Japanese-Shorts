' 일본 쇼츠 스튜디오 - 창 없이 실행하고 앱 창으로 열기
Option Explicit

Dim sh, fso, dir, envPath, i, ok
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

envPath = dir & "\.env"
If Not fso.FileExists(envPath) Then
    MsgBox ".env 파일이 없습니다." & vbCrLf & vbCrLf & _
           ".env.example 을 복사해서 .env 로 이름을 바꾸고" & vbCrLf & _
           "API 키를 넣은 뒤 다시 실행하세요.", 16, "일본 쇼츠 스튜디오"
    WScript.Quit
End If

' 이미 켜져 있으면 서버를 새로 띄우지 않는다
If Not IsUp() Then
    ' 0 = 창 숨김, False = 기다리지 않음
    sh.Run "cmd /c npm start", 0, False
End If

' 서버가 응답할 때까지 최대 60초 대기
ok = False
For i = 1 To 60
    WScript.Sleep 1000
    If IsUp() Then
        ok = True
        Exit For
    End If
Next

If Not ok Then
    MsgBox "서버를 시작하지 못했습니다." & vbCrLf & vbCrLf & _
           "start.bat 을 실행하면 자세한 오류를 볼 수 있습니다.", 16, "일본 쇼츠 스튜디오"
    WScript.Quit
End If

OpenApp

' ── 서버가 응답하는지 확인 ─────────────────────────────────────────
Function IsUp()
    Dim http
    IsUp = False
    On Error Resume Next
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.setTimeouts 1000, 1000, 2000, 2000
    http.open "GET", "http://localhost:3000/api/categories", False
    http.send
    If Err.Number = 0 Then
        If http.status = 200 Then IsUp = True
    End If
    Err.Clear
    On Error GoTo 0
End Function

' ── 브라우저를 주소창 없는 앱 창으로 연다 ──────────────────────────
Sub OpenApp()
    Dim url, args
    url = "http://localhost:3000"
    args = " --app=" & url & " --window-size=1200,900"

    If TryRun("chrome.exe" & args) Then Exit Sub
    If TryRun("msedge.exe" & args) Then Exit Sub

    ' 앱 모드가 안 되면 일반 브라우저로 연다
    sh.Run url, 1, False
End Sub

Function TryRun(cmd)
    TryRun = False
    On Error Resume Next
    sh.Run cmd, 1, False
    If Err.Number = 0 Then TryRun = True
    Err.Clear
    On Error GoTo 0
End Function