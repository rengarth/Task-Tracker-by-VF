param([ValidateSet('Production','Dev')][string]$Mode = 'Production', [switch]$Build)
. "$PSScriptRoot\scripts\Common.ps1"
Read-PlannerEnv
$java = Find-PlannerJava
$jar = Join-Path $PlannerRoot 'backend\target\planner-1.0.0.jar'
if ($Build -or !(Test-Path -LiteralPath $jar)) { & "$PSScriptRoot\scripts\Build.ps1" }
$pgReady = Find-PlannerPg 'pg_isready'
& $pgReady -h $env:DB_HOST -p $env:DB_PORT
Assert-PlannerExit 'Проверка PostgreSQL (запустите существующую службу вручную, если она остановлена)'
Write-Host "Backend: http://127.0.0.1:$env:SERVER_PORT. Остановка: Ctrl+C."
if ($Mode -eq 'Production') {
    & $java -jar $jar
    Assert-PlannerExit 'Запуск приложения'
} else {
    New-Item -ItemType Directory -Force (Join-Path $PlannerRoot '.local') | Out-Null
    $server = Start-Process -FilePath $java -ArgumentList @('-jar', ('"' + $jar + '"')) -WorkingDirectory $PlannerRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PlannerRoot '.local\backend.log') -RedirectStandardError (Join-Path $PlannerRoot '.local\backend-error.log')
    try {
        Push-Location (Join-Path $PlannerRoot 'frontend')
        if (!(Test-Path node_modules)) { & npm.cmd ci; Assert-PlannerExit 'Установка frontend-зависимостей' }
        Write-Host 'Frontend: http://127.0.0.1:5173. Backend-журнал: .local\backend.log'
        & npm.cmd run dev
    } finally { Pop-Location; if (!$server.HasExited) { Stop-Process -Id $server.Id } }
}

