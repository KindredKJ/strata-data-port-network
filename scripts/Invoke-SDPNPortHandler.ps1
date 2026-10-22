# User-activated native port:// handler. URI is untrusted and is never executed as code.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PortUri,
    [Parameter(Mandatory)][string]$ManifestPath
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'SDPN Windows handler requires Windows' }
$head = 'Strata Data Port Network · PORT'
$message = ''
try {
    if ($PortUri.Length -gt 1024 -or $PortUri -cnotmatch '^port://[a-z0-9.-]+(?:/[A-Za-z0-9_-]+)*/?$') {
        throw 'Unsafe or noncanonical port:// address'
    }
    $node = (Get-Command node -ErrorAction Stop).Source
    $resolver = Join-Path $PSScriptRoot 'port-resolve.mjs'
    $payload = & $node $resolver $PortUri '--manifest' $ManifestPath 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Signed namespace could not be verified' }
    $record = ($payload -join [Environment]::NewLine) | ConvertFrom-Json -AsHashtable
    if ($record.schema -ne 'kindred.sdpn.port-resolution.v1' -or
        $record.nameSignatureVerified -cne $true -or
        $record.authorizationGranted -cne $false -or
        $record.networkConnected -cne $false) {
        throw 'Untrusted or overstated SDPN address'
    }
    $message = 'PORT address verified:' + [Environment]::NewLine +
        $record.address + [Environment]::NewLine + [Environment]::NewLine +
        'SDPN signed name only. Native connection and data access are NOT active.'
} catch {
    $message = 'PORT denied. The address is not trusted or is unavailable.' +
        [Environment]::NewLine + $_.Exception.Message
}
try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($message, $head,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
} catch {
    Write-Output ($head + [Environment]::NewLine + $message)
}
