$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot "data\qdrant\qdrant.exe"
$config = Join-Path $projectRoot "config\qdrant.yaml"

if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Qdrant executable is missing at $executable. Restore the pinned native package before starting TestMesh."
}

Set-Location -LiteralPath $projectRoot
& $executable --config-path $config --disable-telemetry
