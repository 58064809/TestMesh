$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$version = "8.0.1"
$expectedSha256 = "2bb8c64ea3dbde464b92432cedd48aaa0fafdff4a39cb9c05c271c306bc8f124"
$projectRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $projectRoot ".hurl\$version"
$binaryPath = Join-Path $installRoot "hurl.exe"

if (Test-Path -LiteralPath $binaryPath) {
  $actualVersion = (& $binaryPath --version) -join " "
  if ($LASTEXITCODE -ne 0 -or $actualVersion -notmatch [regex]::Escape($version)) {
    throw "Existing Hurl version cannot be verified: $actualVersion"
  }
  Write-Output "Hurl $version is ready: $binaryPath"
  exit 0
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("testmesh-hurl-" + [guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $tempRoot "hurl.zip"
$extractPath = Join-Path $tempRoot "extract"
$downloadUrl = "https://github.com/Orange-OpenSource/hurl/releases/download/$version/hurl-$version-x86_64-pc-windows-msvc.zip"

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath
  $stream = [System.IO.File]::OpenRead($archivePath)
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
    throw "Hurl archive SHA-256 mismatch. Installation stopped. Actual: $actualSha256"
  }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
  $downloadedBinary = Get-ChildItem -LiteralPath $extractPath -Filter "hurl.exe" -Recurse | Select-Object -First 1
  $downloadedFormatter = Get-ChildItem -LiteralPath $extractPath -Filter "hurlfmt.exe" -Recurse | Select-Object -First 1
  if (-not $downloadedBinary -or -not $downloadedFormatter) {
    throw "The official archive does not contain hurl.exe and hurlfmt.exe"
  }
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  Copy-Item -LiteralPath $downloadedBinary.FullName -Destination $binaryPath
  Copy-Item -LiteralPath $downloadedFormatter.FullName -Destination (Join-Path $installRoot "hurlfmt.exe")
  $actualVersion = (& $binaryPath --version) -join " "
  if ($LASTEXITCODE -ne 0 -or $actualVersion -notmatch [regex]::Escape($version)) {
    throw "Hurl version check failed after installation: $actualVersion"
  }
  Write-Output "Hurl $version installed: $binaryPath"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
