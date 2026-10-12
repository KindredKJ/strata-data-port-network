# SDPN × StrataCast orchestration, versioning and CI

Prepared October 11, 2026. This is an **implementation candidate**, not a production network release.

## Independent ownership

SDPN retains the existing browser package, Port Zero authority responsibilities, Kindred State Port, Direct Pipe and two-host proof harness. StrataCast retains WorldKernel, Babylon/Unreal rendering, materialization and its separate release lifecycle. Neither project becomes a required host for the other.

## Versioned compatibility

- `contracts/compatibility-manifest.v1.json` explicitly pins the root, state port, two-host proof, orchestrator, topology bridge and StrataCast RenderFrame contracts.
- `src/compatibility-registry.mjs` rejects unknown, downgraded and major-incompatible schemas and checks internal dependency requirements.
- Additional protocols, SDKs and live render consumers need their own schema versions and independently tested migrations before release. Semver alone does not guarantee compatibility.

## Controls

- Injection of an authorized Port Zero policy provider and a real network adapter is required; neither is provided by CI's mock connector.
- Consent, identity, scopes, destination list, expiry and health are evaluated before dispatch.
- SHA-256 integrity metadata and a fsynced hash-linked journal track dispatch; indeterminate outcomes prohibit automatic retry to avoid duplicate effects.
- Failover is allowed only after a proven noncommitted refusal. No plaintext payload bytes or credentials are included in topology frames or audit journal.
- Read-only topology is projected into `stratacast.kindred/v1` render frames. Real graphical asset registration and an authenticated telemetry gateway are future separately released consumer integrations.

## Automated checks

The workflow triggers on pull requests, main pushes, daily schedule and manual dispatch, executes SDPN tests, collects source digests and records a local mock transport benchmark. There is no live deployment job. Runner admission and checks must pass before a merge decision.

## Production gaps

Real Port Zero identity signatures, mTLS transport and peer pins, server-side deduplication, distributed leases, remote recovery, encrypted backups with verified restore, live node health/observability, access revocation propagation, protected release approvals, verified render assets and physical two-host attestation remain unverified.

Commands: `npm test` and `node scripts/measure-orchestrator.mjs`.
