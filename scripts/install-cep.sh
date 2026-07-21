#!/bin/bash
# Install the MCP Bridge CEP plugin for Premiere Pro
# This script creates a symlink from the CEP extensions directory to this project's cep-plugin folder.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLUGIN_SRC="$PROJECT_DIR/cep-plugin"
PLUGIN_NAME="MCPBridgeCEP"
MODE="${1:-}"

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
  CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  CEP_DIR="$APPDATA/Adobe/CEP/extensions"
else
  echo "Unsupported OS: $OSTYPE"
  exit 1
fi

echo "=== MCP Bridge CEP Plugin Installer ==="
echo ""
echo "Source:      $PLUGIN_SRC"
echo "Destination: $CEP_DIR/$PLUGIN_NAME"
echo ""

if [ ! -f "$PLUGIN_SRC/CSXS/manifest.xml" ]; then
  echo "CEP plugin manifest not found at $PLUGIN_SRC" >&2
  exit 1
fi

if [ "$MODE" = "--diagnose" ]; then
  problems=0
  if [ ! -f "$CEP_DIR/$PLUGIN_NAME/CSXS/manifest.xml" ]; then
    echo "Plugin manifest is missing from $CEP_DIR/$PLUGIN_NAME" >&2
    problems=1
  fi
  if [[ "$OSTYPE" == "darwin"* ]]; then
    for version in 9 10 11 12 13 14; do
      if [ "$(defaults read com.adobe.CSXS.$version PlayerDebugMode 2>/dev/null || true)" != "1" ]; then
        echo "CSXS.$version PlayerDebugMode is missing or not set to 1" >&2
        problems=1
      fi
    done
  fi
  if [ "$problems" -ne 0 ]; then exit 1; fi
  echo "Installation verified. Restart Premiere Pro, then open Window > Extensions > MCP Bridge."
  exit 0
fi

# Create CEP extensions directory if needed
mkdir -p "$CEP_DIR"

# Remove existing installation
if [ -e "$CEP_DIR/$PLUGIN_NAME" ] || [ -L "$CEP_DIR/$PLUGIN_NAME" ]; then
  echo "Removing existing installation..."
  rm -rf "$CEP_DIR/$PLUGIN_NAME"
fi

# Create symlink (for development) or copy (for production)
if [ "$MODE" = "--copy" ]; then
  echo "Copying plugin files..."
  cp -r "$PLUGIN_SRC" "$CEP_DIR/$PLUGIN_NAME"
else
  echo "Creating symlink (development mode)..."
  ln -s "$PLUGIN_SRC" "$CEP_DIR/$PLUGIN_NAME"
fi

if [ ! -f "$CEP_DIR/$PLUGIN_NAME/CSXS/manifest.xml" ]; then
  echo "Installation failed: plugin manifest was not installed" >&2
  exit 1
fi

echo ""

# Enable CEP debug mode (allows unsigned extensions)
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Enabling CEP debug mode..."
  for version in 8 9 10 11 12 13 14; do
    defaults write com.adobe.CSXS.$version PlayerDebugMode 1 2>/dev/null || true
  done
  echo "CEP debug mode enabled for CSXS 8-14"
fi

echo ""
echo "✓ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Restart Premiere Pro"
echo "  2. Go to Window > Extensions > MCP Bridge"
echo "  3. Set the temp directory and click 'Start Bridge'"
echo "  4. Configure your MCP client (e.g., Claude Desktop) to use:"
echo "     node $PROJECT_DIR/dist/index.js"
echo ""
