# PB Tools Release Builder (PowerShell)
# Creates a zip file for GitHub releases

$version = "v0.6.2"
$output = "pb-tools-$version.zip"

Write-Host "Building PB Tools release package..." -ForegroundColor Cyan
Write-Host "Version: $version"
Write-Host "Output: $output"
Write-Host ""

# Remove existing zip if present
if (Test-Path $output) {
    Remove-Item $output
    Write-Host "Removed existing zip file" -ForegroundColor Yellow
}

# Files to include (explicit list)
$includeFiles = @(
    "index.html",
    "app.js",
    "styles.css",
    "README.md"
)

# Directories to include
$includeDirs = @("lib", "assets", "modules")

# Create temp directory for staging
$tempDir = "temp-release"
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "Copying files..." -ForegroundColor Cyan

# Copy files
foreach ($file in $includeFiles) {
    if (Test-Path $file) {
        Copy-Item $file -Destination $tempDir
        Write-Host "  ✓ $file"
    }
}

# Copy directories
foreach ($dir in $includeDirs) {
    if (Test-Path $dir) {
        Copy-Item $dir -Destination $tempDir -Recurse
        Write-Host "  ✓ $dir/"
    }
}

Write-Host ""
Write-Host "Creating zip file..." -ForegroundColor Cyan

# Create zip
Compress-Archive -Path "$tempDir\*" -DestinationPath $output -Force

# Cleanup temp directory
Remove-Item -Recurse -Force $tempDir

if (Test-Path $output) {
    Write-Host ""
    Write-Host "✅ Release package created successfully!" -ForegroundColor Green
    Write-Host "📦 File: $output"
    
    # Show file size
    $size = (Get-Item $output).Length
    $sizeMB = [math]::Round($size / 1MB, 2)
    Write-Host "📊 Size: $sizeMB MB"
} else {
    Write-Host "❌ Error creating zip file" -ForegroundColor Red
    exit 1
}

