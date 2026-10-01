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
