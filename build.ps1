# build.ps1
# YT Engagement Verdict — Build Script
# Packages both Firefox (.xpi) and Chrome (.zip) distributions
# from the same unified MV3 source tree. The two packages are
# byte-identical — only the extension differs per store.
#
# Usage: .\build.ps1
# Output: Downloads folder

$ErrorActionPreference = "Stop"

$root     = "C:\Users\steve\dev\yt-engagement-verdict"
$output   = "C:\Users\steve\Downloads"
$staging  = "$output\ytev-build"

# Read version from manifest
$manifest = Get-Content "$root\manifest.json" | ConvertFrom-Json
$version  = $manifest.version

Write-Host ""
Write-Host "Building YT Engagement Verdict v$version" -ForegroundColor Cyan
Write-Host ""

$files = @(
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

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force $staging | Out-Null

foreach ($file in $files) {
    Copy-Item "$root\$file" "$staging\" -Force
}
Copy-Item "$root\icons" "$staging\" -Recurse -Force

# ── Firefox ──────────────────────────────────────────────────────────────────

Write-Host "Building Firefox xpi..." -ForegroundColor Yellow

$ffOut = "$output\yt-engagement-verdict-$version.xpi"
if (Test-Path $ffOut) { Remove-Item $ffOut -Force }
7z a -tzip $ffOut "$staging\*" | Out-Null

Write-Host "  Firefox: $ffOut" -ForegroundColor Green

# ── Chrome ───────────────────────────────────────────────────────────────────

Write-Host "Building Chrome zip..." -ForegroundColor Yellow

$chOut = "$output\yt-engagement-verdict-chrome-$version.zip"
if (Test-Path $chOut) { Remove-Item $chOut -Force }
7z a -tzip $chOut "$staging\*" | Out-Null

Write-Host "  Chrome:  $chOut" -ForegroundColor Green

# ── Cleanup ──────────────────────────────────────────────────────────────────

Remove-Item $staging -Recurse -Force

Write-Host ""
Write-Host "Done! Both packages built for v$version." -ForegroundColor Cyan
Write-Host ""
