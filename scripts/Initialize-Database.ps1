param([switch]$TestDatabase)
. "$PSScriptRoot\Common.ps1"
Read-PlannerEnv
$psql = Find-PlannerPg 'psql'
$database = if ($TestDatabase) { 'personal_planner_test' } else { $env:DB_NAME }
if ($database -notmatch '^personal_planner(?:_test)?$') { throw 'Скрипт создаёт только personal_planner или personal_planner_test. Другую отдельную базу создайте вручную.' }
$env:PGPASSWORD = $env:DB_PASSWORD
try {
    $exists = & $psql -h $env:DB_HOST -p $env:DB_PORT -U $env:DB_USER -d postgres -w -tAc "SELECT 1 FROM pg_database WHERE datname='$database'"
    Assert-PlannerExit 'Подключение к PostgreSQL'
    if ($exists -eq '1') { Write-Host "База $database уже существует; изменений нет."; return }
    & $psql -h $env:DB_HOST -p $env:DB_PORT -U $env:DB_USER -d postgres -w -c "CREATE DATABASE $database"
    Assert-PlannerExit 'Создание отдельной базы'
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

