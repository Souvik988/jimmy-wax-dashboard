# LOCAL ONLY. Creates one disposable operator per non-admin role (rm-<role>@local.jimmywax.test), runs
#   1) tools/role-write-matrix.local.ts  - every write endpoint with an invalid body: permitted roles get a validation/state error, denied roles get 403
#   2) tests/e2e/role-matrix.local.spec.ts - every Studio/ops route per role renders or redirects to /forbidden
# then disables the operators. Passwords exist only in this process and are redacted from output.
# Usage: powershell -File tools\run-role-matrix.ps1 [-SkipUi]
param([switch]$SkipUi, [string]$Grep = '')
$dashboard = Split-Path -Parent $PSScriptRoot
$backend = Join-Path (Split-Path -Parent $dashboard) 'jimmy&wax_backend\backend'
$pgPort = if ($env:PG_HOST_PORT) { $env:PG_HOST_PORT } else { '55432' }
$env:PG_ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:$pgPort/jimmywax_dev"
$roles = 'support', 'catalog', 'fulfillment', 'finance', 'designer'
$pw = @{}
Push-Location $backend
foreach ($role in $roles) {
  $pw[$role] = (node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url')+'Aa1!')")
  $env:ADMIN_PASSWORD = $pw[$role]
  pnpm exec tsx scripts/create-admin.ts --email "rm-$role@local.jimmywax.test" --role $role 2>&1 | ForEach-Object { "$_".Replace($pw[$role], '<redacted>') } | Select-Object -Last 1
}
$env:ADMIN_PASSWORD = $null
Pop-Location
$env:ROLE_PASSWORDS = ($pw | ConvertTo-Json -Compress)
Push-Location $dashboard
$redact = { param($line) $text = "$line"; foreach ($v in $pw.Values) { $text = $text.Replace($v, '<redacted>') }; $text }
Write-Host '=== backend write matrix ==='
pnpm exec tsx tools/role-write-matrix.local.ts 2>&1 | ForEach-Object { & $redact $_ } | Select-Object -Last 160
$code = $LASTEXITCODE
if (-not $SkipUi) {
  Write-Host '=== dashboard route matrix ==='
  $extra = if ($Grep) { @('-g', $Grep) } else { @() }
  pnpm exec playwright test tests/e2e/role-matrix.local.spec.ts --workers=1 @extra 2>&1 | ForEach-Object { & $redact $_ } | Select-Object -Last 40
}
Pop-Location
docker exec jimmywax-backend-postgres-1 psql -U postgres -d jimmywax_dev -c "update admin_users set disabled = true where user_id in (select id from auth.users where email like 'rm-%@local.jimmywax.test')" | Out-Null
Write-Host 'role operators disabled'
exit $code
