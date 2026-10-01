import test from "node:test";
import assert from "node:assert/strict";
import {
  RepairExperimentScheduler
} from "../src/repair-experiment-scheduler.mjs";

function worker(overrides = {}) {
  return {
    workerId: "repair-a",
    authorized: true,
    phases: ["diagnose", "synthesize", "stage", "verify", "compare", "full_verify"],
    maxConcurrent: 2,
    endpoint: "repair://a",
    ...overrides
  };
}

function task(overrides = {}) {
  return {
    taskId: "task-1",
    experimentId: "experiment-1",
    candidateId: "candidate-1",
    phase: "verify",
    effectClass: "E1",
    attempt: 1,
    maxAttempts: 3,
    priority: 50,
    ...overrides
  };
}

test("repair phases schedule in deterministic pipeline priority", () => {
  const scheduler = new RepairExperimentScheduler();
  scheduler.registerWorker(worker({ maxConcurrent: 8 }));

  const scheduled = scheduler.scheduleBatch([
    task({ taskId: "compare", phase: "compare" }),
    task({ taskId: "stage", phase: "stage" }),
    task({ taskId: "diagnose", phase: "diagnose" }),
    task({ taskId: "verify", phase: "verify" }),
    task({ taskId: "synthesize", phase: "synthesize" })
  ]);

  assert.deepEqual(
    scheduled.map((item) => item.taskId),
    ["diagnose", "synthesize", "stage", "verify", "compare"]
  );
  assert.ok(scheduled.every((item) => item.executed === false));
});

test("repair scheduler rejects E2 through E5 tasks", () => {
  const scheduler = new RepairExperimentScheduler();
  scheduler.registerWorker(worker());

  assert.throws(
    () => scheduler.assign(task({ effectClass: "E2" })),
    /only accepts E0\/E1/
  );
});

test("attempt budget prevents unbounded repair retries", () => {
  const scheduler = new RepairExperimentScheduler();
  scheduler.registerWorker(worker());

  const result = scheduler.assign(
    task({ attempt: 4, maxAttempts: 3 })
  );

  assert.equal(result.scheduled, false);
  assert.match(result.reason, /budget exhausted/i);
});

test("stale repair attempt is rejected", () => {
  const scheduler = new RepairExperimentScheduler();
  scheduler.registerWorker(worker({ maxConcurrent: 2 }));

  const newer = scheduler.assign(task({ attempt: 2 }));
  scheduler.release(newer.workerId);
  const stale = scheduler.assign(
    task({ taskId: "stale", attempt: 1 })
  );

  assert.equal(newer.scheduled, true);
  assert.equal(stale.scheduled, false);
  assert.match(stale.reason, /stale/i);
});

test("capacity is bounded and explicitly released", () => {
  const scheduler = new RepairExperimentScheduler();
  scheduler.registerWorker(worker({ maxConcurrent: 1 }));

  const first = scheduler.assign(task({ taskId: "one" }));
  const second = scheduler.assign(
    task({
      taskId: "two",
      experimentId: "experiment-2"
    })
  );

  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, false);

  scheduler.release(first.workerId);
  const third = scheduler.assign(
    task({
      taskId: "three",
      experimentId: "experiment-3"
    })
  );
  assert.equal(third.scheduled, true);
});

test("least-loaded capable repair worker wins", () => {
  const scheduler = new RepairExperimentScheduler();
  scheduler.registerWorker(worker({ workerId: "a", maxConcurrent: 2 }));
  scheduler.registerWorker(worker({ workerId: "b", maxConcurrent: 2 }));

  const first = scheduler.assign(task({ taskId: "one" }));
  const second = scheduler.assign(
    task({
      taskId: "two",
      experimentId: "experiment-2"
    })
  );

  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, true);
  assert.notEqual(first.workerId, second.workerId);
});
