' 일본 쇼츠 스튜디오 - 서버 종료
Option Explicit

Dim sh, exec, out, line, pid, killed, parts, i
Set sh = CreateObject("WScript.Shell")

killed = 0

' 3000 포트를 듣고 있는 프로세스만 골라서 종료한다
Set exec = sh.Exec("cmd /c netstat -ano | findstr "":3000"" | findstr LISTENING")
out = exec.StdOut.ReadAll

For Each line In Split(out, vbCrLf)
    line = Trim(line)
    If Len(line) > 0 Then
        parts = Split(line, " ")
        pid = ""
        For i = UBound(parts) To 0 Step -1
            If Len(Trim(parts(i))) > 0 Then
                pid = Trim(parts(i))
                Exit For
            End If
        Next
        If IsNumeric(pid) Then
            sh.Run "cmd /c taskkill /F /PID " & pid, 0, True
            killed = killed + 1
        End If
    End If
Next

If killed > 0 Then
    MsgBox "일본 쇼츠 스튜디오를 종료했습니다.", 64, "일본 쇼츠 스튜디오"
Else
    MsgBox "실행 중인 서버가 없습니다.", 64, "일본 쇼츠 스튜디오"
End If