# Verification Proof Scheduler

Wave 8 gives SDPN a dedicated scheduling primitive for verification work.

Verification uses its own worker pool and capacity accounting so increased build volume cannot
starve proof.

## Ordering

Required gates are scheduled before advisory gates. Within the same requirement class:

```text
PROVENANCE
  > CONTRACT
  > LINT
  > TEST
  > BUILD
  > INSTALL
  > BENCHMARK
```

This order is scheduling priority, not a claim that every gate must execute serially. Independent
gates may still be assigned to different verifiers in parallel.

## Contract

Workers advertise the gate kinds they can prove plus bounded concurrency. The scheduler:

1. rejects unauthorized workers;
2. requires an exact gate capability;
3. rejects saturated workers;
4. chooses the lowest normalized load;
5. emits a schedule receipt with `executed=false`.

Scheduling is therefore evidence of assignment only, never evidence that a proof ran or passed.

## Production effect

Build and verification can now scale as separate resource pools:

```text
production workers  -> scaffold/build lanes
verification workers -> proof/test/benchmark lanes
```

Adding more builders does not remove proof capacity. Adding more verifiers increases proof
parallelism without changing the verification contract.

## Durable scheduler contract

Verification scheduling reuses the tested ProductionCapabilityScheduler reservation
engine through an isolated verifier registry. Admission requires explicit boolean
worker authorization and known gate kinds. Every assignment has an independent
reservationId; duplicate release never frees another verification task's slot.

Required gates retain capacity headroom on multi-slot verifier workers and
receive priority over advisory gates in the bounded queue. A single-slot
verifier cannot interrupt an already executing task; required work goes first
at the next reservation release.

Call release(reservationId), not release(workerId). The return value
contains reassigned receipts for pending work. A successful schedule remains
executed=false until independent verification actually completes.
