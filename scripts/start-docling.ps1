$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$doclingExecutable = Join-Path $projectRoot "data\docling-venv\Scripts\docling-serve.exe"
if (-not (Test-Path -LiteralPath $doclingExecutable)) {
  throw "Docling Serve is unavailable. Create data\docling-venv and install requirements-docling.txt."
}

$env:PYTHONUTF8 = "1"
$env:HF_HOME = Join-Path $projectRoot "data\docling-models"
$env:TORCH_HOME = Join-Path $env:HF_HOME "torch"
$env:EASYOCR_MODULE_PATH = Join-Path $env:HF_HOME "easyocr"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
if (-not $env:DOCLING_SERVE_MAX_SYNC_WAIT) {
  $env:DOCLING_SERVE_MAX_SYNC_WAIT = "900"
}

Set-Location -LiteralPath $projectRoot
& $doclingExecutable run --host 127.0.0.1 --port 5001 --workers 1
