# Strata Data Port network threat model

| Surface | Primary threats | Required controls |
|---|---|---|
| Port Zero | forged identity, excess delegation, disclosure leak | managed signing, tenant entitlement, classification, selective disclosure, durable audit |
| External ports | bypass, authority escalation, replay | Port Zero authentication, bounded capability, signature, nonce, sequence, idempotency |
| Directory | rogue registration, downgrade, unhealthy route | authority evidence, version negotiation, maintenance/readiness/health gates |
| Direct/split/multicast | target confusion, segment disclosure, partial failure | explicit route targets, per-target policy, independent receipts, aggregate reconciliation |
| Tenant isolation | cross-tenant read/write or key reuse | organization+tenant indexes, scoped queries, per-tenant key interface and evidence owner |
| Transport rails | acceptance promoted to completion | independent rail/provider/destination/reconciliation/truth dimensions |
| Evidence/recovery | history rewrite, replay after restart | append-only hash links, durable nonce/idempotency, integrity check, backup/restore |

Residual blockers include managed keys, mTLS identities, real queue/HTTP
adapters, authoritative subsystem repositories, and independent penetration and
recovery validation.
