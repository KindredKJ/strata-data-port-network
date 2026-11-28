# SDPN Production Capability Scheduler

Wave 7 adds a scheduling primitive for production work.

The scheduler does not execute code. It assigns declared tasks to authorized workers that have the
required capabilities and free capacity.

## Scheduling rule

```text
task
 |
 +-- effect >= E2 and not approved --> UNSCHEDULED
 |
 +-- find authorized capable workers
 |
 +-- reject saturated workers
 |
 +-- choose lowest normalized load
 |
 +-- prefer least-surplus capability set
 |
 +-- reserve one concurrency slot
 |
 v
SCHEDULE RECEIPT (executed=false)
```

Task classes are ordered:

```text
CONTROL > PROOF > TEST > BUILD > SCAFFOLD > BULK
```

This lets verification and governance remain responsive while production volume grows.

## Scaling property

Adding workers increases available parallel slots without changing the task contract. Adding a new
worker implementation therefore does not require rewriting the production planner.

The scheduler deliberately reports `executed=false`. A scheduling decision is not execution
evidence.

## Admission, release and priority guarantees

Only explicitly authorized workers and explicitly approved E2–E5 tasks pass
the scheduling authorization boundary. Enumerations use own-property checks
to reject inherited object keys. All returned worker capability arrays are copies.

A successful assignment returns a unique reservationId. Call
release(reservationId) exactly once; repeated release is harmless and cannot
free a different task's concurrency slot. The earlier worker-ID-only release
interface was ambiguous and is intentionally replaced for this candidate.

Low-priority work reserves one slot for control/proof on workers with capacity
greater than one. On single-slot workers an already active task cannot be
preempted, but queued control/proof tasks dispatch before queued bulk work when
a reservation is released. The queue is bounded by maxQueued and returns
explicit queued status, never executed=true.

release() returns any newly assigned queue receipts in reassigned so
callers can deliver them to workers. Scheduling is not execution: completion
and independent proof still require external receipts.
