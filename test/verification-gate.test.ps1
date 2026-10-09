$ErrorActionPreference = 'Stop'
$validator = Join-Path $PSScriptRoot '../scripts/Assert-SW06FVerification.ps1'
$hash = 'a' * 64
$good = @{ receipt_mac_valid = $true; canonical_lineage_valid = $true; encrypted_on_wire = $true; state_hash = $hash; two_host_network_proof_satisfied = $true }
& $validator -Verified $good -ExpectedStateHash $hash
foreach ($field in @('receipt_mac_valid', 'canonical_lineage_valid', 'encrypted_on_wire', 'two_host_network_proof_satisfied')) {
  $bad = $good.Clone(); $bad[$field] = $false
  $rejected = $false
  try { & $validator -Verified $bad -ExpectedStateHash $hash } catch { $rejected = $true }
  if (-not $rejected) { throw "False $field was accepted" }
  $bad = $good.Clone(); $bad[$field] = 'true'
  $rejected = $false
  try { & $validator -Verified $bad -ExpectedStateHash $hash } catch { $rejected = $true }
  if (-not $rejected) { throw "String $field was accepted" }
}
$bad = $good.Clone(); $bad.state_hash = 'b' * 64
$rejected = $false
try { & $validator -Verified $bad -ExpectedStateHash $hash } catch { $rejected = $true }
if (-not $rejected) { throw 'Hash mismatch accepted' }
$loopback = $good.Clone(); $loopback.two_host_network_proof_satisfied = $false
& $validator -Verified $loopback -ExpectedStateHash $hash -AllowLoopbackEvidence
'SW06F_VERIFICATION_GATE_PASS'
