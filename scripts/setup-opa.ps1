$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$version = "1.21.2"
$expectedSha256 = "0089fa7ad8cdea7ff9e56ff86fa9202462afb63ef74506e2b547a24b4a987ccb"
$projectRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $projectRoot ".opa\v$version"
$binaryPath = Join-Path $installRoot "opa.exe"

if (Test-Path -LiteralPath $binaryPath) {
  $actualVersion = (& $binaryPath version) -join " "
  if ($LASTEXITCODE -ne 0 -or $actualVersion -notmatch [regex]::Escape($version)) {
    throw "Existing OPA version cannot be verified: $actualVersion"
  }
  Write-Output "OPA $version is ready: $binaryPath"
  exit 0
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("testmesh-opa-" + [guid]::NewGuid().ToString("N"))
$downloadPath = Join-Path $tempRoot "opa.exe"
$downloadUrl = "https://github.com/open-policy-agent/opa/releases/download/v$version/opa_windows_amd64.exe"

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  Invoke-WebRequest -Uri $downloadUrl -OutFile $downloadPath
  $stream = [System.IO.File]::OpenRead($downloadPath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $actualSha256 = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
  if ($actualSha256 -ne $expectedSha256) {
    throw "OPA binary SHA-256 mismatch. Installation stopped. Actual: $actualSha256"
  }
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  Copy-Item -LiteralPath $downloadPath -Destination $binaryPath
  $actualVersion = (& $binaryPath version) -join " "
  if ($LASTEXITCODE -ne 0 -or $actualVersion -notmatch [regex]::Escape($version)) {
    throw "OPA version check failed after installation: $actualVersion"
  }
  Write-Output "OPA $version installed: $binaryPath"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
