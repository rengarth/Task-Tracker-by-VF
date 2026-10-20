param([switch]$Integration)
. "$PSScriptRoot\Common.ps1"
$java = Find-PlannerJava
$maven = Find-PlannerMaven
Push-Location $PlannerRoot
try {
    Push-Location frontend
    try {
        if (!(Test-Path node_modules)) { & npm.cmd ci; Assert-PlannerExit 'Установка frontend-зависимостей' }
        & npm.cmd test; Assert-PlannerExit 'Frontend-тесты'
        & npm.cmd run build; Assert-PlannerExit 'Frontend-сборка'
    } finally { Pop-Location }
    if ($Integration) { Read-PlannerEnv; $env:PLANNER_INTEGRATION = 'true' } else { $env:PLANNER_INTEGRATION = 'false' }
    & $maven -f backend/pom.xml clean; Assert-PlannerExit 'Очистка build-каталога'
    New-Item -ItemType Directory -Path backend/target/classes/static -Force | Out-Null
    Copy-Item -Path frontend/dist/* -Destination backend/target/classes/static -Recurse -Force
    & $maven -f backend/pom.xml verify; Assert-PlannerExit 'Backend-сборка и тесты'
    Write-Host 'Готово: backend\target\planner-1.0.0.jar' -ForegroundColor Green
} finally { Pop-Location }

