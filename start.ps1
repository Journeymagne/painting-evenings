$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$composeProject = "paint-day-tracker"

Write-Host "Starting Postgres with Docker Compose..."
docker compose -p $composeProject up -d postgres
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose failed to start Postgres. Check the error above."
}

Write-Host "Waiting for Postgres..."
$postgresReady = $false
for ($i = 0; $i -lt 30; $i++) {
  $postgresContainer = docker compose -p $composeProject ps -q postgres
  if (!$postgresContainer) {
    Start-Sleep -Seconds 1
    continue
  }

  $postgresRunning = docker inspect -f "{{.State.Running}}" $postgresContainer 2>$null
  if ($postgresRunning -ne "true") {
    Write-Host "Postgres container is not running. Recent logs:"
    docker compose -p $composeProject logs --tail=80 postgres
    throw "Postgres container stopped during startup."
  }

  docker exec $postgresContainer pg_isready -U paint -d paint_tracker *> $null
  if ($LASTEXITCODE -eq 0) {
    $postgresReady = $true
    break
  }
  Start-Sleep -Seconds 1
}

if (!$postgresReady) {
  throw "Postgres did not become ready in time. Check Docker and try again."
}

if (!(Test-Path ".\node_modules")) {
  Write-Host "Installing Node.js dependencies..."
  npm install
}

$env:DATABASE_URL = "postgres://paint:paint@localhost:55432/paint_tracker"
$env:PORT = "3000"

$siteUrl = "http://localhost:$($env:PORT)"
$apiUrl = "$siteUrl/api/state"

try {
  Invoke-RestMethod -Uri $apiUrl -TimeoutSec 2 *> $null
  $portOwner = Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portOwner) {
    Write-Host "Existing site process found. Restarting it..."
    Stop-Process -Id $portOwner.OwningProcess -Force
    Start-Sleep -Seconds 1
  }
} catch {
  $portOwner = Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portOwner) {
    throw "Port $($env:PORT) is already used by process $($portOwner.OwningProcess). Stop it or change PORT in start.ps1."
  }
}

Write-Host "Starting site: http://localhost:3000"
npm start
