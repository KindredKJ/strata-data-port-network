# G3TCONNECTED provisioning candidate

This additive module is a **local state-machine candidate**, not a carrier integration, eSIM provisioning service, durable database, or independently verified production service.

## API
Import `SubscriberProvisioning` from `src/telecom/subscriber-provisioning.mjs`. Create a request with a subscriber ID, provider label and idempotency key; advance using version-checked transitions with evidence IDs. `audit()` returns hash-linked local records; `verifyAudit()` detects in-memory chain inconsistency. The records are not signed, persisted, or independently attested.

## Run
```sh
node --test test/telecom-subscriber-provisioning.test.mjs
```

## Production integration requirements
- Durable transactional persistence and uniqueness across processes, migrations and crash recovery
- Authenticated provider webhooks, signature verification, replay prevention, event reconciliation and retry policy
- Provider-specific API contracts, device capability checks, SM-DP+ activation and lifecycle status
- No service-verified transition without actual network evidence
- Billing, cancellation, privacy, consumer support, tax and FCC/Colorado legal review
- Real carrier credentials and written commercial authorization before live activation

This candidate does not interact with Open5GS, SDPN transport, external carriers or live devices.
