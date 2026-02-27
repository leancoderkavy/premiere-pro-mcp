@echo off
REM Premiere Pro AI Chat — Windows Installer
REM Copies the plugin to the Adobe CEP extensions folder
REM and enables unsigned extensions via registry.

setlocal enabledelayedexpansion

echo ========================================
echo   Premiere Pro AI Chat — Plugin Installer
echo ========================================
echo.

REM Resolve paths
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
set "PLUGIN_SRC=%PROJECT_ROOT%\chat-plugin"
set "PLUGIN_NAME=com.ppro.ai.chat"
set "CEP_DIR=%APPDATA%\Adobe\CEP\extensions"

echo Plugin source: %PLUGIN_SRC%
echo CEP target:    %CEP_DIR%\%PLUGIN_NAME%
echo.

REM Verify source exists
if not exist "%PLUGIN_SRC%" (
    echo [ERROR] Plugin source not found at %PLUGIN_SRC%
    pause
    exit /b 1
)

REM Create CEP extensions directory if needed
if not exist "%CEP_DIR%" (
    echo Creating CEP extensions directory...
    mkdir "%CEP_DIR%"
)

REM Remove existing installation
if exist "%CEP_DIR%\%PLUGIN_NAME%" (
    echo Removing existing installation...
    rmdir /s /q "%CEP_DIR%\%PLUGIN_NAME%"
)

REM Copy plugin
echo Installing plugin...
xcopy /s /e /i /q "%PLUGIN_SRC%" "%CEP_DIR%\%PLUGIN_NAME%"
echo [OK] Plugin installed

REM Enable unsigned extensions (CSXS 9-12)
echo.
echo Enabling unsigned CEP extensions...
for %%v in (9 10 11 12) do (
    reg add "HKCU\SOFTWARE\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo [OK] Debug mode enabled (CSXS 9-12)

echo.
echo ========================================
echo   [OK] Installation complete!
echo ========================================
echo.
echo Next steps:
echo   1. Restart Premiere Pro (if running)
echo   2. Open: Window ^> Extensions ^> AI Chat
echo   3. Enter your Claude or Gemini API key
echo   4. Start chatting to control Premiere Pro!
echo.
pause
