$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Common.ps1"
$localDirectory = Join-Path $PlannerRoot '.local'
$errorLog = Join-Path $localDirectory 'launcher-error.log'
$pidFile = Join-Path $localDirectory 'desktop-server.json'
New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null
try {
    if (!(Test-Path -LiteralPath $pidFile)) { throw 'Не найден процесс, запущенный ярлыком.' }
    $record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    $jar = Join-Path $PlannerRoot 'backend\target\planner-1.0.0.jar'
    if ($record.jar -ne $jar) { throw 'Запись запуска относится к другой папке приложения.' }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($record.pid)"
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($jar)) {
        Stop-Process -Id $record.pid
    }
    Remove-Item -LiteralPath $pidFile
    if (Test-Path -LiteralPath $errorLog) { Remove-Item -LiteralPath $errorLog }
    exit 0
} catch {
    $_.Exception.Message | Set-Content -LiteralPath $errorLog -Encoding UTF8
    exit 1
}
