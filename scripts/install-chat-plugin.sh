#!/usr/bin/env bash
# Install the Premiere Pro AI Chat CEP plugin
# Creates a symlink (or copies) from the chat-plugin/ directory
# into the Adobe CEP extensions folder.

set -e

PLUGIN_NAME="com.ppro.ai.chat"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PLUGIN_SRC="$PROJECT_ROOT/chat-plugin"

echo "========================================"
echo "  Premiere Pro AI Chat — Plugin Installer"
echo "========================================"
echo ""

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
  CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  CEP_DIR="$HOME/.config/Adobe/CEP/extensions"
else
  echo "⚠  Windows detected. Please manually copy:"
  echo "   From: $PLUGIN_SRC"
  echo "   To:   %APPDATA%\\Adobe\\CEP\\extensions\\$PLUGIN_NAME"
  echo ""
  echo "Then set registry key to enable unsigned extensions:"
  echo '   HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11'
  echo '   PlayerDebugMode = "1" (String)'
  exit 0
fi

echo "Plugin source: $PLUGIN_SRC"
echo "CEP target:    $CEP_DIR/$PLUGIN_NAME"
echo ""

# Verify source exists
if [ ! -d "$PLUGIN_SRC" ]; then
  echo "✗ Error: Plugin source not found at $PLUGIN_SRC"
  exit 1
fi

# Create CEP extensions directory if needed
if [ ! -d "$CEP_DIR" ]; then
  echo "Creating CEP extensions directory..."
  mkdir -p "$CEP_DIR"
fi

# Remove existing installation
if [ -L "$CEP_DIR/$PLUGIN_NAME" ] || [ -d "$CEP_DIR/$PLUGIN_NAME" ]; then
  echo "Removing existing installation..."
  rm -rf "$CEP_DIR/$PLUGIN_NAME"
fi

# Create symlink
echo "Creating symlink..."
ln -s "$PLUGIN_SRC" "$CEP_DIR/$PLUGIN_NAME"
echo "✓ Symlink created"

# Enable unsigned extensions (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo ""
  echo "Enabling unsigned CEP extensions..."
  # Support CSXS versions 9-12 for various Premiere Pro versions
  for ver in 9 10 11 12; do
    defaults write com.adobe.CSXS.$ver PlayerDebugMode 1 2>/dev/null || true
  done
  echo "✓ Debug mode enabled (CSXS 9-12)"
fi

echo ""
echo "========================================"
echo "  ✓ Installation complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Restart Premiere Pro (if running)"
echo "  2. Open: Window → Extensions → AI Chat"
echo "  3. Enter your Claude or Gemini API key"
echo "  4. Start chatting to control Premiere Pro!"
echo ""
echo "Note: The AI Chat panel and MCP Bridge panel"
echo "can run side by side if you have both installed."
echo ""
