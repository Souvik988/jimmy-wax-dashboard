# LOCAL ONLY. Runs the live specs one after another against the dashboard on :3200 and the local backend, each with its own disposable
# admin (tools\run-live-spec.ps1), then the role matrix. Writes a one-line-per-spec summary to the log path and prints it at the end.
# Usage: $env:PG_HOST_PORT='55432'; powershell -File tools\run-live-suite.ps1 [-Log path] [-Specs a,b,c] [-SkipRoleMatrix]
param([string]$Log = "$env:TEMP\live-suite.log", [string[]]$Specs, [switch]$SkipRoleMatrix)
$dashboard = Split-Path -Parent $PSScriptRoot
Set-Location $dashboard
if (-not $Specs) {
  $Specs = 'taxonomy-media-guards-live', 'guarded-writes-live', 'catalog-writes-live', 'admin-writes-live', 'studio-finance-live',
    'studio-publish', 'studio-to-website', 'studio-preview-live', 'remaining-phases'
}
Set-Content $Log "live suite started $(Get-Date -Format s)"
$failed = @()
foreach ($spec in $Specs) {
  $out = powershell -NoProfile -File tools\run-live-spec.ps1 "tests/e2e/$spec.local.spec.ts" 2>&1
  $code = $LASTEXITCODE
  $summary = ($out | Select-String -Pattern '^\s+\d+ (passed|failed|skipped|did not run)' | ForEach-Object { $_.Line.Trim() }) -join ' | '
  Add-Content $Log ("{0,-32} exit={1}  {2}" -f $spec, $code, $summary)
  if ($code -ne 0) { $failed += $spec; $out | Select-Object -Last 40 | Add-Content "$Log.$spec.txt" }
  Start-Sleep -Seconds 5
}
if (-not $SkipRoleMatrix) {
  $out = powershell -NoProfile -File tools\run-role-matrix.ps1 2>&1
  $code = $LASTEXITCODE
  Add-Content $Log ("{0,-32} exit={1}  {2}" -f 'role-matrix', $code, (($out | Select-String -Pattern 'checks, \d+ mismatch|passed|failed') -join ' | '))
  if ($code -ne 0) { $failed += 'role-matrix'; $out | Select-Object -Last 40 | Add-Content "$Log.role-matrix.txt" }
}
Add-Content $Log ("finished {0}; failing: {1}" -f (Get-Date -Format s), $(if ($failed.Count) { $failed -join ', ' } else { 'none' }))
Get-Content $Log
exit $(if ($failed.Count) { 1 } else { 0 })
