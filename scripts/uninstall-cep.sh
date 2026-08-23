#!/usr/bin/env bash
# Remove only the MCP for Adobe Premiere Pro CEP connector. It deliberately
# leaves Adobe's shared PlayerDebugMode setting alone.

set -euo pipefail

MODE="${1:---user}"
PLUGIN_NAME="MCPBridgeCEP"

if [[ "$OSTYPE" != darwin* ]]; then
  echo "CEP uninstallation is supported only on macOS by this script." >&2
  exit 1
fi

if pgrep -if "Adobe Premiere Pro" >/dev/null 2>&1; then
  echo "Premiere Pro is running. Fully quit it before removing the Connector." >&2
  exit 1
fi

case "$MODE" in
  --user|--uninstall)
    CEP_ROOT="$HOME/Library/Application Support/Adobe/CEP/extensions"
    ;;
  --system|--uninstall-system)
    if [[ "$(id -u)" -ne 0 ]]; then
      echo "The system-wide connector requires administrator permission." >&2
      echo "Run: sudo \"$0\" --system" >&2
      exit 1
    fi
    CEP_ROOT="/Library/Application Support/Adobe/CEP/extensions"
    ;;
  --help|-h)
    cat <<'EOF'
Usage: uninstall-cep.sh [--user|--system]

  --user    Remove the connector installed for the current user (default).
  --system  Remove the system-wide connector installed by the macOS .pkg.
EOF
    exit 0
    ;;
  *)
    echo "Unknown option: $MODE. Use --user or --system." >&2
    exit 1
    ;;
esac

DESTINATION="$CEP_ROOT/$PLUGIN_NAME"
case "$DESTINATION" in
  "$CEP_ROOT/$PLUGIN_NAME") ;;
  *)
    echo "Refusing to uninstall outside the CEP extensions directory." >&2
    exit 1
    ;;
esac

if [[ -e "$DESTINATION" || -L "$DESTINATION" ]]; then
  rm -rf -- "$DESTINATION"
  echo "Removed the Premiere MCP Connector from $DESTINATION"
else
  echo "The Premiere MCP Connector is not installed at this scope."
fi

echo "Adobe's shared PlayerDebugMode setting was left unchanged."
echo "Remove the MCP server from your AI client's configuration separately if you no longer use it."
