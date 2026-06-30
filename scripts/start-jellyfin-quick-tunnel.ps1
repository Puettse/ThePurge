[CmdletBinding()]
param(
  [string]$ServiceUrl = 'http://127.0.0.1:8096',
  [string]$CloudflaredPath = '',
  [int]$StartupTimeoutSeconds = 60
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

$cloudflared = Resolve-Cloudflared $CloudflaredPath
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outLog = Join-Path $repoRoot 'tmp-cloudflared.out.log'
$errLog = Join-Path $repoRoot 'tmp-cloudflared.err.log'
Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue

$process = Start-Process `
  -FilePath $cloudflared `
  -ArgumentList @('tunnel', '--no-autoupdate', '--url', $ServiceUrl) `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$url = ''
while ((Get-Date) -lt $deadline -and -not $url) {
  Start-Sleep -Seconds 2
  $logs = ((Get-Content -LiteralPath $outLog -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $errLog -ErrorAction SilentlyContinue)) -join "`n"
  $match = [regex]::Match($logs, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
  if ($match.Success) {
    $url = $match.Value
  }
  if ($process.HasExited) {
    break
  }
}

[pscustomobject]@{
  running = -not $process.HasExited
  process_id = $process.Id
  tunnel_url = $url
  service_url = $ServiceUrl
  out_log = $outLog
  err_log = $errLog
}
