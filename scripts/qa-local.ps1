$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Running chat-reader QA checks"
& "$PSScriptRoot\check-local.ps1"

Write-Host "Running Alembic upgrade head"
Push-Location apps/api
alembic upgrade head
Pop-Location

Write-Host "Checking whitespace"
git diff --check

Write-Host "Checking frontend unsafe rendering"
$frontendSource = Get-ChildItem apps/web -Recurse -Include *.tsx,*.ts |
  Where-Object { $_.FullName -notmatch "\\node_modules\\" -and $_.FullName -notmatch "\\.next\\" }
$unsafeRendering = $frontendSource |
  Select-String -Pattern "dangerouslySetInnerHTML"
if ($unsafeRendering) {
  $unsafeRendering
  throw "dangerouslySetInnerHTML found"
}

Write-Host "Checking frontend token hash exposure"
$tokenHashExposure = $frontendSource |
  Select-String -Pattern "token_hash"
if ($tokenHashExposure) {
  $tokenHashExposure
  throw "token_hash referenced in frontend"
}

Write-Host "QA checks completed"
