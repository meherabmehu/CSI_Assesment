$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPidFile = Join-Path $taskRoot '.runtime/server.pid'
if (-not (Test-Path -LiteralPath $taskPidFile)) { Write-Host 'No launcher-managed application is running.'; exit 0 }
$taskServerId = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $taskPidFile -Raw).Trim(), [ref]$taskServerId)) { throw 'Invalid local server PID file.' }
$taskServer = Get-CimInstance Win32_Process -Filter "ProcessId = $taskServerId"
$taskExpected = Join-Path $PSScriptRoot 'run-local.js'
if ($taskServer) {
    if ($taskServer.Name -ne 'node.exe' -or $taskServer.CommandLine -notlike ('*"' + $taskExpected + '"*')) { throw 'The PID belongs to another process; it will not be stopped.' }
    Stop-Process -Id $taskServerId -ErrorAction Stop
}
Remove-Item -LiteralPath $taskPidFile
Write-Host 'Local application and MQTT broker stopped. PostgreSQL data is preserved.'
