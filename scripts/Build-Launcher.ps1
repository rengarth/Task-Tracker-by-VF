$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Common.ps1"
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler not found' }
$output = Join-Path $PlannerRoot 'Трекер.exe'
& $compiler /nologo /target:winexe ('/out:' + $output) /reference:System.Windows.Forms.dll (Join-Path $PSScriptRoot 'TrackerLauncher.cs')
Assert-PlannerExit 'Launcher build'
Write-Output $output
