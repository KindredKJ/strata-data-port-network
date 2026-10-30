# Kindred Agent Economy — Additive v1

**Source baseline:** `KindredKJ/strata-data-port-network` main at `6f688a05f72955e49502a8d28a83a0fbee7e7126`. The prior Python ports and Unified Quad JavaScript agent gateway remain unchanged. Historical evidence and a SHA-256 fingerprint of the user-supplied review are indexed at `lineage/agent-economy-20261030.json`. An archive digest is a preservation aid, **not evidence of invention priority**.

## What's implemented on this branch

- **Versioned port identity:** `contracts/port-agent.v1.schema.json`; SQLite WAL durable identity, owner/tenant/lineage, namespace, policy version.
- **Durable execution:** mailboxes with message deduplication, scoped memory, workflow checkpoints and fencing epochs. Events append to a hash-linked record. Scheduled event activation uses the host's worker scheduler; no continuously running model is needed for an idle port.
- **Brainstem economic authority:** a trusted Brainstem grant is translated via `brainstem-adapter.mjs` into a signed mandate; `agent_economy.py` checks HMAC, grant expiry/revocation and dollar/token ceilings in one database transaction. This is a **new bridge**, not a replacement for the existing in-memory gateway. Shared key belongs in a secrets manager, never in source or prompts.
- **x402 V2:** `x402_service.py` returns `PAYMENT-REQUIRED`, accepts `PAYMENT-SIGNATURE`, checks the exact signed requirements with an external facilitator, settles and records `PAYMENT-RESPONSE`. Base mainnet USDC only (`eip155:8453`, official USDC token contract), exact amount. It checks an independently queried Base receipt for network, successful transaction, transfer recipient/token/amount, and minimum confirmations.
- **Fiat provider adapters:** `stripe_rails.py` creates Stripe PaymentIntents, Stripe Tax calculations, refunds, Stripe Connect onboarding links, transfers, manual payouts to verified connected accounts, and HMAC-verified webhooks. Every provider action uses an idempotency key. Provider-state events are recorded separately from recognized revenue.
- **Accounting foundation:** balanced integer-minor-unit entries, separate asset denominations, refund and payout event evidence. This is not a licensed bank, custody provider, tax-filing service, payroll service, or USDC-to-USD off-ramp.

## Environments and operating instructions

Use Python 3.12+, a persistent filesystem, backups, full-disk encryption, and an HTTPS reverse proxy. A single SQLite writer host is supported. **Do not point multiple independent hosts at local SQLite files**; scale by migrating these tables and transactions to managed PostgreSQL with shared leases and event delivery before multi-host production.

Run verification (no live funds involved):

```bash
python -m compileall -q packages/agent-economy-v1
python -m unittest discover -s packages/agent-economy-v1 -p 'test_*.py' -v
```

Provision the seller identity and namespace with the exact, authorized values your environment uses. Database initialization is performed by `EconomyStore`. Ensure the caller is a trusted operator; `register_agent` and `grant` are internal interfaces, not public HTTP methods.

The following variables are required for the x402 paid resource:

| Name | Required value |
| --- | --- |
| `KINDRED_ECONOMY_DB` | absolute writable persistent SQLite path |
| `KINDRED_SELLER_TENANT` | registered tenant ID |
| `KINDRED_SELLER_AGENT` | registered seller agent ID |
| `KINDRED_MERCHANT_WALLET` | controlled Base merchant 0x address |
| `KINDRED_PUBLIC_ORIGIN` | deployed HTTPS origin matching the resource URL |
| `KINDRED_X402_FACILITATOR_URL` | trusted HTTPS facilitator base URL supporting `exact`, `eip155:8453`, v2 |
| `KINDRED_X402_FACILITATOR_TOKEN` | optional provider-issued authorization token, stored privately |
| `KINDRED_BASE_RPC_URL` | trusted independent Base mainnet HTTPS JSON-RPC endpoint |

