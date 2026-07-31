$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot ".local-renderer"
$zipPath = Join-Path $runtimeRoot "ffmpeg.zip"
$extractRoot = Join-Path $runtimeRoot "extract"
$finalRoot = Join-Path $runtimeRoot "ffmpeg"
$ffmpegExe = Join-Path $finalRoot "bin\ffmpeg.exe"

if (Test-Path -LiteralPath $ffmpegExe) {
  Write-Host "FFmpeg da san sang: $ffmpegExe"
  exit 0
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Write-Host "Dang tai FFmpeg..."
& curl.exe -L --fail --retry 5 --retry-delay 3 `
  --output $zipPath `
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
if ($LASTEXITCODE -ne 0) {
  throw "Khong the tai FFmpeg."
}

if (Test-Path -LiteralPath $extractRoot) {
  Remove-Item -LiteralPath $extractRoot -Recurse -Force
}
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
$packageRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
if (-not $packageRoot) {
  throw "Khong tim thay thu muc FFmpeg sau khi giai nen."
}
if (Test-Path -LiteralPath $finalRoot) {
  Remove-Item -LiteralPath $finalRoot -Recurse -Force
}
Move-Item -LiteralPath $packageRoot.FullName -Destination $finalRoot
Remove-Item -LiteralPath $extractRoot -Recurse -Force
Remove-Item -LiteralPath $zipPath -Force
Write-Host "FFmpeg da san sang: $ffmpegExe"
