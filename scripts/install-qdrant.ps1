$ErrorActionPreference = "Stop"

$version = "1.20.1"
$expectedSha256 = "CDBCF8831A19B40785AF300D10B762501FB3FF796F1A3C8D7FA142C67F76AD62"
$projectRoot = Split-Path -Parent $PSScriptRoot
$installDir = Join-Path $projectRoot "data\qdrant"
$archive = Join-Path $installDir "qdrant-v$version.zip"
$executable = Join-Path $installDir "qdrant.exe"
$downloadUrl = "https://github.com/qdrant/qdrant/releases/download/v$version/qdrant-x86_64-pc-windows-msvc.zip"

if (Test-Path -LiteralPath $executable -PathType Leaf) {
  $installedVersion = (& $executable --version 2>$null) -join " "
  if ($installedVersion -match "\b$([regex]::Escape($version))\b") {
    Write-Output "Qdrant $version is already installed at $executable"
    exit 0
  }
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
  Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archive
}
$stream = [System.IO.File]::OpenRead($archive)
try {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $actualSha256 = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
  } finally {
    $sha256.Dispose()
  }
} finally {
  $stream.Dispose()
}
if ($actualSha256 -ne $expectedSha256) {
  throw "Qdrant archive checksum mismatch. Expected $expectedSha256 but received $actualSha256."
}

if (Test-Path -LiteralPath $executable -PathType Leaf) {
  Remove-Item -LiteralPath $executable -Force
}
Expand-Archive -LiteralPath $archive -DestinationPath $installDir -Force
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Qdrant archive did not contain qdrant.exe."
}
Write-Output "Qdrant $version installed at $executable"
