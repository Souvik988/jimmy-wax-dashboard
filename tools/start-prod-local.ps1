# Serves the PRODUCTION build (pnpm build must have run) on :3200 against the LOCAL backend gateway (:8080) and the local storefront (:5174, for Studio's website preview), so live specs exercise the same
# bundle, CSP and server code that ships. Process-only secret; nothing is written to disk except the server log.
# Usage: powershell -File tools\start-prod-local.ps1
$dash = Split-Path -Parent $PSScriptRoot
$listener = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { taskkill /PID $listener.OwningProcess /T /F | Out-Null; Start-Sleep -Seconds 2 }
if (-not (Test-Path "$dash\.next\BUILD_ID")) { Write-Error 'No production build found. Run: pnpm build'; exit 1 }
$secret = (node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")
$cmd = "`$env:DASHBOARD_SESSION_SECRET='$secret'; `$env:BACKEND_ORIGIN='http://localhost:8080'; `$env:DASHBOARD_COOKIE_SECURE='false'; `$env:DASHBOARD_STOREFRONT_ORIGIN='http://localhost:5174'; Set-Location '$dash'; pnpm start *> '$dash\.prod.log'"
Start-Process powershell -WindowStyle Minimized -ArgumentList "-NoProfile", "-Command", $cmd | Out-Null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 2
  try { if ((Invoke-WebRequest http://localhost:3200/api/health -UseBasicParsing -TimeoutSec 20).StatusCode -eq 200) { Write-Host 'production server healthy on :3200'; exit 0 } } catch { }
}
Write-Error 'The production server did not become healthy.'
exit 1
