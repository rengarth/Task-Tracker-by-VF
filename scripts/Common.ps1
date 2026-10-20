$ErrorActionPreference = 'Stop'
$PlannerRoot = Split-Path $PSScriptRoot -Parent
function Read-PlannerEnv {
    $path = Join-Path $PlannerRoot '.env'
    if (!(Test-Path -LiteralPath $path)) { throw 'Не найден .env. Скопируйте .env.example в .env и укажите подключение PostgreSQL.' }
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -match '^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$') {
            $value = $Matches[2].Trim()
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
            [Environment]::SetEnvironmentVariable($Matches[1], $value, 'Process')
        }
    }
    if (!$env:SERVER_PORT) { $env:SERVER_PORT = '8080' }
}
function Find-PlannerJava {
    if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe")) { return "$env:JAVA_HOME\bin\java.exe" }
    $candidate = Get-ChildItem -Path "$env:USERPROFILE\.jdks\*\bin\javac.exe", 'C:\Program Files\Eclipse Adoptium\*\bin\javac.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { $env:JAVA_HOME = Split-Path (Split-Path $candidate.FullName -Parent) -Parent; return "$env:JAVA_HOME\bin\java.exe" }
    $javaCommand = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($javaCommand) { return $javaCommand.Source }
    throw 'Не найден JDK 21. Установите JDK 21 и задайте JAVA_HOME.'
}
function Find-PlannerMaven {
    $command = Get-Command mvn.cmd -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Get-ChildItem -Path "$env:USERPROFILE\.m2\wrapper\dists\*\*\*\bin\mvn.cmd",'C:\Program Files\JetBrains\*\plugins\maven\lib\maven3\bin\mvn.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    throw 'Не найден Maven 3.6.3+. Установите Maven и добавьте bin в PATH.'
}
function Find-PlannerPg([string]$Tool) {
    $command = Get-Command "$Tool.exe" -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Get-ChildItem -Path "C:\Program Files\PostgreSQL\*\bin\$Tool.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    throw "Не найдена утилита $Tool. Добавьте каталог PostgreSQL bin в PATH."
}
function Assert-PlannerExit([string]$Action) { if ($LASTEXITCODE -ne 0) { throw "$Action завершилось с кодом $LASTEXITCODE" } }

