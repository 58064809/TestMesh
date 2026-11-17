$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  throw "FastAPI 环境不存在，请先运行 npm run setup:fastapi"
}
$env:PYTHONPATH = Join-Path $root "backend"
foreach ($name in @("PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PG_LOCAL_PASSWORD", "TESTMESH_BUSINESS_SCHEMA")) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ([string]::IsNullOrWhiteSpace($value)) {
      $value = [Environment]::GetEnvironmentVariable($name, "Machine")
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}
& $python -m testmesh_api.run
