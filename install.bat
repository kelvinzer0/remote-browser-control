@echo off
setlocal

set HOST_ID=com.kelvin.rbc
set EXT_ID=elbhjlckdneolfcekfflfgfppeelbmdk
set INSTALL_DIR=%LOCALAPPDATA%\rbc
set PROJECT_DIR=%~dp0

echo === Remote Browser Control — Install Native Host ===

REM Kill running instances first
echo [0/4] Stopping running rbc-host...
taskkill /F /IM rbc-host.exe >nul 2>&1

REM Build release binary
echo [1/4] Building rbc-host...
cd /d "%PROJECT_DIR%host"
cargo build --release
if errorlevel 1 (
    echo BUILD FAILED
    exit /b 1
)

REM Create install directory
echo [2/4] Installing to %INSTALL_DIR%...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /y "%PROJECT_DIR%host\target\release\rbc-host.exe" "%INSTALL_DIR%\rbc-host.exe"
if errorlevel 1 (
    echo COPY FAILED — is rbc-host.exe still running?
    exit /b 1
)

REM Create NM manifest
echo [3/4] Writing native messaging manifest...
(
echo {
echo   "name": "%HOST_ID%",
echo   "description": "Remote Browser Control MCP Host",
echo   "path": "%INSTALL_DIR:\=\\%\\rbc-host.exe",
echo   "type": "stdio",
echo   "allowed_origins": ["chrome-extension://%EXT_ID%/"]
echo }
) > "%INSTALL_DIR%\%HOST_ID%.json"

REM Register in Windows registry
echo [4/4] Registering native messaging host...
reg add "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\%HOST_ID%" /ve /t REG_SZ /d "%INSTALL_DIR%\%HOST_ID%.json" /f >nul

echo.
echo === Done! ===
echo Binary:  %INSTALL_DIR%\rbc-host.exe
echo Manifest: %INSTALL_DIR%\%HOST_ID%.json
echo.
echo Restart Chrome, then load the extension from: %PROJECT_DIR%extension
