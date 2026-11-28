# SDPN Native Terminal — executable foundation v0.1.0

**Creator and publisher:** Kindred Labs — Kindred Jermaine Cox.

## What is implemented and testable

The terminal is a **native Go executable** for Windows and Linux (no hosted provider, Go runtime, Node or Python required to run the binary). The source uses Go's standard library and imports no third-party runtime libraries.

| Area | Available v0.1.0 | Acceptance not yet established |
|---|---|---|
| Native shell | Interactive REPL, `cd`, `pwd`, `ls`, `cat`, `echo`, `hash`, `history`, `clear`, direct executable launch, explicit OS-shell pass-through (`!`) | Dedicated PTY/ConPTY process orchestration, rich keyboard editing, full VT emulator, completions, split panes, GUI terminal |
| Polyglot | `run <file>` dispatch to **installed** Python, Node JS/TS, Go, Ruby, PHP, sh, PowerShell, Java, Swift, Lua, R, Perl; `doctor` toolchain discovery | Self-owned compiler/runtime for every language; Python wheels still require Python for import, and languages need OS-installed runtimes |
| SDPN transport | First-party pure-Go SW06-F v2 authenticated AES-256-GCM receiver/sender, challenge, HKDF-SHA256, SHA-256, HMAC receipt verification, bounded payload and private IPv4 restrictions | Independent physical peer, official Node/Go interop, reliable restart after in-flight failure, production Port Zero/consent binding |
| First-party cognition | Offline deterministic diagnostics; local-only `POST /v1/cognition`; Node client and Python SDK; no outside-provider API keys or network call required | **Neural inference not implemented in this module**. Auxiliary native cognitive runtime, model artifact, weights, tokenization and accelerator runtime must be integrated and benchmarked, not assumed |
| Packaging | Linux x86-64 and Windows x86-64 compiled binaries; pure-Python `kindred-sdpn` wheel built with stdlib; no pip dependencies | Signed MSI/MSIX, RPM/DEB, updates, ARM64 builds, notarized binaries, package registry with signed manifests |
| Security | Loopback-only cognition, redirects blocked, cryptographic proof verification, private-IP receiver policy, bounded payloads, no shell command invocation unless explicitly requested | Production sandboxing, per-command approvals, local capability-grants, audit ledger, full SBOM/release signing |

## Run

Linux:

```bash
chmod +x ./sdpn-terminal-linux-amd64
./sdpn-terminal-linux-amd64 repl
./sdpn-terminal-linux-amd64 sdpn status
./sdpn-terminal-linux-amd64 doctor
./sdpn-terminal-linux-amd64 ai diagnose 'connection refused'
```

Windows PowerShell:

```powershell
.\sdpn-terminal-windows-amd64.exe repl
.\sdpn-terminal-windows-amd64.exe sdpn status
.\sdpn-terminal-windows-amd64.exe doctor
```

Build from source (Go >= 1.23 for compatibility; **use the latest patched Go 1.27.x toolchain for release binaries**):

```bash
cd apps/native-terminal
go test -race ./...   # Linux / other race-supported toolchains
go vet ./...
go build -trimpath -o sdpn-terminal .
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o sdpn-terminal.exe .
```

## Compatible SDPN SW06-F encrypted payload transfer

On receiver device, keep the proof secret **private** and use an approved loopback or RFC1918 LAN interface. On Linux/macOS/Termux shell:

```bash
export KINDRED_SDPN_PROOF_SECRET="$(openssl rand -hex 32)"
./sdpn-terminal-linux-amd64 proof receive 127.0.0.1 47900
```

On sender (same ephemeral secret securely provisioned out-of-band, do **not** paste it into chat):

```bash
./sdpn-terminal-linux-amd64 proof send 127.0.0.1 ./payload.txt 47900
```

Proof status is explicitly scoped: even a successful `twoHostNetworkProofSatisfied` software flag **never attests separate physical machines**. For two-device qualification follow `docs/SW06-F-PHYSICAL-HOST-BENCHMARK.md` and issue #22, including a physical-machine operator review. Keep ports private; never forward the proof listener to the public Internet.

