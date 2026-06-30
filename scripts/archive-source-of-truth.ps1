[CmdletBinding()]
param(
  [string]$Branch = '',
  [string]$ArchiveRoot = '',
  [string]$ProjectName = 'ThePurge'
)

$ErrorActionPreference = 'Stop'

function ConvertTo-Slug([string]$Value) {
  $slug = ($Value -replace '[^\p{L}\p{Nd}._-]+', '-').Trim('-')
  if (-not $slug) { $slug = 'commit' }
  if ($slug.Length -gt 80) { $slug = $slug.Substring(0, 80).Trim('-') }
  return $slug
}

function Get-ArchiveRelativePath([string]$Root, [string]$Path) {
  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\', '/')
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  if ($resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $resolvedPath.Substring($resolvedRoot.Length).TrimStart('\', '/').Replace('\', '/')
  }
  return $resolvedPath.Replace('\', '/')
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $Branch) {
  $Branch = (& git -C $repoRoot branch --show-current).Trim()
}
if (-not $Branch) {
  throw 'Could not resolve the current Git branch.'
}
if (-not $ArchiveRoot) {
  $ArchiveRoot = Join-Path $repoRoot '_source_of_truth_archive'
}

$versionsDir = Join-Path $ArchiveRoot 'versions'
$bundlesDir = Join-Path $ArchiveRoot 'bundles'
$metadataDir = Join-Path $ArchiveRoot 'metadata'
New-Item -ItemType Directory -Force -Path $versionsDir, $bundlesDir, $metadataDir | Out-Null

$dirty = (& git -C $repoRoot status --porcelain).Trim()
if ($dirty) {
  Write-Warning 'Working tree has uncommitted changes; archive output records committed Git history only.'
}

$remote = (& git -C $repoRoot config --get remote.origin.url).Trim()
$head = (& git -C $repoRoot rev-parse $Branch).Trim()
$headShort = (& git -C $repoRoot rev-parse --short $head).Trim()
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$generatedAt = (Get-Date).ToString('o')

$bundlePath = Join-Path $bundlesDir ("thepurge-$Branch-$headShort.bundle")
& git -C $repoRoot bundle create $bundlePath $Branch | Out-Null
$bundleSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundlePath).Hash

$entries = @()
$ordinal = 0
$commitLines = & git -C $repoRoot log --reverse --format='%H%x09%cI%x09%s' $Branch
foreach ($line in $commitLines) {
  if (-not $line) { continue }
  $parts = $line -split "`t", 3
  if ($parts.Count -lt 3) { continue }

  $ordinal += 1
  $commit = $parts[0]
  $commitDate = $parts[1]
  $subject = $parts[2]
  $short = (& git -C $repoRoot rev-parse --short $commit).Trim()
  $slug = ConvertTo-Slug $subject
  $zipPath = Join-Path $versionsDir ("{0:D4}-{1}-{2}.zip" -f $ordinal, $short, $slug)

  if (-not (Test-Path -LiteralPath $zipPath)) {
    & git -C $repoRoot archive --format=zip -o $zipPath $commit | Out-Null
  }

  $entries += [pscustomobject]@{
    project = $ProjectName
    repo_path = ($repoRoot -replace '\\', '/')
    remote = $remote
    branch = $Branch
    ordinal = $ordinal
    commit = $commit
    short_commit = $short
    commit_date = $commitDate
    subject = $subject
    archive_path = $zipPath
    archive_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash
    bundle_path = $bundlePath
    bundle_sha256 = $bundleSha
    archived_at = $generatedAt
  }
}

$csvPath = Join-Path $metadataDir ("manifest-$headShort-$timestamp.csv")
$entries | Export-Csv -NoTypeInformation -Encoding utf8 -LiteralPath $csvPath
$entries | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $ArchiveRoot 'manifest.json')

$latestPath = Join-Path $metadataDir ("LATEST-$headShort-$timestamp.txt")
$summary = @(
  "Project: $ProjectName",
  "Repo: $($repoRoot -replace '\\', '/')",
  "Remote: $remote",
  "Branch: $Branch",
  "Head: $head",
  "Head short: $headShort",
  "Archived commits: $ordinal",
  "Bundle: $bundlePath",
  "Bundle SHA256: $bundleSha",
  "CSV manifest: $csvPath",
  "Generated: $generatedAt"
)
$summary | Set-Content -Encoding utf8 -LiteralPath $latestPath

$readme = @(
  "# $ProjectName Source-of-Truth Archive",
  '',
  'This folder is local-only and excluded from Git by .git/info/exclude.',
  "Each ZIP under versions/ is an exact git archive for one commit on $Branch.",
  'The bundle under bundles/ can restore the Git history for the archived branch.',
  'Versioned CSV and text metadata records live under metadata/.',
  '',
  ($summary -join [Environment]::NewLine)
)
$readme | Set-Content -Encoding utf8 -LiteralPath (Join-Path $ArchiveRoot 'README.md')

$checksumFiles = @()
$checksumFiles += Get-ChildItem -LiteralPath $versionsDir -File
$checksumFiles += Get-ChildItem -LiteralPath $bundlesDir -File
$checksumFiles += Get-Item -LiteralPath $csvPath
$checksumFiles += Get-Item -LiteralPath $latestPath
$checksumFiles += Get-Item -LiteralPath (Join-Path $ArchiveRoot 'manifest.json')
$checksumFiles += Get-Item -LiteralPath (Join-Path $ArchiveRoot 'README.md')

$checksumLines = $checksumFiles |
  Sort-Object FullName |
  ForEach-Object {
    $relativePath = Get-ArchiveRelativePath $ArchiveRoot $_.FullName
    '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash, $relativePath
  }
$checksumLines | Set-Content -Encoding utf8 -LiteralPath (Join-Path $ArchiveRoot 'checksums.sha256')

[pscustomobject]@{
  head = $head
  short_commit = $headShort
  archived_commits = $ordinal
  bundle = $bundlePath
  bundle_sha256 = $bundleSha
  manifest = $csvPath
  latest = $latestPath
}
