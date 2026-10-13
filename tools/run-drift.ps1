# LOCAL ONLY. Creates a disposable admin, runs tools/contract-drift.local.ts against the local backend, then disables the operator.
# Usage: $env:PG_HOST_PORT='55432'; powershell -File tools\run-drift.ps1
$dashboard = Split-Path -Parent $PSScriptRoot
$backend = Join-Path (Split-Path -Parent $dashboard) 'jimmy&wax_backend\backend'
$pw = (node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url')+'Aa1!')")
$mail = "drift-$(Get-Random)@local.jimmywax.test"
$pgPort = if ($env:PG_HOST_PORT) { $env:PG_HOST_PORT } else { '55432' }
$env:PG_ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:$pgPort/jimmywax_dev"
$env:ADMIN_PASSWORD = $pw
Push-Location $backend
pnpm exec tsx scripts/create-admin.ts --email $mail --role admin 2>&1 | ForEach-Object { "$_".Replace($pw, '<redacted>') } | Select-Object -Last 1
$env:ADMIN_PASSWORD = $null
Pop-Location
Push-Location $dashboard
$env:DRIFT_EMAIL = $mail
$env:DRIFT_PASSWORD = $pw
pnpm exec tsx tools/contract-drift.local.ts 2>&1 | ForEach-Object { "$_".Replace($pw, '<redacted>') }
$code = $LASTEXITCODE
Pop-Location
docker exec jimmywax-backend-postgres-1 psql -U postgres -d jimmywax_dev -c "update admin_users set disabled = true where user_id in (select id from auth.users where email = '$mail')" | Out-Null
Write-Host "operator $mail disabled"
exit $code
