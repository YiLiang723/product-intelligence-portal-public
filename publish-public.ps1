$ErrorActionPreference = "Stop"

# Publishes the products-only public portal to the personal GitHub repo.
# Uses the YiLiang723 gh token WITHOUT switching the active gh account,
# so the EMU (liangyi_microsoft) private flow is never disturbed.

$publicRepo = "C:\Users\liangyi\Documents\product-intelligence-portal-public"
$personalUser = "YiLiang723"
$repoPath = "YiLiang723/product-intelligence-portal-public"

if (-not (Test-Path (Join-Path $publicRepo ".git"))) {
  throw "Public repo not found at $publicRepo"
}

# 1. Regenerate index.html from the private canonical portal
node (Join-Path $publicRepo "build-public-products.js")

Set-Location $publicRepo
git add -A

# 2. Skip if nothing changed
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Output "PUBLIC_NO_CHANGES"
  exit 0
}

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git -c user.name="Yi Liang" -c user.email="liangyi@microsoft.com" commit -m "Auto refresh public portal ($stamp)" | Out-Null

# 3. Push using the personal token (does not change active gh account)
$token = (gh auth token --user $personalUser).Trim()
if (-not $token) { throw "Could not obtain personal GitHub token for $personalUser" }

$pushUrl = "https://x-access-token:$token@github.com/$repoPath.git"
git push $pushUrl main 2>&1 | ForEach-Object {
  if ($_ -notmatch [regex]::Escape($token)) { $_ }
}

Write-Output "PUBLIC_PUBLISHED"
