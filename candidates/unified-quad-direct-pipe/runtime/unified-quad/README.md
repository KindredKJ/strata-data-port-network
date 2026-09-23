# Kindred Unified Quad Runtime

This directory is the single canonical local runtime boundary for Brainstem,
Kindred Cloud, Emit Core, and RetroBank. Kindred Chain is adjacent and is not a
fifth runtime component. The current executable slice is the governed agent
protocol gateway and Living Companion identity adapter.

## Implemented behavior

- Strict v1 agent identity, capability, authority-grant, message-envelope, and
  acceptance-receipt contracts.
- Stable conversion of an adopted companion aggregate into an owner-bound
  Living Companion principal.
- Sanctuary registration, offline-health and suspension propagation, sanitized
  runtime status, and rebuild from durable companion aggregates.
- Strict companion communication payloads admitted to Brainstem only with an
  active chat-consent receipt and a temporary proposal-only grant that is
  removed before control returns to Sanctuary.
- A strict Brainstem decision receipt that approves only the existing
  deterministic local acknowledgement and denies provider, memory, tool,
  settlement, founder-authority, and external-effect escalation.
- Strict confidential companion-memory proposals require the active memory
  consent receipt, the principal's sole namespace, the expected memory version,
  and a temporary proposal-only grant. A separate Brainstem receipt may
  authorize only an unverified local user-memory append; the protocol performs
  no mutation and the temporary authority is removed synchronously.
- Strict capability-discovery query and result contracts backed by a bounded,
  deterministic local catalog. Discovery requires an active capability-free
  grant inside an ephemeral gateway and returns metadata only; the caller's
  replay tombstone is retained, but temporary authority is not.
- Strict revocation notice and receipt contracts applied only through an
  authenticated Brainstem self-route. The atomic path validates before
  mutation, retains replay and revocation evidence, preserves identity/grant
  records, cascades through dependent grants, and immediately blocks admission.
- Deny-by-default lifecycle, capability, authority, data-classification,
  budget, authentication-reference, and delegation checks.
- Sender-and-nonce replay protection with expiration and bounded capacity.
- Authenticated component routing for Brainstem execution requests to Kindred
  Cloud and mandate-referenced settlement requests to RetroBank.
- Rejection of direct agent execution, direct agent settlement, secret-bearing
  payloads, oversized/deep payloads, stale messages, and future messages.

Run the deterministic local suite from this directory:

```powershell
npm test
```

## Safety and limitations

The package performs no external calls, tool execution, memory mutation,
balance mutation, chain operation, credential lookup, or production action.
Authentication values remain outside the protocol; only opaque references are
accepted. Component authentication references must be explicitly injected by
the embedding local process.

The gateway, Brainstem acknowledgement policy, and Sanctuary projection are E3
candidates after reproducible tests. It is not yet the full sovereign cycle:
Brainstem does not generate a substantive companion response or authorize any
provider, tool, or settlement action. Its only memory authorization is the
bounded user-provided, unverified local append; Sanctuary remains the commit
adapter and preserves durable rollback. Cloud, Emit Core, and RetroBank
execution adapters are not connected; replay and decision evidence are not
crash-persistent; the runtime projection has no independent persistence or
multi-process concurrency; and specialized payload contracts for the other
enumerated message types remain. The discovery catalog is process-local and is
not a federated service registry. Revocation state is not synchronized across
runtime processes.

Rollback is a code rollback: stop using this unactivated local package and
revert its narrow commit. It has no database migration, installed-browser
change, external side effect, or production state to undo.
