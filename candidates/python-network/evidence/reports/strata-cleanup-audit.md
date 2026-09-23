# Strata cleanup audit

Status: E2 local code/configuration audit; not external validation.

| Classification | Path/finding | Previous behavior | Replacement and validation |
|---|---|---|---|
| production defect replaced | `src/kindred_superstructure/domains.py` | synthetic communications, economy, and WATT outcomes | removed; production-route audit passes |
| production defect replaced | product-side fixture runtime and in-memory dispatcher | could compose deterministic handlers beside production code | moved exclusively to `tests/fixtures`; AST audit forbids product imports |
| production defect replaced | unlinked Strata lifecycle failure event | every event used no predecessor | per-transaction sequence/hash chain plus projection divergence verification |
| production defect replaced | blocked-only directory path | stopped before external-port lifecycle | shared route engine, signed receipts, controlled destination failure, Emit Core fail-closed interface |
| production defect replaced | no deployable authenticated dispatcher | test dispatcher was the only executable transport | HTTPS/mTLS dispatcher implemented; missing certificates fail closed |
| obsolete documentation replaced | simulation-first active directive | authorized synthetic product behavior | supersession record and real-only `AGENTS.md` |
| valid retained test support | `tests/fixtures/` | deterministic negative/resilience behavior | retained only under test namespace; never production functionality |
| valid truth classification | `simulated` enum/schema values | labels historical or test evidence | retained to prevent truth promotion; not a production route |

Current registries identify G3T Connected as provider of record, rails as
subordinate, Kindred One as B2B, RetroBank as financial authority, and WATT-BLOCK
as record-only. Economy, WATT, Emit Core, and live G3T repositories/connections
remain blocked by unavailable authenticated access; no substitute success exists.
