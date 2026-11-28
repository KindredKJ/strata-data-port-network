# SDPN Agentic SuperShell — Universal Core + Private Founder Library
**Engineering decision · 2026-11-27 · Kindred Labs**

## Product decision
**One universal SDPN Agentic SuperShell for everyone** on Windows and Linux, with an optional, separately distributed **Kindred Founder Library**. Do **not** ship a founder-only terminal build. The public command surface and agent economy must remain usable with no Kindred institutional login, while authenticated users can use their own delegated roles and third-party/private enterprise extensions.

The existing native terminal at `apps/native-terminal/` provides the initial general-purpose foundation. Its signed offline package manager, native cognition adapter, and SW06-F transport remain unchanged. The private Founder Library is an **additional package**, not a replacement, fork, automatic root mode, or publicly accessible lab backend.

## Architectural layers
1. **Public SuperShell core.** Standard terminal operations, shell interoperability, PTY/ConPTY after implementation, local polyglot programs, SDPN native transport, packages, personal AI and ordinary authorized agents.
2. **Reusable SDPN Access substrate.** First-party authentication, portable device-bound sessions, a signed capability-entitlement contract, scoped delegation, revocation, and a verified extension package loader. Make this generally available to any SDPN user or organization; do not hardcode a named founder in the universal binary.
3. **Kindred Founder Library (private).** Separately signed package, private source/release artifacts, institutional roles, founder workflows, company dashboards, permitted administrative actions, BRAINSTEM coordination, and properly authorized financial visibility. Never commit institutional credentials or private operational internals to the public terminal repo.
4. **Institutional authority services (private).** First-party SDPN identity and BRAINSTEM authorization, organization registry, revocation, audit and service-side enforcement; company-specific bank/payment/treasury adapters run solely under the legally and technically authorized company context. Neither package possession nor a terminal label gives authority.

## Authentication and installation protocol
**Design target (not implemented by this decision):**

```text
sdpn auth login                    # General first-party SDPN identity sign-in
sdpn auth whoami                   # Verified identity / tenant / active grants
sdpn pkg search kindred.founder    # Private package discoverable only if entitled
sdpn pkg install kindred.founder   # Signed package download + authorization
sdpn founder status                # Loaded only if valid founder entitlement
sdpn auth logout                   # End current session
```

An existing `pkg install <bundle-directory>` command installs **locally trusted signed offline packages**. It does **not** yet perform account login, private registry retrieval, founder-role verification or role-gated service calls. Do not portray the above target commands as operational until each command is implemented and tested.

### Founder recognition without identity spoofing
- Founder identity must be bound to a real institutional subject ID and institutional tenant record, **not** a person's typed name, email address, local OS username, self-assigned JSON role, or a self-signed package.
- Login should use SDPN-controlled identity services with phishing-resistant **passkeys/WebAuthn where supported**, plus a recoverable, institution-controlled credential-recovery process. A local-only fallback can prove possession of a registered hardware/device-bound key, but cannot unilaterally confer institutional founder status.
- The institutional issuer signs a short-lived, audience-bound entitlement with `subject_id`, `tenant_id`, `device_binding`, `roles`, `capabilities`, `issued_at`, `expires_at`, `grant_id`, `key_id`, `session_id` and a revocation reference. The actual contract must specify canonical signing bytes, maximum bounds, version negotiation and key rotation.
- The public terminal validates an entitlement for user experience, but **the private service repeats authorization for every privileged operation**, checking active session, current role, concrete company ownership/delegation, expiry, scope, tenant, budgets and revocation. Never trust a local `founder=true` setting.
- A signed private package may be cached offline; offline operation is limited to capabilities that can be safely authorized offline with scoped, expiring grants. Operations requiring live corporate/financial authorization cannot be silently executed offline.
- Store access credentials in OS-protected credential storage where available; keep secrets out of shell history, telemetry, process arguments, package manifests and public git. Rotate and revoke sessions/devices.
- All founder-grade actions produce tenant-bound, tamper-evident action receipts with actor, policy decision, capability, target resource and result; distinct people/agents never inherit the founder session automatically.

## Package/extension contract
Add an additive versioned `kindred.sdpn.extension.v1` manifest alongside the existing `kindred.sdpn.package.v1` signing model. Define package name/version, publisher identity, entrypoint, supported OS/architecture, required SDPN protocol version, declared requested capabilities, grant audience, module hashes, and package provenance. Signature verification and user trust are **necessary but not sufficient** for role privileges. The private Founder Library must additionally require current institutional entitlement; no package should embed founder credentials.

This access substrate should support other organizations with their **own** private libraries and role grants, without turning the Kindred founder designation into a globally special OS privilege.

## User experience
On fresh install the terminal should work immediately as a normal terminal with no login requirement. When logged in as an ordinary user, provide their own projects, agents, packages and capabilities, never founder-only features. When logged in as the verified Kindred institutional founder, show a discreet `Founder workspace` with permitted company controls. Lock/expire only privileged sessions; never interrupt unrelated public shell functionality.

## Build/acceptance gates
1. Public Windows/Linux terminal works with no account or founder package; legacy commands and SDPN tests still pass.
2. Authentic private signed package installs only through a first-party authorized download or explicit offline bundle; tampering, wrong issuer, wrong tenant, expired grant, revoked grant and package spoofing are rejected.
3. Incorrect password/passkey, name-only impersonation, copied local grant, offline replay and device mismatch cannot unlock service-side founder operations.
4. Role changes, account/session revocation and timeouts take effect server-side; no 'founder' user interface claim implies underlying authorization if services are unavailable.
5. Every privileged action is authorization-checked and receipts are independently inspectable; bank/treasury actions still require permissions supported by the owning legal entity and institution.
6. Test on Windows and Linux, add recovery, accessibility and disaster-recovery procedures; no regression in transport qualification, which has its own independent readiness gates.

## Implementation order
**P0:** Public SDPN authentication/grant schema and service-side verifier; private institution role enrollment and revocation. **P1:** Authenticated private package registry and `sdpn auth` command flow, signed extension execution. **P2:** Private Kindred Founder Library with permitted BRAINSTEM/company dashboards and audit. **P3:** Hardware-backed credentials, cross-device recovery, end-to-end Windows/Linux tests and signed releases.

**Current status:** This is a binding engineering design/implementation plan recorded on PR #64's development branch, **not** a claim that authenticated founder login, the private founder library or new private identity servers have been deployed. The separately tracked SDPN global network transport readiness score is unchanged.
