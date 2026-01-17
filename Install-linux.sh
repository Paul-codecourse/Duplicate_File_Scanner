#!/usr/bin/env bash
set -e

echo "=== Duplicate File Scanner Installer (Linux) ==="

# 1. Check Node.js

if ! command -v node >/dev/null 2>&1; then
echo "Node.js not found. Installing Node.js LTS..."
curl -fsSL [https://deb.nodesource.com/setup_lts.x](https://deb.nodesource.com/setup_lts.x) | sudo -E bash -
sudo apt-get install -y nodejs
else
echo "Node.js already installed."
fi

# 2. Check npm

if ! command -v npm >/dev/null 2>&1; then
echo "npm not found. Installing npm..."
sudo apt-get install -y npm
else
echo "npm already installed."
fi

# 3. Check git

if ! command -v git >/dev/null 2>&1; then
echo "git not found. Installing git..."
sudo apt-get install -y git
fi

# 4. Download project

if [ ! -d "Duplicate_File_Scanner" ]; then
echo "Downloading Duplicate_File_Scanner..."
git clone --branch main [https://github.com/Paul-codecourse/Duplicate_File_Scanner.git](https://github.com/Paul-codecourse/Duplicate_File_Scanner.git)
else
echo "Project already downloaded."
fi

cd Duplicate_File_Scanner

# 5. Start server

echo "Starting server..."
npx serve .

echo "Installation complete."