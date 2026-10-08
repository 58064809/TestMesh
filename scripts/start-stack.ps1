$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

function Test-LocalService([string]$Url) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Start-HiddenService([string]$ScriptPath) {
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $ScriptPath
  ) | Out-Null
}

if (-not (Test-LocalService "http://127.0.0.1:5001/health")) {
  Start-HiddenService (Join-Path $projectRoot "scripts\start-docling.ps1")
}
if (-not (Test-LocalService "http://127.0.0.1:6006/healthz")) {
  Start-HiddenService (Join-Path $projectRoot "scripts\start-phoenix.ps1")
}

$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
  if ((Test-LocalService "http://127.0.0.1:5001/health") -and (Test-LocalService "http://127.0.0.1:6006/healthz")) {
    break
  }
  Start-Sleep -Seconds 2
}
if (-not (Test-LocalService "http://127.0.0.1:5001/health")) {
  throw "Docling did not become ready at http://127.0.0.1:5001."
}
if (-not (Test-LocalService "http://127.0.0.1:6006/healthz")) {
  throw "Phoenix did not become ready at http://127.0.0.1:6006."
}

if (-not $env:PORT) { $env:PORT = "3011" }
& (Join-Path $projectRoot "scripts\start.ps1")
