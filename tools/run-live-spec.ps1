# Runs live Playwright specs against the LOCAL dev stack with a disposable admin, then disables that operator.
# Usage: powershell -File tools\run-live-spec.ps1 tests/e2e/foo.local.spec.ts [more specs...]
# Needs: backend stack up (PG on 55432), dashboard on :3200. The password lives only in this process and is redacted from output.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Specs)
$ErrorActionPreference = 'Continue'
$dashboard = Split-Path -Parent $PSScriptRoot
$backend = Join-Path (Split-Path -Parent $dashboard) 'jimmy&wax_backend\backend'
$pw = (node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url')+'Aa1!')")
$mail = "live-guard-$(Get-Random)@local.jimmywax.test"
$pgPort = if ($env:PG_HOST_PORT) { $env:PG_HOST_PORT } else { '55432' }
$env:PG_ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:$pgPort/jimmywax_dev"
$env:ADMIN_PASSWORD = $pw
Push-Location $backend
pnpm exec tsx scripts/create-admin.ts --email $mail --role admin 2>&1 | ForEach-Object { "$_".Replace($pw, '<redacted>') } | Select-Object -Last 2
$env:ADMIN_PASSWORD = $null
Pop-Location
Push-Location $dashboard
$env:DASHBOARD_RUN_GUARDED_WRITES = '1'
$env:DASHBOARD_TEST_ADMIN_EMAIL = $mail
$env:DASHBOARD_TEST_ADMIN_PASSWORD = $pw
# The older publish specs read these names.
$env:PUB_EMAIL = $mail
$env:PUB_PASSWORD = $pw
# The smoke sweep (remaining-phases) uses these names.
$env:LOCAL_ADMIN_EMAIL = $mail
$env:LOCAL_ADMIN_PASSWORD = $pw
pnpm exec playwright test @Specs --workers=1 2>&1 | ForEach-Object { "$_".Replace($pw, '<redacted>') }
$code = $LASTEXITCODE
Pop-Location
docker exec jimmywax-backend-postgres-1 psql -U postgres -d jimmywax_dev -c "update admin_users set disabled = true where user_id in (select id from auth.users where email = '$mail')" | Out-Null
Write-Host "operator $mail disabled"
exit $code
