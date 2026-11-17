$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  python -m venv (Join-Path $root ".venv")
}
& $python -m pip install -r (Join-Path $root "requirements-fastapi.txt")
