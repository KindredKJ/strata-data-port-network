param(
  [Parameter(Mandatory = $true)][object]$Verified,
  [Parameter(Mandatory = $true)][string]$ExpectedStateHash,
  [switch]$AllowLoopbackEvidence
)
$ErrorActionPreference = "Stop"
if ($ExpectedStateHash -cnotmatch '^[0-9a-f]{64}$') { throw "Expected state hash is invalid." }
foreach ($field in @('receipt_mac_valid', 'canonical_lineage_valid', 'encrypted_on_wire')) {
  if ($Verified.$field -isnot [bool] -or $Verified.$field -ne $true) {
    throw "SW06-F verification rejected: $field must be true."
  }
}
if ($Verified.state_hash -cne $ExpectedStateHash) { throw "SW06-F verification state hash mismatch." }
if ($Verified.two_host_network_proof_satisfied -isnot [bool]) { throw "SW06-F network gate must be a boolean." }
if (-not $AllowLoopbackEvidence -and -not $Verified.two_host_network_proof_satisfied) {
  throw "SW06-F two-host network gate remains unproven. Use -AllowLoopbackEvidence only to retain scoped local evidence."
}
