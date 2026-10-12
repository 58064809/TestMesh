$ErrorActionPreference = "Stop"

$python = Get-Command python -ErrorAction Stop
$version = & $python.Source --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch "^Python 3\.12\.") {
  throw "AT01 requires Python 3.12. Current interpreter: $version"
}

& $python.Source -m pip install --upgrade "uv==0.13.0"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install the pinned uv 0.13.0 runner."
}

$uvx = Get-Command uvx -ErrorAction Stop
& $uvx.Source "schemathesis@4.29.3" --version
if ($LASTEXITCODE -ne 0) {
  throw "Failed to prepare Schemathesis 4.29.3."
}

Write-Output "AT01 runner ready: uv 0.13.0 + Schemathesis 4.29.3"
