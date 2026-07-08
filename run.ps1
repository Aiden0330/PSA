# Start the BESS PSA web app (FastAPI serves the built frontend).
# Usage: from D:\PSA_BESS run  .\run.ps1   then open http://127.0.0.1:8000
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "No .venv found. Create it and install deps first:" -ForegroundColor Yellow
    Write-Host "  python -m venv --system-site-packages .venv"
    Write-Host "  .\.venv\Scripts\python.exe -m pip install -e `".[test]`""
    exit 1
}
if (-not (Test-Path (Join-Path $PSScriptRoot "frontend\dist\index.html"))) {
    Write-Host "Frontend not built; building now..." -ForegroundColor Cyan
    npm run build --prefix frontend
}
Write-Host "BESS PSA -> http://127.0.0.1:8000  (Ctrl+C to stop)" -ForegroundColor Green
& $py -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
