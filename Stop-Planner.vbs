Option Explicit
Dim shell, files, root, command, code
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -WindowStyle Hidden -File " & Chr(34) & files.BuildPath(root, "scripts\Stop-Planner.ps1") & Chr(34)
code = shell.Run(command, 0, True)
If code <> 0 Then
  MsgBox "Planner could not stop. Details: " & files.BuildPath(root, ".local\launcher-error.log"), vbExclamation, "Planner"
End If
