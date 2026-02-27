#!/usr/bin/env bash
# Build a cross-platform ZIP for the Premiere Pro AI Chat plugin.
# The ZIP contains the plugin folder + installers for macOS and Windows.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PLUGIN_SRC="$PROJECT_ROOT/chat-plugin"
BUILD_DIR="$PROJECT_ROOT/build"
ZIP_NAME="Premiere-Pro-AI-Chat"
VERSION="1.0.0"

echo "========================================"
echo "  Building ZIP: $ZIP_NAME v$VERSION"
echo "========================================"
echo ""

# Clean previous build
rm -rf "$BUILD_DIR/zip-staging"
mkdir -p "$BUILD_DIR/zip-staging"

STAGING="$BUILD_DIR/zip-staging/$ZIP_NAME-v$VERSION"
mkdir -p "$STAGING"

# ---- Copy plugin files ----
echo "Copying plugin files..."
mkdir -p "$STAGING/com.ppro.ai.chat"
cp -R "$PLUGIN_SRC/"* "$STAGING/com.ppro.ai.chat/"
echo "✓ Plugin files copied"

# ---- Create Windows installer (.bat) ----
cat > "$STAGING/Install-Windows.bat" << 'BAT_EOF'
@echo off
REM Premiere Pro AI Chat — Windows Installer

setlocal enabledelayedexpansion

echo.
echo ==========================================
echo   Premiere Pro AI Chat - Windows Installer
echo ==========================================
echo.

set "SCRIPT_DIR=%~dp0"
set "PLUGIN_SRC=%SCRIPT_DIR%com.ppro.ai.chat"
set "PLUGIN_NAME=com.ppro.ai.chat"
set "CEP_DIR=%APPDATA%\Adobe\CEP\extensions"

if not exist "%PLUGIN_SRC%" (
    echo [ERROR] Plugin files not found.
    echo Make sure you extracted the ZIP first.
    pause
    exit /b 1
)

REM Create CEP directory
if not exist "%CEP_DIR%" mkdir "%CEP_DIR%"

REM Remove old installation
if exist "%CEP_DIR%\%PLUGIN_NAME%" (
    echo Removing previous installation...
    rmdir /s /q "%CEP_DIR%\%PLUGIN_NAME%"
)

REM Copy plugin
echo Installing plugin...
xcopy /s /e /i /q "%PLUGIN_SRC%" "%CEP_DIR%\%PLUGIN_NAME%"
echo [OK] Plugin installed to: %CEP_DIR%\%PLUGIN_NAME%

