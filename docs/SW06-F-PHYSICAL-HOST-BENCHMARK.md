# SW06-F Physical-Host Qualification: Throughput and Latency

**Kindred Labs — additive benchmark for the existing authenticated SW06-F protocol**

## Evidence boundary

This utility measures verified **application-layer goodput**: useful payload bytes divided by elapsed wall-clock time across challenge, AES-256-GCM encryption, TCP transfer, receipt generation, SHA-256 integrity verification, and receipt-MAC verification. It reports round-trip p50/p95 latency per size, plus the original HMAC-authenticated protocol receipts. These are not externally verifiable digital signatures.

It does **not** measure physical link capacity, bit error rate, internet-scale routing, unencrypted TCP throughput, physical zero-copy or memory bus bandwidth. Distinct software host fingerprints and non-loopback addresses do **not** establish separate physical computers: two virtual machines on one host can also qualify for a **software** two-host receipt. The physical machine attestation and physical separation verification fields are always false pending separately verified hardware evidence. Running the benchmark does not grant production authorization.

The existing proof protocol and control plane are unchanged. Never modify imported historical receipts as part of benchmarking.

## Prerequisites

- Two separate physical computers with Node.js 22+ and the same repository commit.
- Both devices on a trusted, isolated, private IPv4 LAN, with a firewall rule for TCP 47900 scoped to the test peer or local subnet.
- An **ephemeral 32+-character pairing secret**, shared out of band and never committed, pasted into chat, or included in evidence files.
- The receiver must be started on one computer, with the benchmark run from the second. Never port-forward the proof endpoint onto the public internet.

### Receiver: Windows / PowerShell 7

From the repository root:

~~~powershell
pwsh ./scripts/Start-SW06FReceiver.ps1 -Port 47900
~~~

The receiver prints its private LAN IPv4 address and a one-time secret. Transfer that secret privately to the sender. The Windows launcher creates and later removes a Private/LocalSubnet-only firewall rule when run elevated. Stop the listener after the test. On another supported platform, use the existing scripts/two-machine-receiver.mjs, setting KINDRED_SDPN_PROOF_SECRET in its environment and applying a scoped local firewall.

### SW06-G repeatability launcher (recommended)

On the **separate sender computer**, using the same repository revision as the receiver, run from the repository root:

~~~powershell
pwsh ./scripts/Invoke-SW06GQualification.ps1 -ReceiverIp (Read-Host 'Receiver private IPv4')
~~~

This script runs the existing Node test suite, verifies that the receiver TCP port is reachable, prompts for the short-lived pairing secret **without echoing typed characters**, and executes three independent benchmark runs. Every run measures 1/4/16 MiB encrypted transfers with 12 measured trials per size. The script verifies the existing software proof/claim boundaries and creates SHA-256-indexed, uniquely named JSON receipts and a manifest under \`.local-evidence/sw06g/\`. The directory is excluded from Git through the repository \`.gitignore\`.

Do not copy private raw manifests or receipts into public issues or pull requests: LAN IPs and software host fingerprints are preserved for operator review. A passing script result means **software two-host evidence only**. An operator still needs to independently confirm that the devices are physically separate, and compare against network baselines. Reverse the sender and receiver roles to measure the other direction.

### Sender: Windows / PowerShell 7

Run on the **other computer**, using the same Git commit:

~~~powershell
$receiverIpv4 = Read-Host 'Receiver private IPv4'
$env:KINDRED_SDPN_PROOF_SECRET = Read-Host 'One-time pairing secret'
try {
    New-Item -ItemType Directory -Force -Path './evidence/local' | Out-Null
    $report = './evidence/local/sw06f-physical-host-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json'
    node ./scripts/benchmark-two-host.mjs --host $receiverIpv4 --port 47900 --sizes-mib 1,4,16 --trials 12 --warmup 2 --timeout-ms 30000 --output $report
    if ($LASTEXITCODE -ne 0) { throw 'SW06-F physical-host benchmark failed; no valid report produced' }
}
finally {
    Remove-Item Env:KINDRED_SDPN_PROOF_SECRET -ErrorAction SilentlyContinue
}
~~~

For confidential entry in shared environments, use a secrets manager or secure prompt instead of ordinary Read-Host (which echoes typed characters). Do not expose the pairing secret or raw evidence in public pull requests.

The command enforces RFC1918/private addressing and rejects loopback by default. For local software-only smoke testing, --host 127.0.0.1 --allow-loopback is supported, but the report keeps physical-network proof fields false.

Report creation is exclusive and cannot overwrite previous evidence. Change the filename before rerunning. If a trial fails verification, execution stops and no success report is written.

## Measurements

Each size (1, 4, and 16 MiB by default) is sent sequentially, with two discarded warm-up trials and twelve measured trials. The sender uses synthetic test payloads. Each transfer has a unique state ID and generation. The SW06-F receiver checks the encrypted payload and returns an HMAC-authenticated receipt which the sender verifies. The report retains those receipts and the individual measured samples.

- **Application goodput (Mbps)** = 8 × total verified payload bytes / total measured seconds / 1,000,000.
- **Application goodput (MiB/s)** = total verified payload MiB / total measured seconds.
- **p50 and p95 round-trip time (ms)** = nearest-rank percentiles over measured trials, including challenge, transport, cryptography and receipt verification.

Network adapter speed, operating system scheduling, protocol overhead and CPU saturation can all affect results. Compare against iperf3 or an independent network baseline **between the same two devices**, with wired and wireless runs clearly labeled. Repeat multiple independent runs; packet loss and jitter require additional instrumentation.

## Graduation criteria (not automatically satisfied)

1. Obtain clean npm test results and pin the exact commit on both machines.
2. Document independently that the endpoints are truly two separate physical computers without disclosing sensitive identifiers publicly.
3. Run encrypted transfers in both directions and verify receipt integrity, incorrect-secret rejection, and replay resistance.
4. Publish reproducible goodput/latency summaries alongside hardware, OS, link characteristics and independent baselines.
5. Repeat under adverse loss, latency, interruption and reconnect; assess CPU/memory use and security.
6. Review Port Zero authorization, revocation, replay and durable audit policies before making a production or internet-scale claim.

The October 12, 2026 two-QEMU-guest run remains an important **one-host virtual-network proof**. The local Direct Pipe 16.49 Gbps equivalent remains an **in-memory copy** measurement. Neither substitutes for physical-host throughput measurements.
