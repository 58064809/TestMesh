$ErrorActionPreference = "Stop"

$version = "1.19.2"
$expectedSha256 = "7D86596F16C6E85D45A50312F5E16CCB51E059B62E3D7308110CB65B4C799A4D"
$projectRoot = Split-Path -Parent $PSScriptRoot
$installDir = Join-Path $projectRoot "data\qdrant"
$archive = Join-Path $installDir "qdrant-v$version.zip"
$executable = Join-Path $installDir "qdrant.exe"
$downloadUrl = "https://github.com/qdrant/qdrant/releases/download/v$version/qdrant-x86_64-pc-windows-msvc.zip"

if (Test-Path -LiteralPath $executable -PathType Leaf) {
  Write-Output "Qdrant $version is already installed at $executable"
  exit 0
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archive
$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToUpperInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "Qdrant archive checksum mismatch. Expected $expectedSha256 but received $actualSha256."
}

Expand-Archive -LiteralPath $archive -DestinationPath $installDir -Force
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Qdrant archive did not contain qdrant.exe."
}
Write-Output "Qdrant $version installed at $executable"
