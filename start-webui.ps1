$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Test-Path (Join-Path $scriptDir 'node_modules'))) {
  npm install
}

if (-not (Test-Path (Join-Path $scriptDir 'dist\\index.html'))) {
  npm run build
}

npm run start