REM Enable unsigned extensions (CSXS 9-12)
echo Enabling unsigned CEP extensions...
for %%v in (9 10 11 12) do (
    reg add "HKCU\SOFTWARE\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo [OK] Debug mode enabled

echo.
echo ==========================================
echo   [OK] Installation complete!
echo.
echo   Next steps:
echo     1. Restart Premiere Pro (if running)
echo     2. Go to: Window ^> Extensions ^> AI Chat
echo     3. Enter your Claude or Gemini API key
echo     4. Start chatting!
echo ==========================================
echo.
pause
BAT_EOF

echo "✓ Windows installer created"

# ---- Create Windows uninstaller (.bat) ----
cat > "$STAGING/Uninstall-Windows.bat" << 'UNBAT_EOF'
@echo off
REM Premiere Pro AI Chat — Windows Uninstaller

set "PLUGIN_NAME=com.ppro.ai.chat"
set "CEP_DIR=%APPDATA%\Adobe\CEP\extensions"

echo.
echo Uninstalling Premiere Pro AI Chat...

if exist "%CEP_DIR%\%PLUGIN_NAME%" (
    rmdir /s /q "%CEP_DIR%\%PLUGIN_NAME%"
    echo [OK] Plugin removed.
) else (
    echo Plugin not found - nothing to remove.
)

echo.
pause
UNBAT_EOF

echo "✓ Windows uninstaller created"

# ---- Create macOS installer (.command) ----
cat > "$STAGING/Install-macOS.command" << 'MAC_EOF'
#!/usr/bin/env bash
# Premiere Pro AI Chat — macOS Installer

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="com.ppro.ai.chat"
PLUGIN_SRC="$SCRIPT_DIR/com.ppro.ai.chat"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Premiere Pro AI Chat — Installer       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

if [ ! -d "$PLUGIN_SRC" ]; then
  echo "✗ Error: Plugin files not found."
  exit 1
fi

mkdir -p "$CEP_DIR"

if [ -d "$CEP_DIR/$PLUGIN_NAME" ] || [ -L "$CEP_DIR/$PLUGIN_NAME" ]; then
  echo "Removing previous installation..."
  rm -rf "$CEP_DIR/$PLUGIN_NAME"
fi

echo "Installing plugin..."
cp -R "$PLUGIN_SRC" "$CEP_DIR/$PLUGIN_NAME"
echo "✓ Plugin installed to: $CEP_DIR/$PLUGIN_NAME"

echo "Enabling unsigned CEP extensions..."
for ver in 9 10 11 12; do
  defaults write com.adobe.CSXS.$ver PlayerDebugMode 1 2>/dev/null || true
done
echo "✓ Debug mode enabled"

echo ""
echo "════════════════════════════════════════════"
echo "  ✓ Installation complete!"
echo ""
echo "  Next steps:"
echo "    1. Restart Premiere Pro (if running)"
echo "    2. Go to: Window → Extensions → AI Chat"
echo "    3. Enter your Claude or Gemini API key"
echo "    4. Start chatting!"
echo "════════════════════════════════════════════"
echo ""
echo "Press any key to close..."
read -n 1 -s
MAC_EOF

chmod +x "$STAGING/Install-macOS.command"
echo "✓ macOS installer created"

# ---- Create macOS uninstaller ----
cat > "$STAGING/Uninstall-macOS.command" << 'UNMAC_EOF'
#!/usr/bin/env bash
set -e

PLUGIN_NAME="com.ppro.ai.chat"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"

echo ""
echo "Uninstalling Premiere Pro AI Chat..."

if [ -d "$CEP_DIR/$PLUGIN_NAME" ] || [ -L "$CEP_DIR/$PLUGIN_NAME" ]; then
  rm -rf "$CEP_DIR/$PLUGIN_NAME"
  echo "✓ Plugin removed."
else
  echo "Plugin not found — nothing to remove."
fi

echo ""
echo "Press any key to close..."
read -n 1 -s
UNMAC_EOF

chmod +x "$STAGING/Uninstall-macOS.command"
echo "✓ macOS uninstaller created"

# ---- Create README ----
cat > "$STAGING/README.txt" << 'README_EOF'
Premiere Pro AI Chat Plugin
============================

An embedded AI chat panel for Adobe Premiere Pro.
Control your edits with natural language using Claude or Gemini.

INSTALLATION
============

Windows:
  1. Extract this ZIP file
  2. Right-click "Install-Windows.bat" → Run as administrator
  3. Restart Premiere Pro
  4. Go to: Window → Extensions → AI Chat

macOS:
  1. Extract this ZIP file
  2. Double-click "Install-macOS.command"
  3. Restart Premiere Pro
  4. Go to: Window → Extensions → AI Chat

Manual Install (any OS):
  - Copy the "com.ppro.ai.chat" folder to your CEP extensions folder:
    Windows: %APPDATA%\Adobe\CEP\extensions\
    macOS:   ~/Library/Application Support/Adobe/CEP/extensions/
  - Enable unsigned extensions:
    Windows: Set registry key HKCU\SOFTWARE\Adobe\CSXS.11 → PlayerDebugMode = "1"
    macOS:   Run: defaults write com.adobe.CSXS.11 PlayerDebugMode 1

UNINSTALL
=========

Windows: Run "Uninstall-Windows.bat"
macOS:   Double-click "Uninstall-macOS.command"

USAGE
=====

1. Open Premiere Pro
2. Go to: Window → Extensions → AI Chat
3. Choose Claude or Gemini as your AI provider
4. Enter your API key
5. Start chatting! The AI can:
   - Query your project (clips, sequences, tracks)
   - Edit your timeline (add clips, effects, transitions)
   - Export sequences
   - And much more

REQUIREMENTS
============

- Windows 10+ or macOS 10.14+
- Adobe Premiere Pro 2020 (v14.0) or later
- Claude API key (console.anthropic.com) or
  Gemini API key (aistudio.google.com)

SUPPORT
=======

GitHub: https://github.com/ppmcp/premiere-pro-mcp
Issues: https://github.com/ppmcp/premiere-pro-mcp/issues
README_EOF

echo "✓ README created"

# ---- Build ZIP ----
echo ""
echo "Building ZIP..."

ZIP_PATH="$BUILD_DIR/$ZIP_NAME-v$VERSION.zip"
rm -f "$ZIP_PATH"

cd "$BUILD_DIR/zip-staging"
zip -r -q "$ZIP_PATH" "$ZIP_NAME-v$VERSION/"

ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1 | xargs)

echo "✓ ZIP built: $ZIP_PATH"

echo ""
echo "========================================"
echo "  ✓ Build complete!"
echo ""
echo "  File: $ZIP_PATH"
echo "  Size: $ZIP_SIZE"
echo "  Works on: macOS + Windows"
echo "========================================"
echo ""
