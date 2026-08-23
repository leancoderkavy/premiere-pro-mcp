param(
  [switch]$Diagnose
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$pluginSource = Join-Path $projectDir "cep-plugin"
$signedPackage = Join-Path $projectDir "artifacts\MCPBridgeCEP.zxp"
$packageMetadata = Get-Content -LiteralPath (Join-Path $projectDir "package.json") -Raw | ConvertFrom-Json
$expectedVersion = [string]$packageMetadata.version
$cepRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
$pluginDestination = Join-Path $cepRoot "MCPBridgeCEP"
$resolvedCepRoot = [System.IO.Path]::GetFullPath($cepRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$resolvedDestination = [System.IO.Path]::GetFullPath($pluginDestination)

if (-not $resolvedDestination.StartsWith($resolvedCepRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to install outside the CEP extensions directory: $resolvedDestination"
}

Write-Host "=== Premiere MCP Connector ==="
Write-Host "Source:      $pluginSource"
Write-Host "Destination: $pluginDestination"
if ($Diagnose) {
  Write-Host "Mode:        Check only (no files or settings will be changed)"
}

if (-not (Test-Path -LiteralPath (Join-Path $pluginSource "CSXS\manifest.xml"))) {
  throw "CEP plugin manifest not found at $pluginSource"
}

$signedPackageMatchesRelease = $false
if (Test-Path -LiteralPath $signedPackage) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($signedPackage)
    try {
      $manifestEntry = $archive.Entries | Where-Object { $_.FullName -eq "CSXS/manifest.xml" } | Select-Object -First 1
      if (-not $manifestEntry) {
        throw "Signed package does not contain CSXS/manifest.xml"
      }
      $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
      try {
        $signedManifest = $reader.ReadToEnd()
      }
      finally {
        $reader.Dispose()
      }
    }
    finally {
      $archive.Dispose()
    }

    $signedPackageMatchesRelease = $signedManifest -match ('ExtensionBundleVersion="' + [regex]::Escape($expectedVersion) + '"')
    if (-not $signedPackageMatchesRelease) {
      Write-Warning "Ignoring artifacts\MCPBridgeCEP.zxp because its embedded connector version does not match package version $expectedVersion."
    }
  }
  catch {
    Write-Warning "Ignoring artifacts\MCPBridgeCEP.zxp because its embedded manifest could not be verified: $($_.Exception.Message)"
  }
}

if (-not $Diagnose) {
  New-Item -ItemType Directory -Force -Path $cepRoot | Out-Null

  if (Test-Path -LiteralPath $pluginDestination) {
    Remove-Item -LiteralPath $resolvedDestination -Recurse -Force
  }
  if ($signedPackageMatchesRelease) {
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
  Write-Error ("The Premiere Connector needs attention:`n" + ($problems -join [Environment]::NewLine))
  Write-Host ""
  Write-Host "Next steps:"
  Write-Host "  1. Fully quit Premiere Pro."
  Write-Host "  2. Run the Connector installer again."
  Write-Host "  3. Reopen Premiere Pro, then choose Window > Extensions > MCP for Adobe Premiere Pro."
  exit 1
}

Write-Host ""
if ($Diagnose) {
  Write-Host "Connector installation looks ready."
  Write-Host "This check cannot confirm that Premiere Pro is currently open or connected."
  Write-Host "Next: Open Premiere Pro and ask your AI assistant to run 'Verify Premiere connection'."
}
else {
  Write-Host "Connector installed. Fully restart Premiere Pro, then open Window > Extensions > MCP for Adobe Premiere Pro."
  Write-Host "After that, ask your AI assistant to run 'Verify Premiere connection' before editing."
}
