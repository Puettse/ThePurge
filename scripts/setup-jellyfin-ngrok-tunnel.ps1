[CmdletBinding()]
param(
  [string]$EndpointUrl = 'https://entertainment.ebmsol.com',
  [string]$ProofEndpointUrl = 'https://goatskin-diffuser-fled.ngrok-free.dev',
  [string]$ServiceUrl = 'http://127.0.0.1:8096',
  [string]$NgrokPath = '',
  [switch]$CreateWindowsService,
  [switch]$StartNow,
  [switch]$SetRailwayVariable,
  [switch]$SkipConfigCheck
)

$ErrorActionPreference = 'Stop'

function Resolve-Ngrok {
  param([string]$Candidate)

  if ($Candidate -and (Test-Path -LiteralPath $Candidate)) {
    return (Resolve-Path -LiteralPath $Candidate).Path
  }

  $repoTool = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path '.tools\ngrok.exe'
  if (Test-Path -LiteralPath $repoTool) {
    return (Resolve-Path -LiteralPath $repoTool).Path
  }

  foreach ($commandName in @('ngrok.exe', 'ngrok.cmd', 'ngrok')) {
    $command = Get-Command $commandName -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  throw 'ngrok was not found. Install ngrok, add it to PATH, or pass -NgrokPath.'
}

function Normalize-EndpointUrl {
  param([string]$Value)

  $candidate = [Uri]$Value
  if ($candidate.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($candidate.Host)) {
    throw 'EndpointUrl must be an HTTP or HTTPS URL.'
  }

  return $candidate.GetLeftPart([System.UriPartial]::Authority)
}

function Resolve-NgrokConfigDirectory {
  if ($env:LOCALAPPDATA) {
    return Join-Path $env:LOCALAPPDATA 'ngrok'
  }

  return Join-Path $HOME 'AppData\Local\ngrok'
}

function Invoke-Ngrok {
  param([string[]]$Arguments)

  & $script:Ngrok @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "ngrok failed: $($Arguments -join ' ')"
  }
}

$script:Ngrok = Resolve-Ngrok $NgrokPath
$endpoint = Normalize-EndpointUrl $EndpointUrl
$proofEndpoint = Normalize-EndpointUrl $ProofEndpointUrl
$configDir = Resolve-NgrokConfigDirectory
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

$configPath = Join-Path $configDir 'thepurge-jellyfin.yml'
$config = @(
  'version: 3',
  '',
  'endpoints:',
  '  - name: thepurge-jellyfin',
  '    description: ThePurge Jellyfin bridge for EBMSOL Domain Guard',
  "    url: $endpoint",
  '    upstream:',
  "      url: $ServiceUrl",
  '      protocol: http1'
)
$config | Set-Content -Encoding ascii -LiteralPath $configPath

if (-not $SkipConfigCheck) {
  Invoke-Ngrok @('config', 'check', "--config=$configPath")
}

if ($CreateWindowsService) {
  Invoke-Ngrok @('service', 'install', "--config=$configPath")
}

$processId = $null
if ($StartNow) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $outLog = Join-Path $repoRoot 'tmp-ngrok-jellyfin-service.out.log'
  $errLog = Join-Path $repoRoot 'tmp-ngrok-jellyfin-service.err.log'
  Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue
  $process = Start-Process `
    -FilePath $script:Ngrok `
    -ArgumentList @('start', 'thepurge-jellyfin', "--config=$configPath") `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog
  $processId = $process.Id
}

if ($SetRailwayVariable) {
  $railway = Get-Command railway.cmd -ErrorAction SilentlyContinue
  if (-not $railway) {
    throw 'Railway CLI was not found, so Railway variables were not changed.'
  }
  & $railway.Source variables --set "JELLYFIN_BASE_URL=$proofEndpoint" --set "JELLYFIN_PUBLIC_BASE_URL=$endpoint" --set 'JELLYFIN_ENABLE_PLAY_LINKS=false'
}

[pscustomobject]@{
  endpoint_url = $endpoint
  proof_endpoint_url = $proofEndpoint
  service_url = $ServiceUrl
  config_path = $configPath
  windows_service = if ($CreateWindowsService) { 'ngrok' } else { '' }
  process_id = $processId
  immediate_railway_command = "railway variables --set JELLYFIN_BASE_URL=$proofEndpoint --set JELLYFIN_PUBLIC_BASE_URL=$endpoint --set JELLYFIN_ENABLE_PLAY_LINKS=false"
  final_railway_command = "railway variables --set JELLYFIN_BASE_URL=$endpoint --set JELLYFIN_PUBLIC_BASE_URL=$endpoint --set JELLYFIN_ENABLE_PLAY_LINKS=true"
}
