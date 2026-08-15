# build.ps1
# YT Engagement Verdict — Build Script
# Packages both Firefox (.xpi) and Chrome (.zip) distributions
#
# Usage: .\build.ps1
# Output: Downloads folder

$ErrorActionPreference = "Stop"

$root     = "C:\Users\steve\dev\yt-engagement-verdict"
$output   = "C:\Users\steve\Downloads"
$ffBuild  = "$output\ytev-ff-build"
$chBuild  = "$output\ytev-chrome-build"

# Read version from Firefox manifest
$manifest = Get-Content "$root\manifest.json" | ConvertFrom-Json
$version  = $manifest.version

Write-Host ""
Write-Host "Building YT Engagement Verdict v$version" -ForegroundColor Cyan
Write-Host ""

# ── Firefox ──────────────────────────────────────────────────────────────────

Write-Host "Building Firefox xpi..." -ForegroundColor Yellow

if (Test-Path $ffBuild) { Remove-Item $ffBuild -Recurse -Force }
New-Item -ItemType Directory -Force $ffBuild | Out-Null

$ffFiles = @(
    "manifest.json",
    "background.js",
    "content.js",
    "verdict.js",
    "ryd.js",
    "reporter.js",
    "popup.html",
    "popup.js",
    "welcome.html",
    "welcome.js",
    "styles.css",
    "selectors.json"
)

foreach ($file in $ffFiles) {
    Copy-Item "$root\$file" "$ffBuild\" -Force
}
Copy-Item "$root\icons" "$ffBuild\" -Recurse -Force

$ffOut = "$output\yt-engagement-verdict-$version.xpi"
if (Test-Path $ffOut) { Remove-Item $ffOut -Force }
7z a -tzip $ffOut "$ffBuild\*" | Out-Null

Write-Host "  Firefox: $ffOut" -ForegroundColor Green

# ── Chrome ───────────────────────────────────────────────────────────────────

Write-Host "Building Chrome zip..." -ForegroundColor Yellow

if (Test-Path $chBuild) { Remove-Item $chBuild -Recurse -Force }
New-Item -ItemType Directory -Force $chBuild | Out-Null

$sharedFiles = @(
    "verdict.js",
    "ryd.js",
    "styles.css",
    "welcome.html",
    "selectors.json"
)

foreach ($file in $sharedFiles) {
    Copy-Item "$root\$file" "$chBuild\" -Force
}
Copy-Item "$root\icons" "$chBuild\" -Recurse -Force

$chromeFiles = @(
    "chrome\manifest.json",
    "chrome\background.js",
    "chrome\content.js",
    "chrome\popup.html",
    "chrome\popup.js",
    "chrome\welcome.js",
    "chrome\reporter.js"
)

foreach ($file in $chromeFiles) {
    $leaf = Split-Path $file -Leaf
    Copy-Item "$root\$file" "$chBuild\$leaf" -Force
}

$chOut = "$output\yt-engagement-verdict-chrome-$version.zip"
if (Test-Path $chOut) { Remove-Item $chOut -Force }
7z a -tzip $chOut "$chBuild\*" | Out-Null

Write-Host "  Chrome:  $chOut" -ForegroundColor Green

# ── Cleanup ──────────────────────────────────────────────────────────────────

Remove-Item $ffBuild -Recurse -Force
Remove-Item $chBuild -Recurse -Force

Write-Host ""
Write-Host "Done! Both packages built for v$version." -ForegroundColor Cyan
Write-Host ""
