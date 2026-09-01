$ErrorActionPreference = "Stop"

$settings = Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$proxyEndpoint = [string]$settings.ProxyServer

if ([string]::IsNullOrWhiteSpace($proxyEndpoint)) {
  throw "Windows system proxy is unavailable. TestMesh startup stopped."
}

if ($proxyEndpoint.Contains("=")) {
  $httpsEntry = $proxyEndpoint.Split(";") | Where-Object { $_ -like "https=*" } | Select-Object -First 1
  $httpEntry = $proxyEndpoint.Split(";") | Where-Object { $_ -like "http=*" } | Select-Object -First 1
  $selectedEntry = if ($httpsEntry) { $httpsEntry } else { $httpEntry }

  if (-not $selectedEntry) {
    throw "Windows system proxy has no HTTP or HTTPS endpoint. TestMesh startup stopped."
  }

  $proxyEndpoint = $selectedEntry.Split("=", 2)[1]
}

if ($proxyEndpoint -notmatch "^[a-zA-Z][a-zA-Z0-9+.-]*://") {
  $proxyEndpoint = "http://$proxyEndpoint"
}

$apiKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "Machine")
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "Machine environment variable OPENAI_API_KEY is unavailable. TestMesh startup stopped."
}

$env:HTTPS_PROXY = $proxyEndpoint
$env:HTTP_PROXY = $proxyEndpoint
$env:NODE_USE_ENV_PROXY = "1"
$env:OPENAI_API_KEY = $apiKey
$env:NODE_ENV = "production"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
node dist/server/index.js
