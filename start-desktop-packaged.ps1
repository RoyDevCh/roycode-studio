Set-Location $PSScriptRoot
$exePath = Join-Path $PSScriptRoot 'release\RoyCode Studio 0.1.0.exe'
if (!(Test-Path $exePath)) {
  Write-Error "Packaged desktop build not found at $exePath. Run `npm run desktop:dist` first."
  exit 1
}

Start-Process -FilePath $exePath
