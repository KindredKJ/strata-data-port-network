import test from "node:test";
import assert from "node:assert/strict";
import {
  ProductionCapabilityScheduler,
  validateProductionTask,
  validateWorker
} from "../src/production-capability-scheduler.mjs";

function worker(overrides = {}) {
  return {
    workerId: "worker-a", authorized: true,
    capabilities: ["python", "pytest", "adapter.scaffold"],
    maxConcurrent: 2, endpoint: "worker://a", ...overrides
  };
}

function task(overrides = {}) {
  return {
    taskId: "task-1", kind: "scaffold",
    requiredCapabilities: ["adapter.scaffold"],
    effectClass: "E1", approved: false, priority: 50, ...overrides
  };
}

test("selects least-loaded capable worker and never claims execution", () => {
  const s = new ProductionCapabilityScheduler();
  s.registerWorker(worker());
  s.registerWorker(worker({ workerId: "worker-b", endpoint: "worker://b", maxConcurrent: 1 }));
  const first = s.assign(task({ taskId: "one" }));
  const second = s.assign(task({ taskId: "two" }));
  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, true);
  assert.notEqual(first.workerId, second.workerId);
  assert.equal(first.executed, false);
});

test("high-effect task requires explicit boolean approval", () => {
  const s = new ProductionCapabilityScheduler();
  s.registerWorker(worker({ capabilities: ["physical.actuate"] }));
  for (const approved of [false, "false", 1, null]) {
    const result = s.assign(task({
      taskId: "actuate", kind: "control",
      requiredCapabilities: ["physical.actuate"], effectClass: "E5", approved
    }));
    assert.equal(result.scheduled, false);
    assert.match(result.reason, /approval/);
  }
  const accepted = s.assign(task({
    taskId: "actuate", kind: "control",
    requiredCapabilities: ["physical.actuate"], effectClass: "E5", approved: true
  }));
  assert.equal(accepted.scheduled, true);
  assert.equal(accepted.executed, false);
});

test("batch prioritizes control and proof before scaffold and bulk", () => {
  const s = new ProductionCapabilityScheduler();
  s.registerWorker(worker({
    maxConcurrent: 8,
    capabilities: ["control", "proof", "adapter.scaffold", "bulk"]
  }));
  const result = s.scheduleBatch([
    task({ taskId: "bulk", kind: "bulk", requiredCapabilities: ["bulk"] }),
    task({ taskId: "scaffold", requiredCapabilities: ["adapter.scaffold"] }),
    task({ taskId: "proof", kind: "proof", requiredCapabilities: ["proof"] }),
    task({ taskId: "control", kind: "control", requiredCapabilities: ["control"] })
  ]);
  assert.deepEqual(result.map(x => x.taskId), ["control", "proof", "scaffold", "bulk"]);
  assert.ok(result.every(x => x.scheduled));
});

test("capacity is reserved and released only by one-time reservation ID", () => {
  const s = new ProductionCapabilityScheduler();
  s.registerWorker(worker({ maxConcurrent: 1 }));
  const first = s.assign(task({ taskId: "one" }));
  const second = s.assign(task({ taskId: "two" }));
  assert.equal(first.scheduled, true);
  assert.equal(second.queued, true);
  const done = s.release(first.reservationId);
  assert.equal(done.released, true);
  assert.equal(done.reassigned[0].taskId, "two");
  assert.equal(s.release(first.reservationId).released, false);
  assert.equal(s.workerStatus()[0].inFlight, 1);
  assert.equal(s.release(done.reassigned[0].reservationId).released, true);
  const third = s.assign(task({ taskId: "three" }));
  assert.equal(third.scheduled, true);
});

test("false-like nonboolean authorization never grants worker admission", () => {
  for (const authorized of ["false", 1, {}, false]) {
    assert.throws(() => validateWorker(worker({ authorized })), /authorized/);
  }
});

test("inherited effect or task kind names cannot bypass approval gates", () => {
  for (const effectClass of ["toString", "constructor", "__proto__"]) {
    assert.throws(() => validateProductionTask(task({ effectClass })), /unknown effect class/);
  }
  for (const kind of ["toString", "constructor", "__proto__"]) {
    assert.throws(() => validateProductionTask(task({ kind })), /unknown production task kind/);
  }
});

test("worker eligibility and status reports cannot mutate the registry", () => {
  const s = new ProductionCapabilityScheduler();
  s.registerWorker(worker());
  s.workerStatus()[0].capabilities.push("physical.actuate");
  const eligible = s.eligibleWorkers(task());
  eligible[0].capabilities.push("physical.actuate");
  const result = s.assign(task({
    taskId: "denied", kind: "control", requiredCapabilities: ["physical.actuate"]
  }));
  assert.equal(result.scheduled, false);
  assert.equal(result.queued, true);
  assert.equal(s.workerStatus()[0].capabilities.includes("physical.actuate"), false);
});

test("incremental priority retains reserved control capacity", () => {
  const s = new ProductionCapabilityScheduler();
  s.registerWorker(worker({
    maxConcurrent: 2,
    capabilities: ["bulk", "control", "proof"]
  }));
  const bulk = s.assign(task({ taskId: "bulk", kind: "bulk", requiredCapabilities: ["bulk"] }));
  const blocked = s.assign(task({ taskId: "bulk2", kind: "bulk", requiredCapabilities: ["bulk"] }));
  const control = s.assign(task({ taskId: "control", kind: "control", requiredCapabilities: ["control"] }));
  assert.equal(bulk.scheduled, true);
  assert.equal(blocked.queued, true);
  assert.equal(control.scheduled, true);
  assert.equal(s.workerStatus()[0].inFlight, 2);
});

test("queued high priority gets released capacity before queued bulk tasks", () => {
  const s = new ProductionCapabilityScheduler();
  s.registerWorker(worker({ maxConcurrent: 1, capabilities: ["bulk", "control"] }));
  const first = s.assign(task({ taskId: "b1", kind: "bulk", requiredCapabilities: ["bulk"] }));
  s.assign(task({ taskId: "b2", kind: "bulk", requiredCapabilities: ["bulk"] }));
  s.assign(task({ taskId: "control", kind: "control", requiredCapabilities: ["control"] }));
  const released = s.release(first.reservationId);
  assert.equal(released.reassigned[0].taskId, "control");
  assert.deepEqual(s.queueStatus().tasks, ["b2"]);
});

test("numeric IDs are rejected before sorting and assignment", () => {
  const s = new ProductionCapabilityScheduler();
  assert.throws(() => s.registerWorker(worker({ workerId: 123 })), /workerId/);
  assert.throws(() => s.assign(task({ taskId: 456 })), /taskId/);
});

test("duplicate task IDs are idempotently held without double reservation", () => {
  const s = new ProductionCapabilityScheduler();
  s.registerWorker(worker({ maxConcurrent: 2 }));
  const first = s.assign(task({ taskId: "same" }));
  const second = s.assign(task({ taskId: "same" }));
  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, false);
  assert.equal(s.workerStatus()[0].inFlight, 1);
});

test("bounded queue refuses excess work without claiming execution", () => {
  const s = new ProductionCapabilityScheduler({ maxQueued: 1 });
  s.registerWorker(worker({ maxConcurrent: 1 }));
  s.assign(task({ taskId: "one" }));
  assert.equal(s.assign(task({ taskId: "two" })).queued, true);
  const third = s.assign(task({ taskId: "three" }));
  assert.equal(third.queued, false);
  assert.equal(third.scheduled, false);
});
