$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Common.ps1"
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shell = New-Object -ComObject WScript.Shell
foreach ($name in @('Open-Planner', 'Stop-Planner')) {
    $shortcutPath = Join-Path $desktop $(if ($name -eq 'Open-Planner') { 'Открыть ежедневник.lnk' } else { 'Остановить ежедневник.lnk' })
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $shortcut.Arguments = '"' + (Join-Path $PlannerRoot "$name.vbs") + '"'
    $shortcut.WorkingDirectory = $PlannerRoot
    $shortcut.Description = $(if ($name -eq 'Open-Planner') { 'Открыть личный ежедневник в браузере' } else { 'Остановить личный ежедневник' })
    $shortcut.IconLocation = Join-Path $env:SystemRoot 'System32\shell32.dll'
    $shortcut.Save()
    Write-Output $shortcutPath
}
