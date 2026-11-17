$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  throw "FastAPI 环境不存在，请先运行 npm run setup:fastapi"
}
$env:PYTHONPATH = Join-Path $root "backend"
& $python -m pytest (Join-Path $root "backend\tests") -q
