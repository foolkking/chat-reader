$ErrorActionPreference = "Stop"

Write-Host "chat-reader local startup check"

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Host "psql was not found on PATH. Add E:\PostgreSQL\17\bin to PATH before starting."
  exit 1
}

psql --version
pg_isready

Write-Host ""
Write-Host "Start API in one terminal:"
Write-Host "  cd apps/api"
Write-Host "  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
Write-Host ""
Write-Host "Start Web in another terminal:"
Write-Host "  corepack pnpm --filter web dev"
Write-Host ""
Write-Host "Open http://localhost:3000"
