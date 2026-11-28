import test from "node:test";
import assert from "node:assert/strict";
import {
  VerificationProofScheduler,
  validateVerificationWorker,
  validateVerificationTask
} from "../src/verification-proof-scheduler.mjs";

function worker(overrides = {}) {
  return {
    workerId: "verifier-a", authorized: true,
    gates: ["contract", "lint", "test", "build", "install", "provenance"],
    maxConcurrent: 2, endpoint: "verifier://a", ...overrides
  };
}

function task(overrides = {}) {
  return {
    taskId: "gate-1", gateKind: "test", requirement: "required",
    priority: 50, ...overrides
  };
}

test("required verification runs before advisory and evidence isn't invented", () => {
  const s = new VerificationProofScheduler();
  s.registerWorker(worker({ maxConcurrent: 4, gates: ["test", "benchmark", "provenance"] }));
  const results = s.scheduleBatch([
    task({ taskId: "benchmark", gateKind: "benchmark", requirement: "advisory" }),
    task({ taskId: "test", gateKind: "test" }),
    task({ taskId: "provenance", gateKind: "provenance" })
  ]);
  assert.deepEqual(results.map(x => x.taskId), ["provenance", "test", "benchmark"]);
  assert.ok(results.every(x => x.scheduled && x.executed === false));
});

test("scheduler selects gate-capable verification worker", () => {
  const s = new VerificationProofScheduler();
  s.registerWorker(worker());
  s.registerWorker(worker({ workerId: "verifier-b", gates: ["benchmark"] }));
  const result = s.assign(task());
  assert.equal(result.scheduled, true);
  assert.equal(result.workerId, "verifier-a");
  assert.equal(result.executed, false);
});

test("missing gate capability remains unscheduled", () => {
  const s = new VerificationProofScheduler();
  s.registerWorker(worker({ gates: ["lint"] }));
  assert.equal(s.assign(task({ gateKind: "install" })).scheduled, false);
});

test("capacity is bounded with one-time reservation-bound release", () => {
  const s = new VerificationProofScheduler();
  s.registerWorker(worker({ maxConcurrent: 1 }));
  const first = s.assign(task({ taskId: "one" }));
  const second = s.assign(task({ taskId: "two" }));
  assert.equal(first.scheduled, true);
  assert.equal(second.queued, true);
  const release = s.release(first.reservationId);
  assert.equal(release.reassigned[0].taskId, "two");
  assert.equal(s.release(first.reservationId).released, false);
  assert.equal(s.status()[0].inFlight, 1);
  s.release(release.reassigned[0].reservationId);
  assert.equal(s.assign(task({ taskId: "three" })).scheduled, true);
});

test("least-loaded verification worker wins when both capable", () => {
  const s = new VerificationProofScheduler();
  s.registerWorker(worker({ workerId: "a" }));
  s.registerWorker(worker({ workerId: "b" }));
  const first = s.assign(task({ taskId: "one" }));
  const second = s.assign(task({ taskId: "two" }));
  assert.notEqual(first.workerId, second.workerId);
});

test("worker authorization must be boolean true", () => {
  for (const authorized of ["false", 1, false, null]) {
    assert.throws(() => validateVerificationWorker(worker({ authorized })), /authorized/);
  }
});

test("gate kind and worker gate names reject inherited properties", () => {
  for (const gateKind of ["toString", "__proto__", "constructor"]) {
    assert.throws(() => validateVerificationTask(task({ gateKind })), /unknown verification gate/);
    assert.throws(() => validateVerificationWorker(worker({ gates: [gateKind] })), /gate names/);
  }
});

test("returned worker gate lists are detached snapshots", () => {
  const s = new VerificationProofScheduler();
  s.registerWorker(worker({ gates: ["lint", "test"] }));
  s.status()[0].gates.push("install");
  s.eligibleWorkers(task())[0].gates.push("install");
  assert.equal(s.assign(task({ taskId: "install", gateKind: "install" })).scheduled, false);
  assert.deepEqual(s.status()[0].gates, ["lint", "test"]);
});

test("required jobs use reserved verifier capacity before advisory", () => {
  const s = new VerificationProofScheduler();
  s.registerWorker(worker({ maxConcurrent: 2, gates: ["test", "benchmark"] }));
  const advisory = s.assign(task({ taskId: "advisory", gateKind: "benchmark", requirement: "advisory" }));
  const waiting = s.assign(task({ taskId: "advisory2", gateKind: "benchmark", requirement: "advisory" }));
  const needed = s.assign(task({ taskId: "required", gateKind: "test", requirement: "required" }));
  assert.equal(advisory.scheduled, true);
  assert.equal(waiting.queued, true);
  assert.equal(needed.scheduled, true);
});

test("required pending proof outranks advisory once single worker slot releases", () => {
  const s = new VerificationProofScheduler();
  s.registerWorker(worker({ maxConcurrent: 1, gates: ["test", "benchmark"] }));
  const active = s.assign(task({ taskId: "active", gateKind: "benchmark", requirement: "advisory" }));
  s.assign(task({ taskId: "advisory", gateKind: "benchmark", requirement: "advisory" }));
  s.assign(task({ taskId: "required", gateKind: "test", requirement: "required" }));
  const released = s.release(active.reservationId);
  assert.equal(released.reassigned[0].taskId, "required");
  assert.deepEqual(s.queueStatus().tasks, ["advisory"]);
});

test("numeric IDs and invalid verification requirements are rejected", () => {
  assert.throws(() => validateVerificationWorker(worker({ workerId: 55 })), /workerId/);
  assert.throws(() => validateVerificationTask(task({ taskId: 34 })), /taskId/);
  assert.throws(() => validateVerificationTask(task({ requirement: "optional" })), /requirement/);
});

test("task identity is not reused for a different verification gate", () => {
  const s = new VerificationProofScheduler();
  s.registerWorker(worker({ maxConcurrent: 1 }));
  s.assign(task({ taskId: "same", gateKind: "test" }));
  assert.throws(() => s.assign(task({ taskId: "same", gateKind: "lint" })), /reused/);
});
