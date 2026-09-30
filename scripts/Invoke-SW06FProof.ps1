param(
  [Parameter(Mandatory = $true)]
  [string]$ReceiverIp,

  [Parameter(Mandatory = $true)]
  [string]$PairingSecret,

  [int]$Port = 47900,

  [string]$KindredBaseUrl = "http://127.0.0.1:8790",

  [string]$EvidenceDir = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node 22 or newer before running SW06-F."
}

if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
  $EvidenceDir = Join-Path (Get-Location) "evidence/sw06f"
}
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

$artifact = Invoke-RestMethod -Method Get -Uri "$KindredBaseUrl/v1/proof/export/current"
if ($artifact.schema_version -ne "kindred.physical-proof.artifact.v1") {
  throw "Kindred Root returned an unsupported proof artifact."
}

$payloadPath = Join-Path $EvidenceDir "kindred-state-$($artifact.generation).json"
$receiptPath = Join-Path $EvidenceDir "two-host-proof-$($artifact.generation).json"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($payloadPath, $artifact.canonical_payload, $utf8NoBom)

$env:KINDRED_SDPN_PROOF_SECRET = $PairingSecret
try {
  $senderArgs = @(
    "$PSScriptRoot/two-machine-sender.mjs",
    "--host", $ReceiverIp,
    "--port", "$Port",
    "--payload", $payloadPath,
    "--state-id", $artifact.state_id,
    "--state-hash", $artifact.state_hash,
    "--generation", "$($artifact.generation)",
    "--receipt", $receiptPath
  )
  & node @senderArgs

  if ($LASTEXITCODE -ne 0) {
    throw "SW06-F sender failed with exit code $LASTEXITCODE."
  }

  $receipt = Get-Content -Raw $receiptPath | ConvertFrom-Json
  $verifyBody = @{
    receipt = $receipt
    proof_secret = $PairingSecret
  } | ConvertTo-Json -Depth 12

  $verified = Invoke-RestMethod -Method Post -Uri "$KindredBaseUrl/v1/proof/verify" -ContentType "application/json" -Body $verifyBody

  Write-Host ""
  Write-Host "KINDRED SW06-F VERIFICATION"
  Write-Host "Receipt: $receiptPath"
  Write-Host "State hash: $($verified.state_hash)"
  Write-Host "MAC valid: $($verified.receipt_mac_valid)"
  Write-Host "Canonical lineage valid: $($verified.canonical_lineage_valid)"
  Write-Host "Encrypted on wire: $($verified.encrypted_on_wire)"
  Write-Host "Two-host network gate: $($verified.two_host_network_proof_satisfied)"
  Write-Host ""
  $verified | ConvertTo-Json -Depth 12
}
finally {
  Remove-Item Env:KINDRED_SDPN_PROOF_SECRET -ErrorAction SilentlyContinue
}
