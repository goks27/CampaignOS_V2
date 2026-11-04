# Starts the CampaignOS AI worker on this Windows PC.
# First run: creates a virtual environment and installs dependencies.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\start-worker.ps1 [-Check] [-WithBrowser]
param([switch]$Check, [switch]$WithBrowser)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".env")) {
  Write-Host "No .env file. Copy .env.example to .env and fill it in, then run this again." -ForegroundColor Yellow
  exit 2
}
if (-not (Test-Path ".venv\Scripts\python.exe")) {
  Write-Host "Creating virtual environment..."
  py -3.11 -m venv .venv 2>$null
  if ($LASTEXITCODE -ne 0) { python -m venv .venv }
}
$py = Join-Path $root ".venv\Scripts\python.exe"
& $py -m pip install --quiet --upgrade pip
if ($WithBrowser) {
  & $py -m pip install --quiet -e ".[browser]"
  & $py -m playwright install chromium
} else {
  & $py -m pip install --quiet -e .
}

# Ollama must be running locally and never exposed to the network.
try { Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 | Out-Null }
catch { Write-Host "Ollama is not running. Start the Ollama app, then run this again." -ForegroundColor Yellow; exit 3 }

if ($Check) { & $py -m app.main --check; exit $LASTEXITCODE }
Write-Host "Starting worker. Press Ctrl+C to stop (the current job goes back to the queue)."
& $py -m app.main
