# Kindred Labs Superstructure

Private founder-controlled monorepo for the Kindred Labs Superstructure.

## Mission

Advance human capability by creating AI systems that unify intelligence,
infrastructure, and real-world execution.

## Kindred One operating model

Kindred One is a **B2B enablement and infrastructure platform** for businesses,
institutions, platforms, enterprises, agencies, operators, developers, service
providers, and partner organizations. Organizations—not individual end users—
are the principal commercial and tenant context. Partners control their customer
relationships, downstream experiences, disclosures, branding, configuration,
and authorized data. Kindred Labs supplies governed infrastructure, APIs, SDK
contracts, orchestration, identity integration, policy, evidence, G3T Connected
communications, and RetroBank financial controls.

G3T Connected is the Kindred communications provider of record. Carriers and
networks are subordinate transport rails; rail acceptance is never represented
as delivery, recipient acknowledgement, reconciliation, or external verification.

## North Stars

1. Outcome Compression
2. Human-AI Progression
3. Capability Preservation
4. Evidence-Governed Engineering
5. Graceful Degradation and Recovery

## Kindred OS Preservation Model

Kindred OS is preserved in three explicit tracks:

1. hosted runtime and governance layer;
2. bootable distribution work;
3. custom kernel research, including the existing 32-bit x86 protected-mode prototype.

Kindred BIOS and KindredVM remain adjacent boot and virtualization systems.
No hosted application layer may be falsely represented as a complete replacement kernel.

## Current State

This repository is the architecture and integration control plane for
the canonical **Protocol → Tesseract → Unified Quad Runtime → Modular Core**
sequence. It includes versioned contract artifacts, executable architecture
policy checks, fail-closed production boundaries, durable protected state, and
evidence tooling. Deterministic providers exist only under `tests/fixtures/`;
the production package exposes no simulation composition path. Production
startup requires durable persistence, managed signing, authenticated transport,
real external-port adapters, and authenticated identities.

Remote repositories and live providers have not been verified in this checkout.
The implementations therefore establish E1 artifacts and, when locally tested,
E2 execution only—not production readiness or external outcomes. Unavailable
providers are reported as blocked and are never replaced by product simulations.

```bash
python -m pip install -e . pytest
python scripts/generate_contracts.py --check
pytest -q
bash scripts/validate-world.sh
```

## Public Status

Private. Not approved for public release.
