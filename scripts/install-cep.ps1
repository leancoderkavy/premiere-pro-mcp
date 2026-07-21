param(
  [switch]$Diagnose
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$pluginSource = Join-Path $projectDir "cep-plugin"
$cepRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
$pluginDestination = Join-Path $cepRoot "MCPBridgeCEP"
$resolvedCepRoot = [System.IO.Path]::GetFullPath($cepRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$resolvedDestination = [System.IO.Path]::GetFullPath($pluginDestination)

if (-not $resolvedDestination.StartsWith($resolvedCepRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to install outside the CEP extensions directory: $resolvedDestination"
}

Write-Host "=== MCP Bridge CEP Plugin Installer ==="
Write-Host "Source:      $pluginSource"
Write-Host "Destination: $pluginDestination"

if (-not (Test-Path -LiteralPath (Join-Path $pluginSource "CSXS\manifest.xml"))) {
  throw "CEP plugin manifest not found at $pluginSource"
}

if (-not $Diagnose) {
  New-Item -ItemType Directory -Force -Path $cepRoot | Out-Null

  if (Test-Path -LiteralPath $pluginDestination) {
    Remove-Item -LiteralPath $resolvedDestination -Recurse -Force
  }
  Copy-Item -LiteralPath $pluginSource -Destination $pluginDestination -Recurse

  # Adobe requires PlayerDebugMode to be a String value. A DWORD that happens
  # to contain 1 is ignored by CEP and the unsigned extension is not discovered.
  foreach ($version in 9..14) {
    $key = "HKCU:\SOFTWARE\Adobe\CSXS.$version"
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name "PlayerDebugMode" -PropertyType String -Value "1" -Force | Out-Null
  }
}

$problems = @()
if (-not (Test-Path -LiteralPath (Join-Path $pluginDestination "CSXS\manifest.xml"))) {
  $problems += "Plugin manifest is missing from $pluginDestination"
}

foreach ($version in 9..14) {
  $key = "HKCU:\SOFTWARE\Adobe\CSXS.$version"
  $value = Get-ItemProperty -Path $key -Name "PlayerDebugMode" -ErrorAction SilentlyContinue
  if ($null -eq $value -or [string]$value.PlayerDebugMode -ne "1") {
    $problems += "CSXS.$version PlayerDebugMode is missing or not set to 1"
    continue
  }

  $kind = (Get-Item -Path $key).GetValueKind("PlayerDebugMode")
  if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String) {
    $problems += "CSXS.$version PlayerDebugMode is $kind; Adobe requires REG_SZ"
  }
}

if ($problems.Count -gt 0) {
  Write-Error ($problems -join [Environment]::NewLine)
  exit 1
}

Write-Host ""
Write-Host "Installation verified. Restart Premiere Pro, then open Window > Extensions > MCP Bridge."
