# Additive transport and browser qualification

Founder: Kindred Jermaine Cox / Kindred Labs.

SW06-F executed on two actual QEMU TCG Linux guests sharing one physical host.
Each guest has its own kernel instance, boot ID, hostname, MAC and private IP.
The network is a host-local socket link with no NAT or external uplink. Seven
encrypted 1 MiB transfers passed exact reconstruction and receipt-MAC validation;
a wrong pairing secret was rejected. Both guests independently emitted Ed25519
test-runner envelopes. The host verified every reciprocal signature and exact
receipt match. These ephemeral authorities are not founder keys.

This upgrades the SW06-F virtual-machine gate only. The original SW02 materializer
was not recovered or executed here. Physical-machine transport, mutual TLS,
adverse-network reliability, global/external reach, ZPS-backed materialization and
production authorization are not established by this run. Preserve historical
SW02 evidence and classification.

The receiver now offers an optional immutable receipt audit callback. Callback
failure rejects sender success, so a failed audit sink cannot silently issue a
successful transfer receipt.

INTERCONNECT's separate GTK/WebKitGTK proof provides an ephemeral profile,
mandatory subprocess sandbox, local receipt inspection, denied privileged browser
permissions and explicit session opt-in for public HTTPS navigation. The local
policy/parser tests pass. A new CI gate requires executed native DOM rendering
with the sandbox enabled; no sandbox bypass is permitted. No private Port Zero
authority, device sync, search service, agent execution or credentials are embedded.

Run the committed CI workflows to reproduce and retain packet captures, exact
receipts, native-render output and security-test evidence. Guest assets are pinned
by SHA-256; if upstream netboot artifacts change, the workflow must fail closed
until the hashes are deliberately updated and reviewed.
