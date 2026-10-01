import test from "node:test";
import assert from "node:assert/strict";
import {
  ProductionCapabilityScheduler
} from "../src/production-capability-scheduler.mjs";

function worker(overrides = {}) {
  return {
    workerId: "worker-a",
    authorized: true,
    capabilities: ["python", "pytest", "adapter.scaffold"],
    maxConcurrent: 2,
    endpoint: "worker://a",
    ...overrides
  };
}

function task(overrides = {}) {
  return {
    taskId: "task-1",
    kind: "scaffold",
    requiredCapabilities: ["adapter.scaffold"],
    effectClass: "E1",
    approved: false,
    priority: 50,
    ...overrides
  };
}

test("scheduler selects least-loaded capable worker", () => {
  const scheduler = new ProductionCapabilityScheduler();
  scheduler.registerWorker(worker());
  scheduler.registerWorker(
    worker({
      workerId: "worker-b",
      endpoint: "worker://b",
      maxConcurrent: 1
    })
  );

  const first = scheduler.assign(task({ taskId: "one" }));
  const second = scheduler.assign(task({ taskId: "two" }));

  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, true);
  assert.notEqual(first.workerId, second.workerId);
  assert.equal(first.executed, false);
  assert.equal(second.executed, false);
});

test("high-effect task cannot be scheduled without approval", () => {
  const scheduler = new ProductionCapabilityScheduler();
  scheduler.registerWorker(
    worker({ capabilities: ["physical.actuate"] })
  );

  const result = scheduler.assign(
    task({
      taskId: "actuate",
      kind: "control",
      requiredCapabilities: ["physical.actuate"],
      effectClass: "E5",
      approved: false
    })
  );

  assert.equal(result.scheduled, false);
  assert.match(result.reason, /approval/i);
});

test("approved high-effect task can be assigned but is never claimed executed", () => {
  const scheduler = new ProductionCapabilityScheduler();
  scheduler.registerWorker(
    worker({ capabilities: ["physical.actuate"] })
  );

  const result = scheduler.assign(
    task({
      taskId: "actuate",
      kind: "control",
      requiredCapabilities: ["physical.actuate"],
      effectClass: "E5",
      approved: true
    })
  );

  assert.equal(result.scheduled, true);
  assert.equal(result.executed, false);
});

test("batch scheduler prioritizes control and proof before scaffold and bulk", () => {
  const scheduler = new ProductionCapabilityScheduler();
  scheduler.registerWorker(
    worker({
      maxConcurrent: 8,
      capabilities: [
        "control",
        "proof",
        "adapter.scaffold",
        "bulk"
      ]
    })
  );

  const scheduled = scheduler.scheduleBatch([
    task({
      taskId: "bulk",
      kind: "bulk",
      requiredCapabilities: ["bulk"]
    }),
    task({
      taskId: "scaffold",
      kind: "scaffold",
      requiredCapabilities: ["adapter.scaffold"]
    }),
    task({
      taskId: "proof",
      kind: "proof",
      requiredCapabilities: ["proof"]
    }),
    task({
      taskId: "control",
      kind: "control",
      requiredCapabilities: ["control"]
    })
  ]);

  assert.deepEqual(
    scheduled.map((item) => item.taskId),
    ["control", "proof", "scaffold", "bulk"]
  );
});

test("capacity is bounded and released explicitly", () => {
  const scheduler = new ProductionCapabilityScheduler();
  scheduler.registerWorker(worker({ maxConcurrent: 1 }));

  const first = scheduler.assign(task({ taskId: "one" }));
  const second = scheduler.assign(task({ taskId: "two" }));
  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, false);

  scheduler.release(first.workerId);
  const third = scheduler.assign(task({ taskId: "three" }));
  assert.equal(third.scheduled, true);
});
