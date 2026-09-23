# Production simulation-route audit

Status: locally executed code and configuration audit; not an external review.

## Removed from product code

- `src/kindred_superstructure/domains.py`: deleted because it returned synthetic
  communications, settlement, and WATT outcomes.
- `KindredRuntime.for_test()`: deleted so the production package exposes no
  fixture composition entrypoint.
- Production runtime inference of simulated truth: deleted; callers must supply
  an explicit evidence-qualified truth class; there is no production default.
- Callback-based production external ports were replaced with a credential-bound
  `ProviderAdapter` contract. Adapter readiness must carry an adapter identity,
  evidence reference or exact blocker, and provider responses remain
  `provider-reported` until a separate reconciliation authority verifies them.

## Retained outside production routes

- `TruthClass.SIMULATED` remains a required evidence classification so imported
  historical or provider data cannot be silently promoted.
- Deterministic handlers and in-memory transport are confined to
  `tests/fixtures/runtime.py` for replay, failure, and malformed-input tests.
- The in-memory transport implementation moved to `tests/fixtures/transport.py`;
  the product package exposes only an abstract production transport contract and
  runtime construction requires its explicit `production_ready` assurance.

## Blocked real effects

Communications delivery, external financial settlement, and physical WATT
execution have no authorized provider adapters in this checkout. Production
startup fails closed rather than substituting fixtures. Their exact blockers are
maintained in `evidence/regulatory-readiness/production-blockers.json`.

The active `AGENTS.md` and historical directive surface were also corrected so
they no longer authorize synthetic product-operation behavior.
