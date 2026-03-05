@echo off
REM PB Tools Release Builder for Windows
REM Requires PowerShell 5.0+ (included in Windows 10+)

set VERSION=v0.6.2
set OUTPUT=pb-tools-%VERSION%.zip

echo Building PB Tools release package...
echo Version: %VERSION%
echo Output: %OUTPUT%
echo.

REM Remove existing zip if present
if exist "%OUTPUT%" (
    del "%OUTPUT%"
    echo Removed existing zip file
)

echo Creating zip file...
powershell -Command "Compress-Archive -Path 'index.html','app.js','styles.css','README.md','lib','assets','modules' -DestinationPath '%OUTPUT%' -Force"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ Release package created successfully!
    echo 📦 File: %OUTPUT%
    
    REM Show file size
    for %%A in ("%OUTPUT%") do echo 📊 Size: %%~zA bytes
) else (
    echo ❌ Error creating zip file
    exit /b 1
)

pause
