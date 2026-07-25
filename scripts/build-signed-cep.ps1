param(
  [string]$OutputPath = "",
  [string]$ZxpSignCmdPath = "",
  [string]$CertificatePath = "",
  [string]$CertificatePassword = ""
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$pluginSource = Join-Path $projectDir "cep-plugin"
if (-not $OutputPath) {
  $OutputPath = Join-Path $projectDir "artifacts\MCPBridgeCEP.zxp"
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("premiere-pro-mcp-zxp-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null

try {
  if (-not $ZxpSignCmdPath) {
    $ZxpSignCmdPath = Join-Path $temporaryRoot "ZXPSignCmd.exe"
    $downloadUrl = "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6/ZXPSignCMD/4.1.103/win64/ZXPSignCmd.exe"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $ZxpSignCmdPath
  }

  if (-not (Test-Path -LiteralPath $ZxpSignCmdPath)) {
    throw "ZXPSignCmd was not found at $ZxpSignCmdPath"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $pluginSource "CSXS\manifest.xml"))) {
    throw "CEP plugin manifest not found at $pluginSource"
  }

  if (-not $CertificatePassword) {
    $CertificatePassword = [guid]::NewGuid().ToString("N")
  }
  if (-not $CertificatePath) {
    $CertificatePath = Join-Path $temporaryRoot "premiere-pro-mcp-release.p12"
    & $ZxpSignCmdPath -selfSignedCert US California "Premiere Pro MCP" "Premiere Pro MCP" $CertificatePassword $CertificatePath
    if ($LASTEXITCODE -ne 0) {
      throw "ZXPSignCmd failed to create the release certificate."
    }
  }

  if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
  }
  & $ZxpSignCmdPath -sign $pluginSource $OutputPath $CertificatePath $CertificatePassword
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $OutputPath)) {
    throw "ZXPSignCmd failed to create $OutputPath"
  }

  & $ZxpSignCmdPath -verify $OutputPath
  if ($LASTEXITCODE -ne 0) {
    throw "ZXPSignCmd could not verify $OutputPath"
  }

  Write-Host "Signed CEP package verified: $OutputPath"
}
finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
