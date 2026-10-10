Set WshShell = CreateObject("WScript.Shell")
Dim scriptPath, q, cmd
q = Chr(34)
scriptPath = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1) & "\guardian.ps1"
cmd = "pwsh -NoProfile -ExecutionPolicy Bypass -File " & q & scriptPath & q
WshShell.Run cmd, 0, False
