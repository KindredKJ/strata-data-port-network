param([int]$Port = 8787)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$NodeController = Join-Path $Root '.strata\node\Invoke-StrataNode.ps1'

function Invoke-RequiredGate {
    param([string]$Name, [string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory = $Root)
    Write-Host "[STRATA GATE] $Name"
    & $FilePath @ArgumentList
    $exitCode = $LASTEXITCODE
    Write-Host "[STRATA GATE] $Name exit=$exitCode"
    if ($exitCode -ne 0) { throw "$Name failed with exit code $exitCode" }
}

$branch = (& git -c "safe.directory=$Root" -C $Root branch --show-current).Trim()
$branchExitCode = $LASTEXITCODE
if ($branchExitCode -ne 0) { throw "Unable to determine branch; exit code $branchExitCode" }
if ($branch -eq 'main') { throw 'Campaign refuses to run on main.' }

Invoke-RequiredGate 'complete release verification' 'npm.cmd' @('run', 'verify:release')
Invoke-RequiredGate 'start Strata Node' 'pwsh.exe' @('-NoProfile', '-File', $NodeController, '-Operation', 'start', '-Port', $Port)
Invoke-RequiredGate 'live Strata Node verification and restart recovery' 'pwsh.exe' @('-NoProfile', '-File', $NodeController, '-Operation', 'verify', '-Port', $Port)

Write-Host ''
Write-Host 'STRATA CAMPAIGN COMPLETE' -ForegroundColor Green
Write-Host 'Release receipt and node receipt were created only after their observed gates passed.'
Write-Host "Persistent Strata Node remains on localhost port $Port."
