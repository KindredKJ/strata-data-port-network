# Kindred Global Engine — Campaign Wave 1

This branch adds a parallel economic sidecar to SDPN. It does not replace,
rename, remove, or weaken the existing Strata Data Port Network, worker-transfer
path, candidate network, capability contracts, evidence receipts, or launch
surface.

## Wave 1 guarantees

- SDPN remains SDPN.
- Existing SDPN exports remain available.
- The economic sidecar is an independent export.
- Primary Kindred work keeps priority over background economic work.
- S0->S1 economic receipts are deterministic and additive.
- External value settlement is disabled by default.
- Active settlement fails closed without bounded authority and a verified
  settlement adapter.

## Canonical parallel protocols

K-PRODUCE, K-INFERENCE, K-DATA, K-COMMERCE, K-COMPUTE, K-ENERGY,
K-PROCURE, and K-CAPITAL.

The first SDPN mapping is K-COMPUTE over the existing
`direct-pipe-worker-transfer` capability. Future mappings can register
additional existing capabilities without mutating their base manifests.
