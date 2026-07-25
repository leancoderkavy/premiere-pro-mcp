param(
  [switch]$Diagnose
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$pluginSource = Join-Path $projectDir "cep-plugin"
$signedPackage = Join-Path $projectDir "artifacts\MCPBridgeCEP.zxp"
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
  if (Test-Path -LiteralPath $signedPackage) {
    $temporaryZip = Join-Path ([System.IO.Path]::GetTempPath()) ("MCPBridgeCEP-" + [guid]::NewGuid().ToString("N") + ".zip")
    try {
      Copy-Item -LiteralPath $signedPackage -Destination $temporaryZip
      Expand-Archive -LiteralPath $temporaryZip -DestinationPath $pluginDestination
      Write-Host "Installed signed CEP package: $signedPackage"
    }
    finally {
      if (Test-Path -LiteralPath $temporaryZip) {
        Remove-Item -LiteralPath $temporaryZip -Force
      }
    }
  }
  else {
    Copy-Item -LiteralPath $pluginSource -Destination $pluginDestination -Recurse
    Write-Warning "No signed CEP package is present; installed the development bundle and enabled PlayerDebugMode."
  }

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

$signatureFailures = Get-ChildItem -Path $env:TEMP -Filter "CEP*-PPRO.log" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 |
  Select-String -Pattern "Signature verification failed for extension com\.mcp\.premiere\.bridge" -ErrorAction SilentlyContinue
if ($signatureFailures) {
  $latestFailure = $signatureFailures | Select-Object -First 1
  $problems += "Premiere logged a signature failure in $($latestFailure.Path). Reinstall from a release containing artifacts\MCPBridgeCEP.zxp, fully quit Premiere, and relaunch it."
}

if ($problems.Count -gt 0) {
  Write-Error ($problems -join [Environment]::NewLine)
  exit 1
}

Write-Host ""
if ($Diagnose) {
  Write-Host "CEP diagnostics passed."
}
else {
  Write-Host "Installation verified. Restart Premiere Pro, then open Window > Extensions > MCP Bridge."
}
