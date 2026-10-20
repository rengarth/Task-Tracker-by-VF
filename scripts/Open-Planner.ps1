$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Common.ps1"
$localDirectory = Join-Path $PlannerRoot '.local'
$errorLog = Join-Path $localDirectory 'launcher-error.log'
$pidFile = Join-Path $localDirectory 'desktop-server.json'
New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null
$mutex = [Threading.Mutex]::new($false, 'Local\PersonalPlannerDesktopLauncher')
$locked = $false
try {
    $locked = $mutex.WaitOne(30000)
    if (!$locked) { throw 'Запуск уже выполняется. Повторите через несколько секунд.' }
    Read-PlannerEnv
    $url = "http://127.0.0.1:$env:SERVER_PORT"
    $jar = Join-Path $PlannerRoot 'backend\target\planner-1.0.0.jar'
    if (!(Test-Path -LiteralPath $jar)) { throw 'Приложение ещё не собрано. Один раз выполните .\scripts\Build.ps1.' }
    $existing = Get-NetTCPConnection -LocalPort ([int]$env:SERVER_PORT) -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' } |
        Select-Object -First 1
    if ($existing) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($existing.OwningProcess)"
        if (!$process -or !$process.CommandLine -or !$process.CommandLine.Contains($jar)) {
            throw "Порт $env:SERVER_PORT занят другой программой. Ежедневник не запущен."
        }
        $null = Invoke-RestMethod "$url/api/v1/state" -TimeoutSec 5
    } else {
        $pgReady = Find-PlannerPg 'pg_isready'
        $databaseReady = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            & $pgReady -h $env:DB_HOST -p $env:DB_PORT | Out-Null
            if ($LASTEXITCODE -eq 0) { $databaseReady = $true; break }
            Start-Sleep -Seconds 1
        }
        if (!$databaseReady) { throw 'PostgreSQL не ответил за 60 секунд после входа в Windows.' }
        $java = Find-PlannerJava
        $process = Start-Process -FilePath $java -ArgumentList @('-jar', ('"' + $jar + '"')) -WorkingDirectory $PlannerRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $localDirectory 'desktop-server.log') -RedirectStandardError (Join-Path $localDirectory 'desktop-server-error.log')
        @{ pid = $process.Id; jar = $jar; port = [int]$env:SERVER_PORT } | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
        $ready = $false
        for ($attempt = 0; $attempt -lt 80; $attempt++) {
            if ($process.HasExited) { throw 'Сервер завершился при запуске. Проверьте .local\desktop-server-error.log.' }
            try {
                $null = Invoke-RestMethod "$url/api/v1/state" -TimeoutSec 1
                $ready = $true
                break
            } catch { Start-Sleep -Milliseconds 250 }
        }
        if (!$ready) { throw 'Сервер не ответил за 20 секунд. Проверьте .local\desktop-server.log.' }
    }
    Start-Process $url
    if (Test-Path -LiteralPath $errorLog) { Remove-Item -LiteralPath $errorLog }
    exit 0
} catch {
    $_.Exception.Message | Set-Content -LiteralPath $errorLog -Encoding UTF8
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