To verify a stored SW06-F JSON receipt with its original ephemeral session secret set in the process environment:

```bash
./sdpn-terminal-linux-amd64 sdpn verify ./receipt.json
```

## SDPN first-party cognition across components

Local terminal server:

```bash
./sdpn-terminal-linux-amd64 cognition serve 127.0.0.1 18281
```

For a sensitive local deployment set `SDPN_AI_LOCAL_TOKEN` before server startup and on clients. The endpoint responds with `schema=kindred.sdpn.cognition.v1`, `engine=offline-rules`, and `generative=false`. This **is not an LLM**.

The existing SDPN Node services can import:

```js
import { requestNativeCognition } from "./src/native-cognition-client.mjs";
const result = await requestNativeCognition({ input: "diagnose transport timeout" });
```

Python SDK (wheel included):

```python
from kindred_sdpn import verify_receipt, ask_local, native_status
status = native_status("./sdpn-terminal-linux-amd64")
# ask_local("diagnose transport timeout") requires the local server above.
```

All adapter endpoints must be literal loopback addresses. The native cognition port can subsequently be backed by Kindred Labs' **existing proprietary Auxiliary native inference implementation**, if and only if such a verified runtime is attached. Connection requires a first-party adapter with explicit capability identity, local authentication, resource budgets, per-tenant state and request/response receipts. No external inference provider is part of the mandatory path. No representation is made that Auxiliary model inference is implemented by this code.

## Integration boundaries — do not replace working infrastructure

This additive application lives under `apps/native-terminal/`. It must **not** replace or rewrite `src/two-machine-proof.mjs`, Port Zero identities, SDPN transport, portal, native session semantics, SW06-F benchmarks or agent-economy signed offers. The new Node adapter is opt-in, exposes only the local protocol, and has no authority to perform filesystem, financial or remote actions.

## Toolchain provenance

These candidate binaries were cross-compiled with Go 1.23.2, the compiler available in the local isolated build environment. As of November 2026, Go 1.27 is the current stable release. Rebuild and retest with an up-to-date patched Go 1.27 toolchain before public release, then sign binaries and publish immutable digests. Windows ARM64, Linux ARM64 and Android ARM64 artifacts are **cross-builds only**, not device acceptance.

## Graduation roadmap, ranked by developer value

1. **PTY and ConPTY:** native pseudo terminals on Linux and Windows with resize, UTF-8, ANSI/VT, scrollback, search, autocomplete and error rendering; independent OS interactive-app tests.
2. **Existing identity/agent capability bridge:** bind native command sessions to Kindred Port Zero consent, mutually authenticated agent identity and a durable local audit trail. Preserve company/tenant boundaries.
3. **Auxiliary native inference:** ship first-party weights and native CPU/GPU inference binaries with tokenizer and evaluation suite; implement memory/recall-before-inference and authorized tool execution. The local protocol is the adapter surface, not a model.
4. **Language and package substrates:** signed offline package registry, wheel creation and verification, optional private registry mirror, runtimes/toolchains for Python, JS/TS, Go, Rust, C/C++, Java and additional languages. No claim of own compiler for languages not yet implemented.
5. **Native transport and economy tools:** Port administration, identity, direct device pairing, files, service discovery, signed offers, authorized execution, receipts and settlement through existing approved interfaces; no bypass of current controls.
6. **High-assurance release:** reproducible signed binaries, security policies, test isolation, user documentation, Linux deb/rpm, Windows MSIX, ARM64, updater, encrypted native profiles and telemetry-instrumented benchmarks.

**Readiness impact:** This code is a new native terminal candidate. Its local unit tests and cross-builds do **not** elevate any of the four global SDPN network launch gates without the corresponding independent-device, recovery, sustained-performance and traversal evidence. Founder global GO/NO-GO remains pending.
