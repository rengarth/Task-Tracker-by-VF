param([switch]$Disable)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Common.ps1"
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Трекер.lnk'
$launcher = Join-Path $PlannerRoot 'Трекер.exe'
$shell = New-Object -ComObject WScript.Shell
if ($Disable) {
    if (Test-Path -LiteralPath $shortcutPath) {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        if ($shortcut.TargetPath -ne $launcher) { throw 'Ярлык автозагрузки указывает на другую программу.' }
        Remove-Item -LiteralPath $shortcutPath
    }
    Write-Output 'Автозагрузка Трекера отключена.'
    return
}
if (!(Test-Path -LiteralPath $launcher)) { & "$PSScriptRoot\Build-Launcher.ps1" }
$oldPath = Join-Path $startup 'Открыть ежедневник.lnk'
if (Test-Path -LiteralPath $oldPath) {
    $old = $shell.CreateShortcut($oldPath)
    if ($old.TargetPath -ne (Join-Path $env:WINDIR 'System32\wscript.exe') -or
        !$old.Arguments.Contains((Join-Path $PlannerRoot 'Open-Planner.vbs'))) {
        throw 'Существующий ярлык автозагрузки указывает на другую программу.'
    }
    if (Test-Path -LiteralPath $shortcutPath) { throw 'Ярлык «Трекер» уже существует; старый ярлык не изменён.' }
    Move-Item -LiteralPath $oldPath -Destination $shortcutPath
}
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = $PlannerRoot
$shortcut.Description = 'Трекер — личный ежедневник'
$shortcut.Save()
Write-Output $shortcutPath
