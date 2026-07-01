[CmdletBinding()]
param(
  [string]$ServiceUrl = 'http://127.0.0.1:8096',
  [string]$EndpointUrl = 'https://goatskin-diffuser-fled.ngrok-free.dev',
  [string]$NgrokPath = '',
  [int]$StartupTimeoutSeconds = 60
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

$ngrok = Resolve-Ngrok $NgrokPath
$endpoint = Normalize-EndpointUrl $EndpointUrl
$endpointHost = ([Uri]$endpoint).Host
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outLog = Join-Path $repoRoot 'tmp-ngrok-jellyfin.out.log'
$errLog = Join-Path $repoRoot 'tmp-ngrok-jellyfin.err.log'
Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue

$process = Start-Process `
  -FilePath $ngrok `
  -ArgumentList @('http', "--url=$endpointHost", $ServiceUrl) `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$reportedUrl = ''
while ((Get-Date) -lt $deadline -and -not $reportedUrl) {
  Start-Sleep -Seconds 2
  $logs = ((Get-Content -LiteralPath $outLog -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $errLog -ErrorAction SilentlyContinue)) -join "`n"
  $match = [regex]::Match($logs, 'https://[a-zA-Z0-9.-]+')
  if ($match.Success) {
    $reportedUrl = $match.Value.TrimEnd('.', ',', ';')
  }
  if ($process.HasExited) {
    break
  }
}

[pscustomobject]@{
  running = -not $process.HasExited
  process_id = $process.Id
  endpoint_url = if ($reportedUrl) { $reportedUrl } else { $endpoint }
  service_url = $ServiceUrl
  out_log = $outLog
  err_log = $errLog
  railway_sync_value = "JELLYFIN_BASE_URL=$endpoint"
  railway_public_value = 'JELLYFIN_PUBLIC_BASE_URL=https://entertainment.ebmsol.com'
  railway_links_value = 'JELLYFIN_ENABLE_PLAY_LINKS=false'
}
