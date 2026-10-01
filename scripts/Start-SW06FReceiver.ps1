param(
  [int]$Port = 47900,
  [string]$HostAddress = "0.0.0.0",
  [string]$PairingSecret = "",
  [switch]$NoFirewall
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node 22 or newer before running SW06-F."
}

$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 22) {
  throw "SW06-F requires Node 22 or newer. Found Node $nodeMajor."
}

if ([string]::IsNullOrWhiteSpace($PairingSecret)) {
  $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  $PairingSecret = [Convert]::ToBase64String($bytes).TrimEnd("=")
}

$env:KINDRED_SDPN_PROOF_SECRET = $PairingSecret
$ruleName = "Kindred SDPN SW06-F $Port"
$firewallCreated = $false

try {
  $addresses = @(
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -ne "127.0.0.1" -and
        $_.AddressState -eq "Preferred"
      } |
      Select-Object -ExpandProperty IPAddress -Unique
  )

  Write-Host ""
  Write-Host "KINDRED SDPN SW06-F RECEIVER"
  Write-Host "Port: $Port"
  Write-Host "Cipher: AES-256-GCM"
  Write-Host "LAN IPv4: $($addresses -join ', ')"
  Write-Host "One-time pairing secret: $PairingSecret"
  Write-Host "Keep this secret only for this proof session."
  Write-Host ""

  if (-not $NoFirewall) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private -RemoteAddress LocalSubnet | Out-Null
      $firewallCreated = $true
      Write-Host "Temporary firewall rule created for Private/LocalSubnet only."
    } else {
      Write-Warning "Not elevated; no firewall rule was created. Windows may prompt or block the inbound connection."
    }
  }

  & node "$PSScriptRoot/two-machine-receiver.mjs" --host $HostAddress --port $Port
}
finally {
  if ($firewallCreated) {
    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  }
  Remove-Item Env:KINDRED_SDPN_PROOF_SECRET -ErrorAction SilentlyContinue
}
