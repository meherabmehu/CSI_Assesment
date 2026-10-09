$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot '.env'
$config = @{}

foreach ($line in Get-Content -LiteralPath $configPath) {
    if ($line.Trim() -eq '' -or $line.TrimStart().StartsWith('#')) { continue }
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) { $config[$parts[0].Trim()] = $parts[1] }
}

foreach ($key in @('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE')) {
    if ([string]::IsNullOrWhiteSpace($config[$key])) {
        throw "Set $key in the project's .env file before connecting."
    }
}

$databaseName = $config['PGDATABASE']
if ($databaseName -notmatch '^[a-z][a-z0-9_]{0,62}$') {
    throw 'PGDATABASE must contain lowercase letters, digits or underscores and start with a letter.'
}

$psqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue
if ($psqlCommand) {
    $psqlPath = $psqlCommand.Source
} else {
    $psqlPath = 'C:\Program Files\PostgreSQL\16\bin\psql.exe'
}
if (-not (Test-Path -LiteralPath $psqlPath)) { throw 'psql.exe was not found.' }

$connectionArgs = @('-X', '-w', '-h', $config['PGHOST'], '-p', $config['PGPORT'], '-U', $config['PGUSER'], '-v', 'ON_ERROR_STOP=1')
$previousPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $config['PGPASSWORD']
    $exists = & $psqlPath @connectionArgs -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$databaseName';"
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL login failed. Check the connection settings in .env.' }

    if (($exists -join '').Trim() -ne '1') {
        & $psqlPath @connectionArgs -d postgres -c "CREATE DATABASE $databaseName;"
        if ($LASTEXITCODE -ne 0) { throw 'Database creation failed.' }
    }

    & $psqlPath @connectionArgs -d $databaseName -c 'SELECT current_database() AS database, current_user AS username, inet_server_port() AS port;'
    if ($LASTEXITCODE -ne 0) { throw 'Database connection check failed.' }
    Write-Host 'Database connection successful.'
} finally {
    $env:PGPASSWORD = $previousPassword
}
