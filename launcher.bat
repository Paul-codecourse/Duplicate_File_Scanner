@echo off
title Node.js Advanced Duplicate Scanner
color 0A

:: Clear old values
set "scanPath="
set "exts="

:: Header
echo ======================================================
echo        ADVANCED MULTI-DRIVE DUPLICATE SCANNER
echo ======================================================
echo.

:: 1. Instructions for Paths
echo [STEP 1] Enter paths to scan. 
echo For multiple drives, separate with a comma.
echo Example: C:\Users, D:\Backup, E:\
echo.
set /p scanPath="Path(s): "

:: 2. Instructions for Extensions
echo.
echo [STEP 2] Enter extensions (e.g., jpg,mp4,pdf)
echo Leave blank to scan EVERYTHING.
set /p exts="Extensions: "

:: 3. Confirmation
echo.
echo ------------------------------------------------------
echo Target: %scanPath%
if "%exts%"=="" (
    echo Filter: All Files
) else (
    echo Filter: %exts%
)
echo ------------------------------------------------------
echo.

:: 4. Execute Node Script
if "%exts%"=="" (
    node duplicateChecker.js "%scanPath%"
) else (
    node duplicateChecker.js "%scanPath%" "%exts%"
)

:: 5. Conclusion
echo.
echo ------------------------------------------------------
echo Done! Check the folder for your CSV and Log files.
echo ------------------------------------------------------
pause
