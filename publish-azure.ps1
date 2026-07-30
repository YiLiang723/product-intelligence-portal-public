$ErrorActionPreference = "Stop"

# Publishes the products-only public portal to Azure App Service (China-accessible).
# Regenerates the public HTML directly from the PRIVATE canonical portal (not from
# the GitHub public copy), so the two public channels are independent.
# Uses the machine's existing `az` login (admin@lydemo.top); no interactive prompt.

$publicRepo = "C:\Users\liangyi\Documents\product-intelligence-portal-public"
$deployDir  = Join-Path $publicRepo "azure-deploy"
$zipPath    = Join-Path $publicRepo "site.zip"
$app        = "ms-product-updates"
$rg         = "rg-product-portal-public"

# 1. Regenerate public HTML from the private canonical portal
node (Join-Path $publicRepo "build-public-products.js")

# 2. Safety: never ship Message Center / tenant data
$html = Get-Content (Join-Path $publicRepo "index.html") -Raw
if ($html -match "lynx\.office\.net" -or $html -match "MC1[0-9]{6}" -or $html -match "Mindray|LEDVANCE|STRYKER") {
  throw "ABORT: public HTML appears to contain Message Center / tenant data. Not deploying."
}

# 3. Stage deploy folder (index.html + web.config for IIS default document)
if (Test-Path $deployDir) { Remove-Item $deployDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $deployDir | Out-Null
Copy-Item (Join-Path $publicRepo "index.html") (Join-Path $deployDir "index.html") -Force
$webconfig = '<?xml version="1.0" encoding="UTF-8"?><configuration><system.webServer><defaultDocument><files><clear/><add value="index.html"/></files></defaultDocument><staticContent><clientCache cacheControlMode="DisableCache"/></staticContent></system.webServer></configuration>'
Set-Content -LiteralPath (Join-Path $deployDir "web.config") -Value $webconfig -Encoding UTF8

# 4. Zip and deploy
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
$ProgressPreference = "SilentlyContinue"
Compress-Archive -Path (Join-Path $deployDir "*") -DestinationPath $zipPath -Force
$ProgressPreference = "Continue"

az webapp deploy -n $app -g $rg --src-path $zipPath --type zip -o none
if ($LASTEXITCODE -ne 0) { throw "az webapp deploy failed with exit code $LASTEXITCODE" }

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Write-Output "AZURE_PUBLISHED https://ms-product-updates.azurewebsites.net/"