Initialize `EconomyStore` and register the configured seller identity once. Then launch the application behind authenticated operator infrastructure and a production WSGI web server. The direct `python x402_service.py` mode listens on loopback for local integration, **not public production hosting**.

Consumers request `GET /v1/paid/agent-capabilities` with `X-Kindred-Purchase-Id` containing a stable random identifier. The first request returns HTTP 402 and a V2 payment challenge. The buyer signs using an interoperable x402 client/wallet (keys must not be handled by this server), retries with the same purchase ID and the `PAYMENT-SIGNATURE` header, and receives the capability manifest only after facilitator and onchain settlement proofs are complete. Retrying the same settled purchase returns its original proof without charging again. A changed payload or reused payment signature cannot be used for a new purchase.

**Uncertain settlement:** after an ambiguous `/settle` network failure the purchase remains `settlement_pending`. Do not blindly call the facilitator again. Reconcile against the facilitator's idempotency/transaction data and Base receipts. `attach_settlement_proof` persists a facilitator-returned transaction before a separate RPC confirmation. After a crash, a trusted reconciliation worker can query the recorded `tx_hash`, verify the onchain transfer again, and call `payment_transition(..., 'settlement_pending', 'settled', ...)`. If no transaction was received, investigate provider records before releasing budget or retrying.

## Human/agent commerce integration

- **A human customer** checks out through Stripe and the provider's client SDK; it is **not paid** merely because a PaymentIntent was created. Honor captured/succeeded status after independent provider retrieval plus verified, deduplicated webhooks.
- **An agent customer** must receive a scoped Brainstem mandate and reserve an atomic budget before calling an x402 purchasing client. The seller's x402 adapter is independent of the buyer's signer.
- **Workers and human sellers** need provider onboarding and identity verification; connected-account capabilities and balance must be confirmed before Stripe Connect transfer or payout. The agent may be an authorized beneficiary controller, but is not automatically a legal payee or bank account holder.
- **Taxes** require jurisdiction, customer-location evidence, product/service classification, registration/liability determination, calculation finalization, collection, remittance and returns. A Stripe Tax quote does not equal filed/paid taxes.
- **x402 USDC refunds** require a separately authorized treasury transfer, verified transaction, and a refund ledger entry. No network protocol can reverse a completed USDC transfer. Stripe refund endpoints apply to Stripe payments, not x402 transfers.
- **Banking** means using a licensed provider's verified connected accounts and balance. Do not advertise Kindred as a bank, issue account numbers, take deposits, commingle customer funds, or move x402 balance to Stripe without a distinct compliant conversion/off-ramp.

## Completion criteria — still outstanding outside this PR

1. Deploy the durable engine and a shared database appropriate to the actual hosting topology. Run multi-worker kill/restart and physical storage loss/recovery tests.
2. Configure a real Brainstem signer and verify that the production grant issuance path uses the bridge and revocation events.
3. Provide actual Base merchant account, merchant URL, facilitator account/authorization if required, trusted RPC, and first paying wallet.
4. Perform one **real authorized** mainnet paid service call and preserve client request ID, challenge, signer payload digest, facilitator verification/settlement, transaction hash, independently queried Base receipt, and read-only resource response. All must correlate to the same purchase ID.
5. Configure Stripe live Connect/Tax (including connected accounts, bank details, compliance status, supported payout geography) and process a genuine fiat transaction, refund and payout with provider receipts.
6. Complete tax registration, filing/1099/contractor workflows, dispute and fraud handling, treasury reconciliation, backups, security review and service-level operations.
7. Only after the real end-to-end transaction is verified, roll out marketplace listings, job matching, order lifecycle, trust and reputation scoring, fee configuration and expansion to multiple payment networks.

## Known boundaries

This package has no authority to invent settled receipts, withdraw money, originate bank accounts, onboard sellers without provider approval, file taxes, or claim independent multi-host durability on one SQLite file. CI tests use **explicit fakes** for facilitator/chain/provider calls; they do not constitute actual blockchain settlement. No live funds or production deployment have been exercised by the initial PR.
