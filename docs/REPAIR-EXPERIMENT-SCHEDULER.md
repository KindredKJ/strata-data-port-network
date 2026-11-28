# Repair Experiment Scheduler

Wave 9 adds a bounded SDPN scheduling lane for autonomous repair experiments.

## Phases

```text
DIAGNOSE
   >
SYNTHESIZE
   >
STAGE
   >
VERIFY
   >
COMPARE
   >
FULL_VERIFY
```

These are scheduling priorities. A schedule receipt still reports `executed=false`.

## Attempt budget

Every task carries:

```text
attempt
maxAttempts
```

Attempts beyond the budget are unscheduled, and stale attempts are rejected after a newer attempt
has already been accepted for the same experiment/phase.

This prevents a failing artifact from entering an unbounded generate/test retry loop.

## Effect boundary

The repair scheduler accepts E0/E1 work only. E2-E5 work is rejected rather than routed into an
autonomous repair lane.

## Separation of powers

- Production workers create/stage artifacts.
- Verification workers prove gates.
- Repair workers diagnose, synthesize and stage bounded candidates.
- Full verification remains the authority for whether a repaired candidate survives.

Scheduling a repair task is not evidence that the repair ran, passed, merged or deployed.

## Release-ready scheduling contract

Repair workers may admit diagnose/synthesize/stage/verify/compare only.
Full verification is explicitly delegated to the independent
VerificationProofScheduler; this repair pool cannot self-certify results.

Repair tasks accept only E0/E1. The first admitted experiment/phase attempt
pins maxAttempts; subsequent changes to the ceiling are rejected, as are
stale, duplicate and pending-overtaking attempts. Identity keys are structured
and do not depend on ambiguous string delimiters.

The repair worker registry is isolated from production and verification
worker registries but reuses the shared, tested secure reservation core.
Every accepted assignment returns a unique reservationId. Duplicate
release(reservationId) is harmless and cannot free another task's slot.
Queue status, in-flight worker counts, attempt state and immutable worker
snapshots remain inspectable. No scheduling receipt implies actual execution.

A full_verify phase returns an explicit unscheduled handoff until a separate
authorized verifier issues its own independently checked receipt.
