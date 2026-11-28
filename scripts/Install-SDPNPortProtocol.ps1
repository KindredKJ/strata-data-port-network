# Windows 11 user-scoped SDPN URI activation, after operator opt-in.
# This registers port:// only. It does not replace Windows HTTP/HTTPS handlers.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet('Install','Uninstall')][string]$Action = 'Install',
    [string]$ManifestPath = (Join-Path $HOME '.sdpn\port-names.json'),
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This handler installer requires Windows.' }
$root = 'HKCU:\Software\Classes\port'
$ownerMarker = 'KindredLabs.SDPN.PortProtocol.v1'
if ($Action -eq 'Uninstall') {
    if (-not (Test-Path -LiteralPath $root)) { Write-Output 'No port protocol registration found'; return }
    $marker = (Get-Item -LiteralPath $root).GetValue('SDPNOwner')
    if ($marker -ne $ownerMarker) { throw 'Refusing to remove a port handler not owned by SDPN.' }
    if ($PSCmdlet.ShouldProcess($root, 'Remove SDPN port scheme registration')) {
        Remove-Item -LiteralPath $root -Recurse -Force
        Write-Output 'Removed SDPN user-scoped port:// registration'
    }
    return
}
$node = (Get-Command node -ErrorAction Stop).Source
$powerShell = (Get-Command pwsh -ErrorAction Stop).Source
$handler = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'Invoke-SDPNPortHandler.ps1')).Path
$manifest = (Resolve-Path -LiteralPath $ManifestPath -ErrorAction Stop).Path
foreach ($value in @($node, $powerShell, $handler, $manifest)) {
    if ($value.Contains('"') -or $value.Contains([char]13) -or $value.Contains([char]10)) {
        throw 'Unsafe URI activation path'
    }
}
if (Test-Path -LiteralPath $root) {
    $existingMarker = (Get-Item -LiteralPath $root).GetValue('SDPNOwner')
    if ($existingMarker -ne $ownerMarker -and -not $Force) {
        throw 'A different port:// handler is already registered. Review before using -Force.'
    }
}
$launch = ('"{0}" -NoLogo -NoProfile -File "{1}" -PortUri "%1" -ManifestPath "{2}"' -f $powerShell,$handler,$manifest)
if ($PSCmdlet.ShouldProcess($root, 'Install SDPN port scheme handler')) {
    New-Item -Path $root -Force | Out-Null
    Set-Item -LiteralPath $root -Value 'URL:Strata Data Port Network PORT'
    New-ItemProperty -Path $root -Name 'URL Protocol' -PropertyType String -Value '' -Force | Out-Null
    New-ItemProperty -Path $root -Name 'SDPNOwner' -PropertyType String -Value $ownerMarker -Force | Out-Null
    $commandPath = Join-Path $root 'shell\open\command'
    New-Item -Path $commandPath -Force | Out-Null
    Set-Item -LiteralPath $commandPath -Value $launch
    Write-Output 'Registered port:// for this Windows user. It resolves signed name records only.'
    Write-Output ('Manifest: ' + $manifest)
}
