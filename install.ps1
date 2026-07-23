# Ntox one-liner installer, Windows PowerShell
# Run: irm https://raw.githubusercontent.com/Ntooxx/Ntox/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host "  Ntox installer" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
  $nodeVersion = node -v 2>$null
  Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green
} catch {
  Write-Host "  Node.js 18+ required. Install from https://nodejs.org" -ForegroundColor Red
  exit 1
}

Write-Host "  Installing ntox..." -ForegroundColor Yellow
npm install -g ntox@latest

if ($?) {
  Write-Host "  Done! Run 'ntox' to start, or 'ntox setup' to configure." -ForegroundColor Green
} else {
  Write-Host "  Install failed. Try: npm install -g ntox" -ForegroundColor Red
}
