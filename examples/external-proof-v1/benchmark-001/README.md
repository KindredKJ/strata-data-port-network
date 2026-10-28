# Kindred External Benchmark #001

**Observed:** 2026-10-28T02:27:15.833Z

This is the first measured external baseline for the bounded Kindred External Proof v1 path.

## Path

```
independent Vercel client (iad1)
  -> Render Unified Quad canary
  -> bounded HASH_TEXT / CANONICALIZE_JSON execution
  -> encrypted authenticated state transfer
  -> production Strata on Vercel
  -> Ed25519 signed receipt
  -> independent client receipt verification
```

## Results

- Jobs: **12**
- HTTP 201 + independently verified receipt: **12 / 12**
- Failures: **0**
- Success rate in this bounded run: **100%**
- Minimum: **288.792 ms**
- Mean: **427.988 ms**
- p50: **358.153 ms**
- p95: **1,044.115 ms**
- p99: **1,044.115 ms**
- Maximum: **1,044.115 ms**

Every row in `jobs.csv` records the operation, HTTP status, independent verification result, measured client-observed latency, job ID and state SHA-256.

## Interpretation

This is an **external bounded benchmark**, not an availability SLO or production-scale performance claim. Twelve sequential jobs are enough to establish a reproducible baseline for this exact proof path, but not enough to characterize long-term uptime, sustained concurrency, geographic performance, capacity or production reliability.

The first request was the slowest at ~1.04 s and therefore also determines p95/p99 in this small sample. Subsequent requests were mostly in the ~289–546 ms range.

## Still not proven by this benchmark

- concurrent-load capacity,
- multi-region failover,
- long-duration uptime,
- automatic failover,
- arbitrary abrupt crash/power-loss recovery,
- physical-machine attestation,
- physical zero-copy transport,
- commercial/customer use.

Those are separate gates.
