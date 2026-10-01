import test from "node:test";
import assert from "node:assert/strict";
import {
  VerificationProofScheduler
} from "../src/verification-proof-scheduler.mjs";

function worker(overrides = {}) {
  return {
    workerId: "verifier-a",
    authorized: true,
    gates: ["contract", "lint", "test", "build", "install", "provenance"],
    maxConcurrent: 2,
    endpoint: "verifier://a",
    ...overrides
  };
}

function task(overrides = {}) {
  return {
    taskId: "gate-1",
    gateKind: "test",
    requirement: "required",
    priority: 50,
    ...overrides
  };
}

test("required verification is scheduled before advisory work", () => {
  const scheduler = new VerificationProofScheduler();
  scheduler.registerWorker(
    worker({
      maxConcurrent: 4,
      gates: ["test", "benchmark", "provenance"]
    })
  );

  const scheduled = scheduler.scheduleBatch([
    task({
      taskId: "benchmark",
      gateKind: "benchmark",
      requirement: "advisory"
    }),
    task({
      taskId: "test",
      gateKind: "test",
      requirement: "required"
    }),
    task({
      taskId: "provenance",
      gateKind: "provenance",
      requirement: "required"
    })
  ]);

  assert.deepEqual(
    scheduled.map((item) => item.taskId),
    ["provenance", "test", "benchmark"]
  );
  assert.ok(scheduled.every((item) => item.executed === false));
});

test("scheduler selects a gate-capable verifier with free capacity", () => {
  const scheduler = new VerificationProofScheduler();
  scheduler.registerWorker(worker());
  scheduler.registerWorker(
    worker({
      workerId: "verifier-b",
      gates: ["benchmark"],
      endpoint: "verifier://b"
    })
  );

  const result = scheduler.assign(task());
  assert.equal(result.scheduled, true);
  assert.equal(result.workerId, "verifier-a");
  assert.equal(result.executed, false);
});

test("missing gate capability remains unscheduled", () => {
  const scheduler = new VerificationProofScheduler();
  scheduler.registerWorker(
    worker({ gates: ["lint"] })
  );

  const result = scheduler.assign(
    task({ gateKind: "install" })
  );
  assert.equal(result.scheduled, false);
  assert.equal(result.workerId, null);
});

test("verification capacity is bounded until released", () => {
  const scheduler = new VerificationProofScheduler();
  scheduler.registerWorker(worker({ maxConcurrent: 1 }));

  const first = scheduler.assign(task({ taskId: "one" }));
  const second = scheduler.assign(task({ taskId: "two" }));
  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, false);

  scheduler.release(first.workerId);
  const third = scheduler.assign(task({ taskId: "three" }));
  assert.equal(third.scheduled, true);
});

test("least-loaded verifier wins when multiple workers can prove the gate", () => {
  const scheduler = new VerificationProofScheduler();
  scheduler.registerWorker(worker({ workerId: "a", maxConcurrent: 2 }));
  scheduler.registerWorker(worker({ workerId: "b", maxConcurrent: 2 }));

  const first = scheduler.assign(task({ taskId: "one" }));
  const second = scheduler.assign(task({ taskId: "two" }));

  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, true);
  assert.notEqual(first.workerId, second.workerId);
});
