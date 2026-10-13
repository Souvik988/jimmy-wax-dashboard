# Restarts the dashboard dev server on :3200 against the LOCAL backend gateway (:8080) and warms the main routes so the first
# test request does not hit a cold compile. Process-only secret; nothing is written to disk except the dev log.
# Usage: powershell -File tools\start-dev-local.ps1 [-Clean]   (-Clean also removes the Turbopack dev cache)
param([switch]$Clean)
$dash = Split-Path -Parent $PSScriptRoot
$listener = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { taskkill /PID $listener.OwningProcess /T /F | Out-Null; Start-Sleep -Seconds 2 }
if ($Clean -and (Test-Path "$dash\.next\dev")) { Remove-Item "$dash\.next\dev" -Recurse -Force -ErrorAction SilentlyContinue }
$secret = (node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")
$cmd = "`$env:DASHBOARD_SESSION_SECRET='$secret'; `$env:BACKEND_ORIGIN='http://localhost:8080'; `$env:DASHBOARD_COOKIE_SECURE='false'; Set-Location '$dash'; pnpm dev *> '$dash\.dev.log'"
Start-Process powershell -WindowStyle Minimized -ArgumentList "-NoProfile", "-Command", $cmd | Out-Null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 3
  try { if ((Invoke-WebRequest http://localhost:3200/api/health -UseBasicParsing -TimeoutSec 30).StatusCode -eq 200) { break } } catch { }
}
# Warm the route handlers and the pages every live spec touches (anonymous requests are fine; they compile the route).
foreach ($path in '/login', '/login/enroll', '/api/auth/session', '/api/backend/admin/me', '/studio', '/finance', '/products', '/catalogue', '/shipping') {
  try { $r = Invoke-WebRequest "http://localhost:3200$path" -UseBasicParsing -TimeoutSec 90 -MaximumRedirection 0 -ErrorAction Stop; "$($r.StatusCode) $path" } catch { "$([int]$_.Exception.Response.StatusCode) $path" }
}
