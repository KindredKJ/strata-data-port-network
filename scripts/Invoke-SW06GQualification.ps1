# SW06-G: three independently repeated encrypted proof runs on a private LAN.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ReceiverIp,
  [ValidateRange(1,65535)][int]$Port=47900,
  [ValidateRange(3,10)][int]$RunCount=3
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$oldSecret=[Environment]::GetEnvironmentVariable('KINDRED_SDPN_PROOF_SECRET','Process')
$ptr=[IntPtr]::Zero
Push-Location $root
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js missing' }
  $nodeMajor=[int]((& node -p "process.versions.node.split('.')[0]").Trim())
  if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 22) { throw 'Node.js 22+ required' }
  & npm test
  if ($LASTEXITCODE -ne 0) { throw 'Local tests failed' }
  $commit=(& git rev-parse --verify HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Git HEAD unavailable' }
  if (-not (Test-NetConnection -ComputerName $ReceiverIp -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    throw 'Receiver unavailable on specified TCP port'
  }
  $secure=Read-Host 'One-time receiver pairing secret' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $env:KINDRED_SDPN_PROOF_SECRET=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $ptr=[IntPtr]::Zero
  if ($env:KINDRED_SDPN_PROOF_SECRET.Length -lt 32) { throw 'Short pairing secret' }
  $folder=Join-Path $root '.local-evidence/sw06g'
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  $batch=[guid]::NewGuid().ToString('N')
  $index=@()
  for ($n=1;$n -le $RunCount;$n++) {
    $path=Join-Path $folder ('sw06g-'+$batch+'-'+$n+'.json')
    $arguments=@('./scripts/benchmark-two-host.mjs','--host',$ReceiverIp,'--port',"$Port",
      '--sizes-mib','1,4,16','--trials','12','--warmup','2','--timeout-ms','30000','--output',$path)
    & node @arguments
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $path)) { throw "SW06-G run $n failed" }
    $report=Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -Depth 50
    if ($report.schema -ne 'kindred.sdpn.sw06f.application-benchmark.v1' -or
        $report.observation.twoHostSoftwareProofObserved -ne $true -or
        $report.observation.loopbackTarget -ne $false -or
        $report.observation.physicalMachineAttestationProven -ne $false -or
        $report.observation.productionAuthorized -ne $false) {
      throw "SW06-G run $n receipt/claim verification failed"
    }
    $sizes=@($report.results | ForEach-Object {[int]$_.sizeMiB} | Sort-Object)
    if (($sizes -join ',') -ne '1,4,16' -or
        @($report.results | Where-Object {$_.trials -ne 12}).Count -ne 0) {
      throw "SW06-G run $n missing required payload sizes or trials"
    }
    $index+=@{
      run=$n
      filename=(Split-Path -Leaf $path)
      sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
      runId=$report.runId
      metrics=@($report.results | ForEach-Object {
        @{sizeMiB=$_.sizeMiB;goodputMbps=$_.applicationGoodputMbps;p50Ms=$_.roundTripMs.p50;p95Ms=$_.roundTripMs.p95}
      })
    }
  }
  $manifest=@{
    schema='kindred.sdpn.sw06g.qualification-index.v1'
    sourceCommit=$commit
    createdAtUtc=[DateTime]::UtcNow.ToString('o')
    receiverPrivateIpv4=$ReceiverIp
    receiverTcpPort=$Port
    runCount=$RunCount
    physicalSeparationVerified=$false
    physicalMachineAttestationProven=$false
    productionAuthorized=$false
    internetBandwidthMeasured=$false
    runs=$index
  }
  $manifestPath=Join-Path $folder ('sw06g-'+$batch+'-index.json')
  $content=$manifest | ConvertTo-Json -Depth 20
  $stream=[IO.File]::Open($manifestPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes($content+[Environment]::NewLine)
    $stream.Write($bytes,0,$bytes.Length)
  } finally { $stream.Dispose() }
  Write-Host ('SW06-G private evidence manifest: '+$manifestPath)
  Write-Host 'Physical machine separation remains unverified until independently confirmed.'
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  [Environment]::SetEnvironmentVariable('KINDRED_SDPN_PROOF_SECRET',$oldSecret,'Process')
  Pop-Location
}
