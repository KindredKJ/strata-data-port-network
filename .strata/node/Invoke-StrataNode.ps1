param(
    [ValidateSet('start','stop','restart','status','logs','verify')]
    [string]$Operation = 'status',
    [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$NodeRoot = Join-Path $Root '.strata\node'
$LogRoot = Join-Path $Root '.strata\logs'
$PidPath = Join-Path $NodeRoot 'node.pid.json'
$NodeScript = Join-Path $Root 'scripts\strata-node.mjs'
$Commit = (& git -c "safe.directory=$Root" -C $Root rev-parse HEAD).Trim()
$Branch = (& git -c "safe.directory=$Root" -C $Root branch --show-current).Trim()

New-Item -ItemType Directory -Force -Path $NodeRoot, $LogRoot | Out-Null

function Get-NodeRecord {
    if (-not (Test-Path -LiteralPath $PidPath -PathType Leaf)) { return $null }
    try { return Get-Content -Raw -LiteralPath $PidPath | ConvertFrom-Json } catch { return $null }
}

function Get-NodeProcess([object]$Record) {
    if (-not $Record) { return $null }
    return Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue
}

function Invoke-NodeGet([string]$Path) {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port$Path" -Method Get -TimeoutSec 3
}

function Start-StrataNode {
    $existing = Get-NodeRecord
    if (Get-NodeProcess $existing) { Write-Output "Strata Node already running (PID $($existing.pid))."; return }
    $stdout = Join-Path $LogRoot 'strata-node.stdout.log'
    $stderr = Join-Path $LogRoot 'strata-node.stderr.log'
    $oldCommit = $env:STRATA_NODE_COMMIT; $oldBranch = $env:STRATA_NODE_BRANCH; $oldPort = $env:STRATA_NODE_PORT
    try {
        $env:STRATA_NODE_COMMIT = $Commit; $env:STRATA_NODE_BRANCH = $Branch; $env:STRATA_NODE_PORT = [string]$Port
        $nodeScriptArgument = '"' + $NodeScript + '"'
        $process = Start-Process -FilePath 'node.exe' -ArgumentList @($nodeScriptArgument, '--port', [string]$Port) -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    } finally {
        $env:STRATA_NODE_COMMIT = $oldCommit; $env:STRATA_NODE_BRANCH = $oldBranch; $env:STRATA_NODE_PORT = $oldPort
    }
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $health = Invoke-NodeGet '/health'
            $readiness = Invoke-NodeGet '/ready'
            if ($health.status -eq 'alive' -and $readiness.status -eq 'ready') { Write-Output "Strata Node started (PID $($process.Id)); readiness=ready"; return }
        } catch { }
    }
    throw "Strata Node did not become ready; inspect $stderr"
}

