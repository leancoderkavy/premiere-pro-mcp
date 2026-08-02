#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONNECTOR_PACKAGE="${CONNECTOR_PACKAGE:-$PROJECT_DIR/artifacts/MCPBridgeCEP.zxp}"
OUTPUT_DIRECTORY="${OUTPUT_DIRECTORY:-$PROJECT_DIR/artifacts/connector-installers}"
REQUIRE_SIGNING="${REQUIRE_SIGNING:-false}"
VERSION="$(node -p "require('$PROJECT_DIR/package.json').version")"

if [[ ! -f "$CONNECTOR_PACKAGE" ]]; then
  echo "Verified connector package not found: $CONNECTOR_PACKAGE" >&2
  exit 1
fi

TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT
PAYLOAD_ROOT="$TEMP_ROOT/payload"
INSTALL_ROOT="$PAYLOAD_ROOT/Library/Application Support/Adobe/CEP/extensions/MCPBridgeCEP"
mkdir -p "$INSTALL_ROOT" "$OUTPUT_DIRECTORY"
ditto -x -k "$CONNECTOR_PACKAGE" "$INSTALL_ROOT"

if [[ ! -f "$INSTALL_ROOT/CSXS/manifest.xml" ]]; then
  echo "Connector package is missing CSXS/manifest.xml" >&2
  exit 1
fi

OUTPUT="$OUTPUT_DIRECTORY/Premiere-Connector-Setup-$VERSION-macos-universal.pkg"
ARGS=(--root "$PAYLOAD_ROOT" --identifier com.premieremcp.connector --version "$VERSION" --install-location /)
if [[ -n "${MAC_INSTALLER_IDENTITY:-}" ]]; then
  ARGS+=(--sign "$MAC_INSTALLER_IDENTITY")
elif [[ "$REQUIRE_SIGNING" == "true" ]]; then
  echo "Production macOS installer signing was required, but MAC_INSTALLER_IDENTITY is not configured." >&2
  exit 1
fi

pkgbuild "${ARGS[@]}" "$OUTPUT"
pkgutil --check-signature "$OUTPUT" || {
  if [[ "$REQUIRE_SIGNING" == "true" ]]; then exit 1; fi
  echo "Preview artifact is unsigned and must not be published as a production installer." >&2
}
shasum -a 256 "$OUTPUT"
