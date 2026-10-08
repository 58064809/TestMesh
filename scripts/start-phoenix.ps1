$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$phoenixExecutable = Join-Path $projectRoot "data\phoenix-venv\Scripts\phoenix.exe"
if (-not (Test-Path -LiteralPath $phoenixExecutable)) {
  throw "Phoenix is unavailable. Create data\phoenix-venv and install arize-phoenix==20.19.0."
}

$env:PHOENIX_HOST = "127.0.0.1"
$env:PHOENIX_PORT = "6006"
$env:PHOENIX_WORKING_DIR = Join-Path $projectRoot "data\phoenix"
$env:PHOENIX_DISABLE_AGENT_ASSISTANT = "true"
$env:PHOENIX_ENABLE_MCP_SERVER = "false"
$env:PHOENIX_TELEMETRY_ENABLED = "false"
$env:PHOENIX_AGENTS_DISABLE_WEB_ACCESS = "true"
$env:PHOENIX_AGENTS_DISABLE_BASH = "true"

Set-Location -LiteralPath $projectRoot
& $phoenixExecutable serve
