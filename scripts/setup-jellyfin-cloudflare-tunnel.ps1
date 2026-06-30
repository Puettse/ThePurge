[CmdletBinding()]
param(
  [string]$Hostname = 'jellyfin.ebmsol.com',
  [string]$TunnelName = 'ebmsol-jellyfin',
  [string]$ServiceUrl = 'http://127.0.0.1:8096',
  [string]$CloudflaredPath = '',
  [switch]$Login,
  [switch]$CreateScheduledTask,
  [switch]$StartNow,
  [switch]$SetRailwayVariable
)

$ErrorActionPreference = 'Stop'

function Resolve-Cloudflared {
  param([string]$Candidate)

  if ($Candidate -and (Test-Path -LiteralPath $Candidate)) {
    return (Resolve-Path -LiteralPath $Candidate).Path
  }

  $repoTool = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path '.tools\cloudflared.exe'
  if (Test-Path -LiteralPath $repoTool) {
    return (Resolve-Path -LiteralPath $repoTool).Path
  }

  $command = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw 'cloudflared was not found. Install it or pass -CloudflaredPath.'
}

function Invoke-CloudflaredJson {
  param([string[]]$Arguments)

  $raw = & $script:Cloudflared @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "cloudflared failed: $($Arguments -join ' ')"
  }
  if (-not $raw) {
    return $null
  }
  return ($raw | Out-String | ConvertFrom-Json)
}

$script:Cloudflared = Resolve-Cloudflared $CloudflaredPath
$cloudflaredDir = Join-Path $HOME '.cloudflared'
$certPath = Join-Path $cloudflaredDir 'cert.pem'
New-Item -ItemType Directory -Force -Path $cloudflaredDir | Out-Null

if (-not (Test-Path -LiteralPath $certPath)) {
  if ($Login) {
    & $script:Cloudflared tunnel login
  }

  if (-not (Test-Path -LiteralPath $certPath)) {
    throw "Cloudflare login is required first. Run: `"$script:Cloudflared`" tunnel login, choose the ebmsol.com zone, then rerun this script."
  }
}

$tunnels = Invoke-CloudflaredJson @('tunnel', 'list', '--output', 'json')
$tunnel = @($tunnels) | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1

if (-not $tunnel) {
  & $script:Cloudflared tunnel create $TunnelName
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create Cloudflare tunnel $TunnelName."
  }
  $tunnels = Invoke-CloudflaredJson @('tunnel', 'list', '--output', 'json')
  $tunnel = @($tunnels) | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}

if (-not $tunnel -or -not $tunnel.id) {
  throw "Could not resolve Cloudflare tunnel id for $TunnelName."
}

$credentialsFile = Join-Path $cloudflaredDir "$($tunnel.id).json"
$configPath = Join-Path $cloudflaredDir 'jellyfin-ebmsol.yml'
$config = @(
  "tunnel: $($tunnel.id)",
  "credentials-file: $credentialsFile",
  '',
  'ingress:',
  "  - hostname: $Hostname",
  "    service: $ServiceUrl",
  '  - service: http_status:404'
)
$config | Set-Content -Encoding ascii -LiteralPath $configPath

& $script:Cloudflared tunnel route dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) {
  throw "Could not create or update DNS route for $Hostname."
}

$runArgs = "tunnel --config `"$configPath`" run $TunnelName"
$taskName = 'ThePurge Jellyfin Cloudflare Tunnel'
if ($CreateScheduledTask) {
  $taskCommand = "`"$script:Cloudflared`" $runArgs"
  schtasks.exe /Create /SC ONLOGON /TN $taskName /TR $taskCommand /F | Out-Null
}

$processId = $null
if ($StartNow) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $outLog = Join-Path $repoRoot 'tmp-jellyfin-cloudflare-tunnel.out.log'
  $errLog = Join-Path $repoRoot 'tmp-jellyfin-cloudflare-tunnel.err.log'
  $process = Start-Process `
    -FilePath $script:Cloudflared `
    -ArgumentList @('tunnel', '--config', $configPath, 'run', $TunnelName) `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog
  $processId = $process.Id
}

if ($SetRailwayVariable) {
  $railway = Get-Command railway.cmd -ErrorAction SilentlyContinue
  if (-not $railway) {
    throw 'Railway CLI was not found, so JELLYFIN_BASE_URL was not changed.'
  }
  & $railway.Source variables --set "JELLYFIN_BASE_URL=https://$Hostname"
}

[pscustomobject]@{
  hostname = $Hostname
  jellyfin_base_url = "https://$Hostname"
  tunnel_name = $TunnelName
  tunnel_id = $tunnel.id
  service_url = $ServiceUrl
  config_path = $configPath
  scheduled_task = if ($CreateScheduledTask) { $taskName } else { '' }
  process_id = $processId
  railway_variable_command = "railway variables --set JELLYFIN_BASE_URL=https://$Hostname"
}
