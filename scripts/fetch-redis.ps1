# Downloads a portable Redis-for-Windows build into tools\redis (no admin, no install).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\fetch-redis.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "tools\redis"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$zip = Join-Path $dir "redis.zip"
$url = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
Write-Host "[Inferno] Downloading portable Redis from $url"
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $dir -Force
Remove-Item $zip
Write-Host "[Inferno] Redis ready at $dir. Start it with scripts\run-redis.bat"
