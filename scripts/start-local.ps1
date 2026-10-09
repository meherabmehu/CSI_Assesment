param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskUrl = 'http://127.0.0.1:3000'
Set-Location -LiteralPath $taskRoot

try {
    $taskHealth = Invoke-RestMethod "$taskUrl/api/health" -TimeoutSec 2
    if ($taskHealth.status -eq 'ok' -and $taskHealth.database -eq 'connected') {
        Write-Host "Application is already running: $taskUrl"
        if (-not $NoBrowser) { Start-Process $taskUrl }
        exit 0
    }
} catch { }

if (-not (Test-Path -LiteralPath (Join-Path $taskRoot '.env'))) { throw 'Configure the PostgreSQL credentials in .env first.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/aedes'))) { throw 'Run npm ci in the project folder first.' }
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskRuntime = Join-Path $taskRoot '.runtime'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$taskScript = Join-Path $PSScriptRoot 'run-local.js'
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskScript + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime 'server.log') -RedirectStandardError (Join-Path $taskRuntime 'server-error.log') -PassThru
Set-Content -LiteralPath (Join-Path $taskRuntime 'server.pid') -Value $taskProcess.Id
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    $taskProcess.Refresh()
    if ($taskProcess.HasExited) { throw 'Startup failed. Check .runtime/server-error.log and your PostgreSQL settings.' }
    try {
        $taskHealth = Invoke-RestMethod "$taskUrl/api/health" -TimeoutSec 1
        if ($taskHealth.status -eq 'ok' -and $taskHealth.database -eq 'connected') {
            Write-Host "Application ready: $taskUrl"
            if (-not $NoBrowser) { Start-Process $taskUrl }
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}
throw 'Startup is taking too long. Check .runtime/server-error.log.'
