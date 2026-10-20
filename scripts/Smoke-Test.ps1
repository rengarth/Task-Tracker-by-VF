param([switch]$KeepRunning)
. "$PSScriptRoot\Common.ps1"
Read-PlannerEnv
$java = Find-PlannerJava
$jar = Join-Path $PlannerRoot 'backend\target\planner-1.0.0.jar'
$env:DB_NAME = 'personal_planner_test'
$env:SERVER_PORT = '8081'
$base = 'http://127.0.0.1:8081'
$work = Join-Path $PlannerRoot '.local'
New-Item -ItemType Directory -Force $work | Out-Null
$server = $null
$succeeded = $false
function Start-TestServer {
    $process = Start-Process -FilePath $java -ArgumentList @('-jar', ('"' + $jar + '"')) -WorkingDirectory $PlannerRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $work 'smoke.log') -RedirectStandardError (Join-Path $work 'smoke-error.log')
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        if ($process.HasExited) { throw 'Сервер завершился. См. .local/smoke.log' }
        try { $null = Invoke-RestMethod "$base/api/v1/state" -TimeoutSec 1; return $process } catch { Start-Sleep -Milliseconds 250 }
    }
    Stop-Process -Id $process.Id
    throw 'Сервер не ответил вовремя'
}
function Invoke-PlannerCommand([string]$Path, $Data) {
    $snapshot = Invoke-RestMethod "$base/api/v1/state"
    $body = @{revision=$snapshot.revision;confirm=$true;data=$Data} | ConvertTo-Json -Depth 30
    return Invoke-RestMethod "$base/api/v1/$Path" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
}
try {
    # Refuse to test against an unrelated server already occupying the port.
    $occupied = $false
    try { $null = Invoke-WebRequest $base -TimeoutSec 1; $occupied=$true } catch {}
    if ($occupied) { throw 'Порт 8081 занят. Остановите тестовый сервер перед запуском.' }
    $server = Start-TestServer
    $page = Invoke-WebRequest $base
    if ($page.Content -notmatch '<div id="root">') { throw 'JAR не содержит frontend' }
    $taskId = [guid]::NewGuid().ToString()
    $task = @{id=$taskId;title='Проверка переноса и сохранения';startAt='2026-10-16T11:00:00Z';endAt='2026-10-16T13:00:00Z'}
    $saved = Invoke-PlannerCommand 'tasks/save' @{task=$task}
    if (!$saved.saved) { throw 'Задача не сохранена' }
    $null = Invoke-PlannerCommand 'timers/start' @{id=$taskId}
    Start-Sleep -Milliseconds 1100
    Stop-Process -Id $server.Id
    $server.WaitForExit()
    $server = Start-TestServer
    $restored = Invoke-RestMethod "$base/api/v1/state"
    if ($restored.timer.state -ne 'RUNNING' -or $restored.timer.taskId -ne $taskId) { throw 'Таймер потерян после перезапуска процесса' }
    $stopped = Invoke-PlannerCommand 'timers/stop' @{}
    $entry = $stopped.state.entries | Where-Object taskId -eq $taskId
    if (!$entry -or $entry.seconds -lt 1) { throw 'Факт не сохранился' }
    $roundTrip = Invoke-RestMethod "$base/api/v1/backup/export"
    if (!($roundTrip.tasks | Where-Object id -eq $taskId)) { throw 'Задача отсутствует в экспорте' }
    Write-Host 'PASS: HTTP, frontend в JAR, сохранение задачи, таймер после рестарта процесса, учёт факта, экспорт.' -ForegroundColor Green
    $succeeded = $true
    if ($KeepRunning) {
        Set-Content -LiteralPath (Join-Path $work 'smoke.pid') -Value $server.Id
        Write-Host "Тестовый сервер оставлен на $base, PID $($server.Id). Только personal_planner_test."
    }
} finally {
    if ((!$KeepRunning -or !$succeeded) -and $server -and !$server.HasExited) { Stop-Process -Id $server.Id }
}