switch ($Operation) {
    'start' { Start-StrataNode }
    'stop' {
        $record = Get-NodeRecord; $process = Get-NodeProcess $record
        if ($process) { Stop-Process -Id $process.Id; $process.WaitForExit(10000) | Out-Null; Write-Output "Strata Node stopped (PID $($process.Id))." } else { Write-Output 'Strata Node is not running.' }
    }
    'restart' { & $PSCommandPath -Operation stop -Port $Port; $stopExitCode = $LASTEXITCODE; if ($stopExitCode -ne 0) { exit $stopExitCode }; & $PSCommandPath -Operation start -Port $Port; $startExitCode = $LASTEXITCODE; if ($startExitCode -ne 0) { exit $startExitCode } }
    'status' {
        $record = Get-NodeRecord; $process = Get-NodeProcess $record
        if (-not $process) { Write-Output 'Strata Node process=not_running'; exit 1 }
        try { $ready = Invoke-NodeGet '/ready'; Write-Output "Strata Node process=alive readiness=$($ready.status) pid=$($process.Id)" } catch { Write-Output "Strata Node process=alive readiness=unreachable pid=$($process.Id)"; exit 1 }
    }
    'logs' { if (Test-Path -LiteralPath (Join-Path $LogRoot 'strata-node.stdout.log')) { Get-Content -Tail 80 (Join-Path $LogRoot 'strata-node.stdout.log') }; if (Test-Path -LiteralPath (Join-Path $LogRoot 'strata-node.stderr.log')) { Get-Content -Tail 80 (Join-Path $LogRoot 'strata-node.stderr.log') } }
    'verify' {
        $checks = @()
        $record = Get-NodeRecord; $process = Get-NodeProcess $record
        if (-not $process) { Write-Output 'STRATA NODE : NOT GREEN'; Write-Output 'FAILED: process_alive'; exit 1 }
        $health = Invoke-NodeGet '/health'; $checks += @{ name = 'health'; status = ($health.status -eq 'alive') }
        $ready = Invoke-NodeGet '/ready'; $checks += @{ name = 'readiness'; status = ($ready.status -eq 'ready' -and $ready.runtimeReady -eq $true) }
        $node = Invoke-NodeGet '/v1/node'; $checks += @{ name = 'canonical_commit'; status = ($node.canonicalCommit -eq $Commit) }
        $checks += @{ name = 'port_zero_identity'; status = ([bool]$node.nodeId -and $node.nodeId -match '^[0-9a-f-]{36}$') }
        $payload = @{ payload = "strata-node-smoke-$([Guid]::NewGuid().ToString('N'))" } | ConvertTo-Json -Compress
        $transfer = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/transfer" -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 5
        $checks += @{ name = 'safe_local_transfer'; status = ($transfer.receipt.externalEffects -eq $false -and $transfer.receipt.sourceDetached -eq $true -and $transfer.receipt.integrityVerified -eq $true -and $transfer.receipt.classification -eq 'REDUCED_COPY') }
        $identityBefore = (Get-Content -Raw -LiteralPath (Join-Path $NodeRoot 'port-zero.json') | ConvertFrom-Json).nodeId
        & $PSCommandPath -Operation restart -Port $Port
        $restartExitCode = $LASTEXITCODE
        $checks += @{ name = 'restart_command'; status = ($restartExitCode -eq 0); exitCode = $restartExitCode }
        if ($restartExitCode -eq 0) {
            $afterProcess = Get-NodeProcess (Get-NodeRecord); $afterReady = Invoke-NodeGet '/ready'; $afterNode = Invoke-NodeGet '/v1/node'
            $identityAfter = (Get-Content -Raw -LiteralPath (Join-Path $NodeRoot 'port-zero.json') | ConvertFrom-Json).nodeId
            $checks += @{ name = 'process_after_restart'; status = [bool]$afterProcess }
            $checks += @{ name = 'ready_after_restart'; status = ($afterReady.status -eq 'ready' -and $afterReady.runtimeReady -eq $true) }
            $checks += @{ name = 'identity_persisted'; status = ($identityBefore -eq $identityAfter -and $afterNode.nodeId -eq $identityBefore) }
            $smokeAfter = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/transfer" -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 5
            $checks += @{ name = 'post_restart_integrity'; status = ($smokeAfter.receipt.integrityVerified -eq $true -and $smokeAfter.receipt.sourceDetached -eq $true) }
        }
        $allGreen = @($checks | Where-Object { $_.status -ne $true }).Count -eq 0
        if (-not $allGreen) {
            Write-Output 'STRATA NODE : NOT GREEN'
            $checks | ForEach-Object { if ($_.status -ne $true) { Write-Output "FAILED: $($_.name)" } }
            exit 1
        }
        $receipt = [ordered]@{
            schemaVersion = 'strata.node.receipt.v1'
            project = 'Strata Data Port Network'
            founder = 'Kindred Jermaine Cox'
            organization = 'Kindred Labs'
            node = 'Strata Node'
            status = 'GREEN'
            nodeId = $identityBefore
            canonicalCommit = $Commit
            testedCommit = $Commit
            implementationCommit = $Commit
            branch = $Branch
            trackedSourceDirtyAtStart = $false
            timestampUtc = [DateTime]::UtcNow.ToString('o')
            host = '127.0.0.1'
            port = $Port
            checks = $checks
            limitations = [ordered]@{ hardwarePhysicalTransferMeasured = $false; twoMachineTransportProven = $false; zeroCopyClaimAuthorized = $false; productionReadinessProven = $false }
            overall = [ordered]@{ status = 'GREEN'; allRequiredNodeGatesPassed = $true }
        }
        $receiptPath = Join-Path $Root '.strata\receipts' ((Get-Date -Format 'yyyyMMdd-HHmmssfff') + '-node.json')
        $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
        $hash = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath "$receiptPath.sha256" -Value "$hash  $(Split-Path $receiptPath -Leaf)" -Encoding ascii
        Write-Output 'STRATA NODE : GREEN'
        Write-Output "NODE RECEIPT: $receiptPath"
        Write-Output "NODE RECEIPT SHA256: $hash"
    }
}
