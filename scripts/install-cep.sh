#!/bin/bash
# Install the MCP for Adobe Premiere Pro CEP plugin
# This script creates a symlink from the CEP extensions directory to this project's cep-plugin folder.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOST="Premiere"
MODE=""
for arg in "$@"; do
  case "$arg" in
    --after-effects) HOST="AfterEffects" ;;
    --diagnose|--copy) MODE="$arg" ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done
if [ "$HOST" = "AfterEffects" ]; then
  PLUGIN_SRC="$PROJECT_DIR/after-effects-cep-plugin"
  PLUGIN_NAME="MCPAfterEffectsBridgeCEP"
  HOST_LABEL="After Effects"
  HOST_MENU="MCP for Adobe After Effects"
else
  PLUGIN_SRC="$PROJECT_DIR/cep-plugin"
  PLUGIN_NAME="MCPBridgeCEP"
  HOST_LABEL="Premiere Pro"
  HOST_MENU="MCP for Adobe Premiere Pro"
fi

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
  CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  CEP_DIR="$APPDATA/Adobe/CEP/extensions"
else
  echo "Unsupported OS: $OSTYPE"
  exit 1
fi

echo "=== $HOST_LABEL MCP Connector ==="
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
  if [ "$problems" -ne 0 ]; then
    echo ""
    echo "Next steps: fully quit $HOST_LABEL, run the Connector installer again, then reopen it and choose Window > Extensions > $HOST_MENU." >&2
    exit 1
  fi
  echo "Installation verified: Connector files are present."
  echo "This check cannot confirm that Premiere Pro is currently open or connected."
  echo "Next: Open $HOST_LABEL and ask your AI assistant to run 'Verify After Effects connection' for AE or 'Verify Premiere connection' for Premiere."
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
echo "✓ Connector installed"
echo ""
echo "Next steps:"
echo "  1. Fully restart $HOST_LABEL"
echo "  2. Go to Window > Extensions > $HOST_MENU"
echo "  3. Check that the Connector says it is running"
echo "  4. Ask your AI assistant to run the corresponding host connection check"
echo ""
echo "Advanced configuration (only if your AI assistant did not install it for you):"
echo "     node $PROJECT_DIR/dist/index.js"
echo ""
