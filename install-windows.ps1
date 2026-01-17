Write-Host "=== Duplicate File Scanner Installer (Windows) ==="

# 1. Check Node.js

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
Write-Host "Node.js not found. Installing Node.js LTS..."
winget install OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
} else {
Write-Host "Node.js already installed."
}

# Refresh PATH

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine")

# 2. Check npm

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
Write-Host "npm not found. Please restart PowerShell and rerun installer."
exit 1
}

# 3. Check git

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
Write-Host "git not found. Installing git..."
winget install Git.Git -e --accept-package-agreements --accept-source-agreements
}

# 4. Download project

if (-not (Test-Path "Duplicate_File_Scanner")) {
Write-Host "Downloading Duplicate_File_Scanner..."
git clone --branch main [https://github.com/Paul-codecourse/Duplicate_File_Scanner.git](https://github.com/Paul-codecourse/Duplicate_File_Scanner.git)
} else {
Write-Host "Project already downloaded."
}

Set-Location Duplicate_File_Scanner

# 5. Start server

Write-Host "Starting server..."
npx serve .
