import test from "node:test";
import assert from "node:assert/strict";
import {
  RepairExperimentScheduler, validateRepairWorker, validateRepairTask
} from "../src/repair-experiment-scheduler.mjs";

function worker(overrides = {}) {
  return {
    workerId: "repair-a", authorized: true,
    phases: ["diagnose", "synthesize", "stage", "verify", "compare"],
    maxConcurrent: 2, endpoint: "repair://a", ...overrides
  };
}

function task(overrides = {}) {
  return {
    taskId: "task-1", experimentId: "experiment-1", candidateId: "candidate-1",
    phase: "verify", effectClass: "E1", attempt: 1, maxAttempts: 3,
    priority: 50, ...overrides
  };
}

test("repair phases schedule in deterministic priority and never execute", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker({ maxConcurrent: 8 }));
  const scheduled = s.scheduleBatch([
    task({ taskId: "compare", phase: "compare" }),
    task({ taskId: "stage", phase: "stage" }),
    task({ taskId: "diagnose", phase: "diagnose" }),
    task({ taskId: "verify", phase: "verify" }),
    task({ taskId: "synthesize", phase: "synthesize" })
  ]);
  assert.deepEqual(scheduled.map(x => x.taskId),
    ["diagnose", "synthesize", "stage", "verify", "compare"]);
  assert.ok(scheduled.every(x => x.scheduled && x.executed === false));
});

test("repair scheduler rejects E2 through E5 tasks", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker());
  for (const effectClass of ["E2", "E3", "E4", "E5"]) {
    assert.throws(() => s.assign(task({ effectClass })), /only accepts E0\/E1/);
  }
});

test("attempt budget rejects attempt above explicit maximum", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker());
  const r = s.assign(task({ attempt: 4, maxAttempts: 3 }));
  assert.equal(r.scheduled, false);
  assert.match(r.reason, /budget exhausted/);
});

test("stale attempts rejected after a newer accepted attempt", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker());
  const newer = s.assign(task({ attempt: 2 }));
  s.release(newer.reservationId);
  const stale = s.assign(task({ taskId: "stale", attempt: 1 }));
  assert.equal(newer.scheduled, true);
  assert.equal(stale.scheduled, false);
  assert.match(stale.reason, /Stale/);
});

test("capacity bounds are preserved with reservation-bound release", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker({ maxConcurrent: 1 }));
  const one = s.assign(task({ taskId: "one" }));
  const two = s.assign(task({ taskId: "two", experimentId: "exp-2" }));
  assert.equal(one.scheduled, true);
  assert.equal(two.queued, true);
  const release = s.release(one.reservationId);
  assert.equal(release.reassigned[0].taskId, "two");
  assert.equal(s.release(one.reservationId).released, false);
  assert.equal(s.status()[0].inFlight, 1);
  s.release(release.reassigned[0].reservationId);
  assert.equal(s.assign(task({ taskId: "three", experimentId: "exp-3" })).scheduled, true);
});

test("least-loaded capable repair worker wins", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker({ workerId: "a" }));
  s.registerWorker(worker({ workerId: "b" }));
  const first = s.assign(task({ taskId: "one" }));
  const second = s.assign(task({ taskId: "two", experimentId: "exp-2" }));
  assert.notEqual(first.workerId, second.workerId);
});

test("full verification never enters the repair worker pool", () => {
  const s = new RepairExperimentScheduler();
  assert.throws(() => s.registerWorker(worker({
    phases: ["diagnose", "full_verify"]
  })), /exclude full_verify/);
  s.registerWorker(worker());
  const full = s.assign(task({ taskId: "full", phase: "full_verify" }));
  assert.equal(full.scheduled, false);
  assert.match(full.reason, /Independent VerificationProofScheduler/);
});

test("attempt ceiling is immutable for each experiment and phase", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker());
  const first = s.assign(task({ taskId: "first", maxAttempts: 1 }));
  assert.equal(first.scheduled, true);
  s.release(first.reservationId);
  const extended = s.assign(task({ taskId: "attempt2", attempt: 2, maxAttempts: 2 }));
  assert.equal(extended.scheduled, false);
  assert.match(extended.reason, /pinned/);
  assert.equal(s.attemptStatus("experiment-1", "verify").maxAttempts, 1);
});

test("repeating an accepted attempt never creates a new reservation", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker({ maxConcurrent: 1 }));
  const first = s.assign(task({ taskId: "original" }));
  s.release(first.reservationId);
  const duplicate = s.assign(task({ taskId: "duplicate", attempt: 1 }));
  assert.equal(duplicate.scheduled, false);
  assert.match(duplicate.reason, /duplicate/);
});

test("pending attempt cannot be resubmitted or overtaken before dispatch", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker({ maxConcurrent: 1 }));
  const first = s.assign(task({ taskId: "first", experimentId: "exp-1" }));
  const waiting = s.assign(task({ taskId: "second", experimentId: "exp-2" }));
  assert.equal(waiting.queued, true);
  const duplicate = s.assign(task({ taskId: "third", experimentId: "exp-2", attempt: 1 }));
  assert.match(duplicate.reason, /queued/);
  const more = s.assign(task({ taskId: "fourth", experimentId: "exp-2", attempt: 2 }));
  assert.equal(more.scheduled, false);
  const completion = s.release(first.reservationId);
  assert.equal(completion.reassigned[0].taskId, "second");
  assert.deepEqual(s.attemptStatus("exp-2", "verify").pending, []);
});

test("duplicate release cannot steal another in-flight worker slot", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker({ maxConcurrent: 2 }));
  const a = s.assign(task({ taskId: "one" }));
  const b = s.assign(task({ taskId: "two", experimentId: "exp-2" }));
  assert.equal(s.release(a.reservationId).released, true);
  assert.equal(s.release(a.reservationId).released, false);
  assert.equal(s.status()[0].inFlight, 1);
  assert.equal(s.release(b.reservationId).released, true);
});

test("status and eligibility return detached capability snapshots", () => {
  const s = new RepairExperimentScheduler();
  s.registerWorker(worker({ phases: ["verify"] }));
  s.status()[0].phases.push("stage");
  s.eligibleWorkers(task())[0].phases.push("stage");
  assert.equal(s.eligibleWorkers(task({ phase: "stage" })).length, 0);
  assert.deepEqual(s.status()[0].phases, ["verify"]);
});

test("authorization only accepts boolean true", () => {
  for (const authorized of ["false", false, 1, null]) {
    assert.throws(() => validateRepairWorker(worker({ authorized })), /authorized/);
  }
});

test("inherited phase properties and malformed identifiers are rejected", () => {
  for (const phase of ["toString", "__proto__", "constructor"]) {
    assert.throws(() => validateRepairTask(task({ phase })), /unknown repair phase/);
  }
  assert.throws(() => validateRepairTask(task({ taskId: 8 })), /taskId/);
  assert.throws(() => validateRepairTask(task({ experimentId: 8 })), /experimentId/);
  assert.throws(() => validateRepairWorker(worker({ workerId: 8 })), /workerId/);
});
