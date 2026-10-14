$ErrorActionPreference = "Stop"

$settings = Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$proxyEndpoint = [string]$settings.ProxyServer
if ($proxyEndpoint.Contains("=")) {
  $entry = $proxyEndpoint.Split(";") | Where-Object { $_ -like "https=*" -or $_ -like "http=*" } | Select-Object -First 1
  if ($entry) { $proxyEndpoint = $entry.Split("=", 2)[1] }
}
if ($proxyEndpoint -and $proxyEndpoint -notmatch "^[a-zA-Z][a-zA-Z0-9+.-]*://") {
  $proxyEndpoint = "http://$proxyEndpoint"
}

$apiKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "Machine")
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "Machine environment variable OPENAI_API_KEY is unavailable."
}

$env:OPENAI_API_KEY = $apiKey
$env:HTTPS_PROXY = $proxyEndpoint
$env:HTTP_PROXY = $proxyEndpoint
$env:NODE_USE_ENV_PROXY = "1"
$env:PHOENIX_ENDPOINT = "http://127.0.0.1:6006"
$env:PHOENIX_COLLECTOR_ENDPOINT = "http://127.0.0.1:6006"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& (Join-Path $projectRoot "node_modules\.bin\tsx.cmd") "scripts\run-controlled-quality-benchmark.ts"
