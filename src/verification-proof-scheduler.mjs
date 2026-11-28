import { ProductionCapabilityScheduler } from "./production-capability-scheduler.mjs";

export const VERIFICATION_SCHEDULE_SCHEMA = "kindred.sdpn.verification-schedule.v1";

const GATE_PRIORITY = Object.freeze({
  provenance: 0, contract: 1, lint: 2, test: 3,
  build: 4, install: 5, benchmark: 6
});

function requireId(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(name + " must be a nonempty string");
  }
}

export function validateVerificationWorker(worker) {
  if (!worker || typeof worker !== "object") {
    throw new TypeError("verification worker is required");
  }
  requireId(worker.workerId, "workerId");
  if (worker.authorized !== true) {
    throw new Error("verification worker must be explicitly authorized");
  }
  if (!Array.isArray(worker.gates) ||
      worker.gates.some(g => typeof g !== "string" || !Object.hasOwn(GATE_PRIORITY, g))) {
    throw new Error("verification worker gates must be recognized gate names");
  }
  if (!Number.isSafeInteger(worker.maxConcurrent) || worker.maxConcurrent < 1) {
    throw new RangeError("worker maxConcurrent must be a positive integer");
  }
  if (worker.endpoint != null && typeof worker.endpoint !== "string") {
    throw new TypeError("verification worker endpoint must be a string");
  }
  return worker;
}

export function validateVerificationTask(task) {
  if (!task || typeof task !== "object") {
    throw new TypeError("verification task is required");
  }
  requireId(task.taskId, "taskId");
  if (!Object.hasOwn(GATE_PRIORITY, task.gateKind)) {
    throw new Error("unknown verification gate: " + String(task.gateKind));
  }
  if (task.requirement !== "required" && task.requirement !== "advisory") {
    throw new Error("verification requirement must be required or advisory");
  }
  if (task.priority !== undefined &&
      (typeof task.priority !== "number" || !Number.isFinite(task.priority) ||
       task.priority < 0 || task.priority > 100)) {
    throw new RangeError("verification task priority must be between 0 and 100");
  }
  return task;
}

function order(a, b) {
  if (a.requirement !== b.requirement) return a.requirement === "required" ? -1 : 1;
  const gate = GATE_PRIORITY[a.gateKind] - GATE_PRIORITY[b.gateKind];
  if (gate) return gate;
  return (b.priority ?? 50) - (a.priority ?? 50) || a.taskId.localeCompare(b.taskId);
}

export class VerificationProofScheduler {
  #core;
  #tasks = new Map();
  #reservations = new Map();

  constructor({ maxQueued = 1024 } = {}) {
    this.#core = new ProductionCapabilityScheduler({ maxQueued });
  }

  registerWorker(worker) {
    validateVerificationWorker(worker);
    this.#core.registerWorker({
      workerId: worker.workerId,
      authorized: true,
      capabilities: worker.gates.map(gate => "verify:" + gate),
      maxConcurrent: worker.maxConcurrent,
      endpoint: worker.endpoint ?? null
    });
  }

  #coreTask(task) {
    return {
      taskId: task.taskId,
      kind: task.requirement === "required" ? "proof" : "test",
      requiredCapabilities: ["verify:" + task.gateKind],
      effectClass: "E1",
      approved: true,
      priority: (7 - GATE_PRIORITY[task.gateKind]) * 1000 + (task.priority ?? 50)
    };
  }

  #receipt(result, task) {
    return {
      schemaVersion: VERIFICATION_SCHEDULE_SCHEMA,
      taskId: task.taskId,
      gateKind: task.gateKind,
      requirement: task.requirement,
      scheduled: result.scheduled,
      queued: result.queued,
      executed: false,
      workerId: result.workerId,
      reservationId: result.reservationId,
      endpoint: result.endpoint ?? null,
      priority: GATE_PRIORITY[task.gateKind],
      reason: result.reason
    };
  }

  status() {
    return this.#core.workerStatus().map(worker => ({
      workerId: worker.workerId,
      gates: worker.capabilities.map(c => c.slice("verify:".length)),
      inFlight: worker.inFlight,
      maxConcurrent: worker.maxConcurrent,
      available: worker.available,
      advisoryAvailable: worker.normalAvailable
    }));
  }

  eligibleWorkers(task) {
    validateVerificationTask(task);
    return this.#core.eligibleWorkers(this.#coreTask(task)).map(worker => ({
      workerId: worker.workerId,
      gates: worker.capabilities.map(c => c.slice("verify:".length)),
      maxConcurrent: worker.maxConcurrent,
      endpoint: worker.endpoint
    }));
  }

  assign(task) {
    validateVerificationTask(task);
    if (!this.#tasks.has(task.taskId)) {
      this.#tasks.set(task.taskId, {
        taskId: task.taskId,
        gateKind: task.gateKind,
        requirement: task.requirement,
        priority: task.priority ?? 50
      });
    }
    const registered = this.#tasks.get(task.taskId);
    if (registered.gateKind !== task.gateKind ||
        registered.requirement !== task.requirement) {
      throw new Error("verification task ID was reused with a different gate");
    }
    const result = this.#core.assign(this.#coreTask(registered));
    if (result.scheduled) this.#reservations.set(result.reservationId, task.taskId);
    return this.#receipt(result, registered);
  }

  release(reservationId) {
    requireId(reservationId, "reservationId");
    const completed = this.#reservations.get(reservationId);
    const result = this.#core.release(reservationId);
    if (result.released) {
      this.#reservations.delete(reservationId);
      this.#tasks.delete(completed);
    }
    const reassigned = result.reassigned.map(assignment => {
      const task = this.#tasks.get(assignment.taskId);
      this.#reservations.set(assignment.reservationId, assignment.taskId);
      return this.#receipt(assignment, task);
    });
    return { released: result.released, reservationId, reassigned };
  }

  queueStatus() {
    return this.#core.queueStatus();
  }

  scheduleBatch(tasks) {
    if (!Array.isArray(tasks)) throw new TypeError("tasks must be an array");
    for (const task of tasks) validateVerificationTask(task);
    return [...tasks].sort(order).map(task => this.assign(task));
  }
}
