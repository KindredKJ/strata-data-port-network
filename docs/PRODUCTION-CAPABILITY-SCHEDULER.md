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
