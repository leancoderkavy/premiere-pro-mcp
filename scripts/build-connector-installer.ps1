param(
  [string]$ConnectorPackage = "",
  [string]$OutputDirectory = "",
  [switch]$RequireSigning,
  [string]$SigningCertificatePath = "",
  [string]$SigningCertificatePassword = ""
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
if (-not $ConnectorPackage) { $ConnectorPackage = Join-Path $projectDir "artifacts\MCPBridgeCEP.zxp" }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectDir "artifacts\connector-installers" }
$ConnectorPackage = [IO.Path]::GetFullPath($ConnectorPackage)
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

if (-not (Test-Path -LiteralPath $ConnectorPackage)) { throw "Verified connector package not found: $ConnectorPackage" }
$package = Get-Content (Join-Path $projectDir "package.json") -Raw | ConvertFrom-Json
$publishDir = Join-Path $OutputDirectory "windows-publish"
New-Item -ItemType Directory -Force -Path $publishDir | Out-Null

dotnet publish (Join-Path $projectDir "installer\windows\PremiereConnectorInstaller.csproj") `
  --configuration Release --runtime win-x64 --self-contained true `
  --output $publishDir `
  -p:ConnectorPackage=$ConnectorPackage `
  -p:Version=$($package.version) `
  -p:PublishSingleFile=true `
  -p:DebugType=None `
  -p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw "Windows connector installer build failed." }

$built = Join-Path $publishDir "PremiereConnectorInstaller.exe"
$output = Join-Path $OutputDirectory "Premiere-Connector-Setup-$($package.version)-windows-x64.exe"
Copy-Item -LiteralPath $built -Destination $output -Force

if ($SigningCertificatePath) {
  $signTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if (-not $signTool) { throw "signtool.exe is required when a signing certificate is supplied." }
  & $signTool.Source sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f $SigningCertificatePath /p $SigningCertificatePassword $output
  if ($LASTEXITCODE -ne 0) { throw "Authenticode signing failed." }
  & $signTool.Source verify /pa $output
  if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed." }
}
elseif ($RequireSigning) {
  throw "Production Windows installer signing was required, but no certificate was supplied."
}

$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Built $output"
Write-Host "SHA-256 $hash"
if (-not $SigningCertificatePath) { Write-Warning "Preview artifact is not Authenticode-signed and must not be published as a production installer." }
