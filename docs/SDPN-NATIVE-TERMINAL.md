# SDPN Native Terminal — executable foundation v0.1.0

**Creator and publisher:** Kindred Labs — Kindred Jermaine Cox.

## What is implemented and testable

The terminal is a **native Go executable** for Windows and Linux (no hosted provider, Go runtime, Node or Python required to run the binary). The source uses Go's standard library and imports no third-party runtime libraries.

| Area | Available v0.1.0 | Acceptance not yet established |
|---|---|---|
| Native shell | Interactive REPL, `cd`, `pwd`, `ls`, `cat`, `echo`, `hash`, `history`, `clear`, direct executable launch, explicit OS-shell pass-through (`!`) | Dedicated PTY/ConPTY process orchestration, rich keyboard editing, full VT emulator, completions, split panes, GUI terminal |
| Polyglot | `run <file>` dispatch to **installed** Python, Node JS/TS, Go, Ruby, PHP, sh, PowerShell, Java, Swift, Lua, R, Perl; `doctor` toolchain discovery | Self-owned compiler/runtime for every language; Python wheels still require Python for import, and languages need OS-installed runtimes |
| SDPN transport | First-party pure-Go SW06-F v2 authenticated AES-256-GCM receiver/sender, challenge, HKDF-SHA256, SHA-256, HMAC receipt verification, bounded payload and private IPv4 restrictions | Independent physical peer, official Node/Go interop, reliable restart after in-flight failure, production Port Zero/consent binding |
| First-party cognition | Offline diagnostics, local-only `POST /v1/cognition`, Node/Python adapters, **local-only streaming bridge to existing first-party NTSA-X recurrent model server** | Validated local checkpoint startup and inference quality, native model weights/inference kernels in this executable, GPU/accelerator packaging and production auth |
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

## SDPN's own signed offline package system

The terminal has a first-party package format `kindred.sdpn.package.v1` that verifies every file SHA-256, an Ed25519 publisher signature and an **explicitly locally trusted** publisher key before installation. There is no network download or external package registry requirement. It rejects traversals, symlinks, oversized bundles, duplicate version overwrites and private signing keys inside bundles; it installs into a local user-owned package directory. Executing a package remains an explicit user command and uses the same OS privileges as the invoking user. This is a developer package manager, not a sandbox for untrusted code.

1. Place a `sdpn-package.json` in the bundle directory with `schema`, `name`, `version`, and `entry` fields. The `sign` command discovers files and writes signed SHA-256 records.
2. Create keys **outside the bundle** using `sdpn-terminal pkg keygen <keydir>`; keep the generated `publisher.key` file private.
3. Sign the bundle with `sdpn-terminal pkg sign <bundle-dir> <keydir>/publisher.key`.
4. Explicitly trust the publisher with `sdpn-terminal pkg trust <keydir>/publisher.pub`.
5. Run `sdpn-terminal pkg verify <bundle-dir>`, `sdpn-terminal pkg install <bundle-dir>`, `sdpn-terminal pkg list` and `sdpn-terminal pkg exec <name> <version> [args]`.

### Example minimal `sdpn-package.json`

```json
{
  "schema": "kindred.sdpn.package.v1",
  "name": "hello-tool",
  "version": "1.0.0",
  "entry": "bin/hello.sh"
}
```

Only installed or trusted local runtimes execute language-specific source. A `.whl` is a Python distribution for an installed local Python environment; it is not a native replacement for Python. This first-party manager will later expand to a signed SDPN package registry, toolchains, reproducible builds and authenticated Port Zero grants.

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

### First-party NTSA-X recurrent-model bridge (implemented adapter; actual model requires checkpoint)

