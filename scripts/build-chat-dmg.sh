#!/usr/bin/env bash
# Build a macOS DMG for the Premiere Pro AI Chat plugin.
# The DMG contains the plugin folder + an installer script.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PLUGIN_SRC="$PROJECT_ROOT/chat-plugin"
BUILD_DIR="$PROJECT_ROOT/build"
DMG_NAME="Premiere-Pro-AI-Chat"
DMG_VOLUME="Premiere Pro AI Chat"
VERSION="1.0.0"

echo "========================================"
echo "  Building DMG: $DMG_NAME v$VERSION"
echo "========================================"
echo ""

# Clean previous DMG staging (preserve other build artifacts)
rm -rf "$BUILD_DIR/dmg-staging"
mkdir -p "$BUILD_DIR/dmg-staging"

STAGING="$BUILD_DIR/dmg-staging"

# ---- Copy plugin files ----
echo "Copying plugin files..."
mkdir -p "$STAGING/Premiere Pro AI Chat.cep"
cp -R "$PLUGIN_SRC/"* "$STAGING/Premiere Pro AI Chat.cep/"
echo "✓ Plugin files copied"

# ---- Create installer script inside DMG ----
cat > "$STAGING/Install Plugin.command" << 'INSTALLER_EOF'
#!/usr/bin/env bash
# Premiere Pro AI Chat — One-click Installer

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="com.ppro.ai.chat"
PLUGIN_SRC="$SCRIPT_DIR/Premiere Pro AI Chat.cep"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Premiere Pro AI Chat — Installer       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Verify source
if [ ! -d "$PLUGIN_SRC" ]; then
  echo "✗ Error: Plugin files not found."
  echo "  Make sure you're running this from the DMG."
  exit 1
fi

# Create CEP directory
mkdir -p "$CEP_DIR"

# Remove old installation
if [ -d "$CEP_DIR/$PLUGIN_NAME" ] || [ -L "$CEP_DIR/$PLUGIN_NAME" ]; then
  echo "Removing previous installation..."
  rm -rf "$CEP_DIR/$PLUGIN_NAME"
fi

# Copy plugin
echo "Installing plugin..."
cp -R "$PLUGIN_SRC" "$CEP_DIR/$PLUGIN_NAME"
echo "✓ Plugin installed to: $CEP_DIR/$PLUGIN_NAME"

# Enable unsigned extensions
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
INSTALLER_EOF

chmod +x "$STAGING/Install Plugin.command"
echo "✓ Installer script created"

# ---- Create README ----
cat > "$STAGING/README.txt" << 'README_EOF'
Premiere Pro AI Chat Plugin
============================

An embedded AI chat panel for Adobe Premiere Pro.
Control your edits with natural language using Claude or Gemini.

INSTALLATION
============

Option 1: Double-click "Install Plugin.command"
  - This will copy the plugin to your Adobe CEP extensions folder
  - It will enable unsigned extensions automatically

Option 2: Manual Install
  - Copy the "Premiere Pro AI Chat.cep" folder to:
    ~/Library/Application Support/Adobe/CEP/extensions/com.ppro.ai.chat
  - Enable unsigned extensions by running in Terminal:
    defaults write com.adobe.CSXS.11 PlayerDebugMode 1

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

- macOS 10.14+
- Adobe Premiere Pro 2020 (v14.0) or later
- Claude API key (console.anthropic.com) or
  Gemini API key (aistudio.google.com)

SUPPORT
=======

GitHub: https://github.com/ppmcp/premiere-pro-mcp
Issues: https://github.com/ppmcp/premiere-pro-mcp/issues
README_EOF

echo "✓ README created"

# ---- Create Uninstaller ----
cat > "$STAGING/Uninstall Plugin.command" << 'UNINSTALL_EOF'
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
UNINSTALL_EOF

chmod +x "$STAGING/Uninstall Plugin.command"
echo "✓ Uninstaller created"

# ---- Build DMG ----
echo ""
echo "Building DMG..."

DMG_PATH="$BUILD_DIR/$DMG_NAME-v$VERSION.dmg"
TEMP_DMG="$BUILD_DIR/temp.dmg"

# Create a temporary DMG
hdiutil create -srcfolder "$STAGING" \
  -volname "$DMG_VOLUME" \
  -format UDRW \
  -fs HFS+ \
  -size 20m \
  "$TEMP_DMG" \
  -quiet

# Convert to compressed read-only DMG
hdiutil convert "$TEMP_DMG" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -o "$DMG_PATH" \
  -quiet

rm -f "$TEMP_DMG"

echo "✓ DMG built: $DMG_PATH"

# Get file size
DMG_SIZE=$(du -h "$DMG_PATH" | cut -f1 | xargs)

echo ""
echo "========================================"
echo "  ✓ Build complete!"
echo ""
echo "  File: $DMG_PATH"
echo "  Size: $DMG_SIZE"
echo "========================================"
echo ""
