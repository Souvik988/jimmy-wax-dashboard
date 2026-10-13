<#
  Runs the non-production Phase 08/09 acceptance path with fresh, disposable
  local operators. No credential is written to disk. The product fixture is
  archived by the Playwright test; this script disables only the two exact
  test operators after the run.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$dashboardRoot = Split-Path -Parent $PSScriptRoot
$desktopRoot = Split-Path -Parent $dashboardRoot
$backendRoot = Join-Path $desktopRoot 'jimmy&wax_backend\backend'
$storefrontRoot = Join-Path $desktopRoot 'jimmy_nd _wax_website'
$run = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$phase08Email = "phase08-$run@local.jimmywax.test"
$phase09Email = "phase09-$run@local.jimmywax.test"
$passwordBytes = New-Object byte[] 24
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($passwordBytes)
$random.Dispose()
$password = [Convert]::ToBase64String($passwordBytes) + 'Aa1!'
$storefront = $null
$startedStorefront = $false

function Test-StorefrontReady {
  try {
    return (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5174/' -TimeoutSec 2).StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-ForStorefront {
  for ($attempt = 1; $attempt -le 90; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5174/' -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {
      # The fresh Vite process is still starting.
    }
    Start-Sleep -Seconds 1
  }
  throw 'The local storefront did not become ready on http://127.0.0.1:5174.'
}

function Disable-TestOperators {
  $safe08 = $phase08Email.Replace("'", "''")
  $safe09 = $phase09Email.Replace("'", "''")
  docker exec jimmywax-backend-postgres-1 psql -U postgres -d jimmywax_dev -v ON_ERROR_STOP=1 -c "UPDATE admin_users SET disabled = true WHERE user_id IN (SELECT id FROM auth.users WHERE email IN ('$safe08', '$safe09'));"
}

try {
  if (-not (Test-StorefrontReady)) {
    # Dependency repair can make Vite's first launch take longer than an
    # ordinary dev start. The hidden helper is only stopped if this script
    # started it; an already-running developer server is left untouched.
    $storefront = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile', '-Command', "Set-Location '$storefrontRoot'; pnpm dev -- --port 5174 --host 127.0.0.1"
    )
    $startedStorefront = $true
    Wait-ForStorefront
  }

  Set-Location $backendRoot
  $pgPort = if ($env:PG_HOST_PORT) { $env:PG_HOST_PORT } else { '54422' }
  $env:PG_ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:$pgPort/jimmywax_dev"
  $env:ADMIN_PASSWORD = $password
  pnpm exec tsx scripts/create-admin.ts --email $phase08Email --role admin
  pnpm exec tsx scripts/create-admin.ts --email $phase09Email --role admin

  Set-Location $dashboardRoot
  $env:DASHBOARD_PHASE08_EMAIL = $phase08Email
  $env:DASHBOARD_PHASE08_PASSWORD = $password
  $env:DASHBOARD_PHASE09_EMAIL = $phase09Email
  $env:DASHBOARD_PHASE09_PASSWORD = $password
  $env:DASHBOARD_STOREFRONT_ORIGIN = 'http://127.0.0.1:5174'
  $env:DASHBOARD_PUBLIC_API_ORIGIN = 'http://localhost:8080'
  pnpm exec playwright test tests/e2e/catalog-media-live-acceptance.local.spec.ts
  if ($LASTEXITCODE -ne 0) { throw "Local catalogue/media acceptance failed with exit code $LASTEXITCODE." }
} finally {
  Disable-TestOperators
  if ($startedStorefront -and $storefront -and -not $storefront.HasExited) {
    Stop-Process -Id $storefront.Id -Force -ErrorAction SilentlyContinue
  }
}

