param([string]$Output)
. "$PSScriptRoot\Common.ps1"
Read-PlannerEnv
$pgDump = Find-PlannerPg 'pg_dump'
if (!$Output) { $folder = Join-Path $PlannerRoot 'backups'; New-Item -ItemType Directory -Force $folder | Out-Null; $Output = Join-Path $folder ("planner-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump') }
if (Test-Path -LiteralPath $Output) { throw 'Файл уже существует. Укажите новое имя.' }
$env:PGPASSWORD = $env:DB_PASSWORD
try {
    & $pgDump -h $env:DB_HOST -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME -w -Fc -f $Output
    Assert-PlannerExit 'Резервное копирование'
    Write-Host "Копия сохранена: $Output"
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