The existing [KindredKJ/NTSA-X native COG-FU server](https://github.com/KindredKJ/NTSA-X/blob/main/ntsa_x/cog_fu_server.py) implements a first-party, locally bound streaming chat endpoint. This terminal now supports its native SSE contract directly: bounded `stream=true` requests, model ID, no redirects, literal loopback address only, streaming output with explicit `[DONE]` and a size limit. When the model is actually responding, the SDPN response is accurately marked `engine=ntsa-x-native`, `generative=true`. No external AI API is used. This is a bridge to Kindred's own native model, not a claim that its PyTorch/CPU/CUDA runtime or model weights have been ported into the Go binary.

In the authorized local NTSA-X checkout, with an **existing trained checkpoint**, launch (requires local Python and PyTorch):

```bash
python -m ntsa_x.cog_fu_server --checkpoint /absolute/path/to/actual-checkpoint.pt --port 8081 --decoder unified
```

In the shell launching the SDPN native cognition gateway:

```bash
export SDPN_NATIVE_MODEL_ENDPOINT=http://127.0.0.1:8081/v1/chat/completions
export SDPN_NATIVE_MODEL_ID=ntsa-cog-fu-v1
export SDPN_NATIVE_MODEL_MAX_TOKENS=64
./sdpn-terminal-linux-amd64 cognition serve 127.0.0.1 18281
```

From a separate native terminal process:

```bash
export SDPN_AI_ENDPOINT=http://127.0.0.1:18281/v1/cognition
./sdpn-terminal-linux-amd64 ai ask 'Explain the failing SW06-F receipt'
```

Never invent a checkpoint filename or assert model availability based on source alone. The server's SSE output is currently treated as generated, **not verified scientific or operational evidence**; actual checkpoint quality and performance need separate tests. The local gateway returns `503` rather than silently claiming generative inference when a configured native model is unavailable. This adapter is additive and keeps model files outside the public SDPN repository.

All adapter endpoints must be literal loopback addresses. The native cognition port can also be backed by Kindred Labs' **existing proprietary Auxiliary native inference implementation**, if and only if such a verified runtime is attached. Connection requires a first-party adapter with explicit capability identity, local authentication, resource budgets, per-tenant state and request/response receipts. No external inference provider is part of the mandatory path. No representation is made that Auxiliary model inference is implemented by this code.

## Integration boundaries — do not replace working infrastructure

This additive application lives under `apps/native-terminal/`. It must **not** replace or rewrite `src/two-machine-proof.mjs`, Port Zero identities, SDPN transport, portal, native session semantics, SW06-F benchmarks or agent-economy signed offers. The new Node adapter is opt-in, exposes only the local protocol, and has no authority to perform filesystem, financial or remote actions.

## Toolchain provenance

These candidate binaries were cross-compiled with Go 1.23.2, the compiler available in the local isolated build environment. As of November 2026, Go 1.27 is the current stable release. Rebuild and retest with an up-to-date patched Go 1.27 toolchain before public release, then sign binaries and publish immutable digests. Windows ARM64, Linux ARM64 and Android ARM64 artifacts are **cross-builds only**, not device acceptance.

## Graduation roadmap, ranked by developer value

1. **PTY and ConPTY:** native pseudo terminals on Linux and Windows with resize, UTF-8, ANSI/VT, scrollback, search, autocomplete and error rendering; independent OS interactive-app tests.
2. **Existing identity/agent capability bridge:** bind native command sessions to Kindred Port Zero consent, mutually authenticated agent identity and a durable local audit trail. Preserve company/tenant boundaries.
3. **Auxiliary native inference:** ship first-party weights and native CPU/GPU inference binaries with tokenizer and evaluation suite; implement memory/recall-before-inference and authorized tool execution. The local protocol is the adapter surface, not a model.
4. **Language and package substrates:** extend the implemented Ed25519-signed local package installer into a governed SDPN-native registry with revocation, deterministic package reproducibility, wheel creation and verification, and first-party runtimes/toolchains. No claim of own compiler for languages not yet implemented.
5. **Native transport and economy tools:** Port administration, identity, direct device pairing, files, service discovery, signed offers, authorized execution, receipts and settlement through existing approved interfaces; no bypass of current controls.
6. **High-assurance release:** reproducible signed binaries, security policies, test isolation, user documentation, Linux deb/rpm, Windows MSIX, ARM64, updater, encrypted native profiles and telemetry-instrumented benchmarks.

**Readiness impact:** This code is a new native terminal candidate. Its local unit tests and cross-builds do **not** elevate any of the four global SDPN network launch gates without the corresponding independent-device, recovery, sustained-performance and traversal evidence. Founder global GO/NO-GO remains pending.
