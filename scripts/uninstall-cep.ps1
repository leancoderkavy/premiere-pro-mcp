param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$cepRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
$pluginDestination = Join-Path $cepRoot "MCPBridgeCEP"
$resolvedCepRoot = [System.IO.Path]::GetFullPath($cepRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$resolvedDestination = [System.IO.Path]::GetFullPath($pluginDestination)

if (-not $resolvedDestination.StartsWith($resolvedCepRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to uninstall outside the CEP extensions directory: $resolvedDestination"
}

$premiereProcess = Get-Process -Name "Adobe Premiere Pro" -ErrorAction SilentlyContinue
if ($premiereProcess) {
  throw "Premiere Pro is running. Fully quit it before removing the Connector."
}

if (Test-Path -LiteralPath $resolvedDestination) {
  Remove-Item -LiteralPath $resolvedDestination -Recurse -Force
  if (-not $Quiet) {
    Write-Host "Removed the Premiere MCP Connector from $pluginDestination"
  }
}
elseif (-not $Quiet) {
  Write-Host "The Premiere MCP Connector is not installed for this Windows user."
}

if (-not $Quiet) {
  Write-Host "Premiere's PlayerDebugMode settings were left unchanged because they can be used by other CEP extensions."
  Write-Host "This removes only the Premiere connector. Remove the MCP server from your AI client's configuration separately if you no longer use it."
}
