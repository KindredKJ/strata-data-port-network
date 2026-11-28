import { ProductionCapabilityScheduler } from "./production-capability-scheduler.mjs";

export const REPAIR_SCHEDULE_SCHEMA = "kindred.sdpn.repair-schedule.v1";

const PHASE_PRIORITY = Object.freeze({
  diagnose: 0, synthesize: 1, stage: 2,
  verify: 3, compare: 4, full_verify: 5
});
const REPAIR_PHASES = new Set(["diagnose", "synthesize", "stage", "verify", "compare"]);

function requireId(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(name + " must be a nonempty string");
  }
}

export function validateRepairWorker(worker) {
  if (!worker || typeof worker !== "object") throw new TypeError("repair worker is required");
  requireId(worker.workerId, "workerId");
  if (worker.authorized !== true) {
    throw new Error("repair worker must be explicitly authorized");
  }
  if (!Array.isArray(worker.phases) ||
      worker.phases.some(phase => !REPAIR_PHASES.has(phase))) {
    throw new Error("repair worker phases must exclude full_verify and use known local repair phases");
  }
  if (!Number.isSafeInteger(worker.maxConcurrent) || worker.maxConcurrent < 1) {
    throw new RangeError("worker maxConcurrent must be a positive integer");
  }
  if (worker.endpoint != null && typeof worker.endpoint !== "string") {
    throw new TypeError("repair worker endpoint must be a string");
  }
  return worker;
}

export function validateRepairTask(task) {
  if (!task || typeof task !== "object") throw new TypeError("repair task is required");
  requireId(task.taskId, "taskId");
  requireId(task.experimentId, "experimentId");
  if (task.candidateId != null) requireId(task.candidateId, "candidateId");
  if (!Object.hasOwn(PHASE_PRIORITY, task.phase)) {
    throw new Error("unknown repair phase: " + String(task.phase));
  }
  if (task.effectClass !== "E0" && task.effectClass !== "E1") {
    throw new Error("bounded repair scheduler only accepts E0/E1 work");
  }
  if (!Number.isSafeInteger(task.attempt) || task.attempt < 1) {
    throw new RangeError("repair task attempt must be a positive integer");
  }
  if (!Number.isSafeInteger(task.maxAttempts) || task.maxAttempts < 1) {
    throw new RangeError("repair task maxAttempts must be a positive integer");
  }
  if (task.priority !== undefined &&
      (typeof task.priority !== "number" || !Number.isFinite(task.priority))) {
    throw new TypeError("repair priority must be finite");
  }
  return task;
}

function order(a, b) {
  const phase = PHASE_PRIORITY[a.phase] - PHASE_PRIORITY[b.phase];
  if (phase) return phase;
  return (b.priority ?? 50) - (a.priority ?? 50) || a.taskId.localeCompare(b.taskId);
}

function attemptKey(task) {
  return JSON.stringify([task.experimentId, task.phase]);
}

export class RepairExperimentScheduler {
  #core;
  #budgets = new Map();
  #queuedTasks = new Map();
  #reservations = new Map();

  constructor({ maxQueued = 1024 } = {}) {
    this.#core = new ProductionCapabilityScheduler({ maxQueued });
  }

  registerWorker(worker) {
    validateRepairWorker(worker);
    this.#core.registerWorker({
      workerId: worker.workerId,
      authorized: true,
      capabilities: worker.phases.map(phase => "repair:" + phase),
      maxConcurrent: worker.maxConcurrent,
      endpoint: worker.endpoint ?? null
    });
  }

  status() {
    return this.#core.workerStatus().map(worker => ({
      workerId: worker.workerId,
      phases: worker.capabilities.map(c => c.slice("repair:".length)),
      inFlight: worker.inFlight,
      maxConcurrent: worker.maxConcurrent,
      available: worker.available
    }));
  }

  #coreTask(task) {
    return {
      taskId: task.taskId,
      kind: "proof",
      requiredCapabilities: ["repair:" + task.phase],
      effectClass: "E1",
      approved: true,
      priority: (6 - PHASE_PRIORITY[task.phase]) * 1000000 + (task.priority ?? 50)
    };
  }

  eligibleWorkers(task) {
    validateRepairTask(task);
    if (task.phase === "full_verify" || task.attempt > task.maxAttempts) return [];
    const budget = this.#budgets.get(attemptKey(task));
    if (budget && (budget.maxAttempts !== task.maxAttempts ||
        task.attempt <= budget.lastAccepted || budget.pending.size > 0)) return [];
    return this.#core.eligibleWorkers(this.#coreTask(task)).map(worker => ({
      workerId: worker.workerId,
      phases: worker.capabilities.map(c => c.slice("repair:".length)),
      maxConcurrent: worker.maxConcurrent,
      endpoint: worker.endpoint
    }));
  }

  #receipt(task, result, reason = result?.reason ?? "") {
    return {
      schemaVersion: REPAIR_SCHEDULE_SCHEMA,
      taskId: task.taskId,
      experimentId: task.experimentId,
      candidateId: task.candidateId ?? null,
      phase: task.phase,
      attempt: task.attempt,
      maxAttempts: task.maxAttempts,
      priority: PHASE_PRIORITY[task.phase],
      scheduled: result?.scheduled ?? false,
      queued: result?.queued ?? false,
      executed: false,
      workerId: result?.workerId ?? null,
      reservationId: result?.reservationId ?? null,
      endpoint: result?.endpoint ?? null,
      reason
    };
  }

  assign(task) {
    validateRepairTask(task);
    if (task.phase === "full_verify") {
      return this.#receipt(task, null,
        "Independent VerificationProofScheduler must schedule full verification.");
    }
    const key = attemptKey(task);
    const existing = this.#budgets.get(key);
    if (existing && task.maxAttempts !== existing.maxAttempts) {
      return this.#receipt(task, null, "Attempt budget is pinned and cannot be changed.");
    }
    if (task.attempt > task.maxAttempts) {
      return this.#receipt(task, null, "Repair attempt budget exhausted.");
    }
    if (existing && task.attempt <= existing.lastAccepted) {
      return this.#receipt(task, null, "Stale or duplicate accepted repair attempt rejected.");
    }
    if (existing && existing.pending.size) {
      return this.#receipt(task, null, "Previous repair attempt is still queued.");
    }

    const snapshot = {
      taskId: task.taskId,
      experimentId: task.experimentId,
      candidateId: task.candidateId ?? null,
      phase: task.phase,
      effectClass: task.effectClass,
      attempt: task.attempt,
      maxAttempts: task.maxAttempts,
      priority: task.priority ?? 50
    };
    const result = this.#core.assign(this.#coreTask(snapshot));
    if (result.scheduled || result.queued) {
      const budget = existing ?? { maxAttempts: task.maxAttempts, lastAccepted: 0, pending: new Set() };
      if (!existing) this.#budgets.set(key, budget);
      if (result.scheduled) {
        budget.lastAccepted = task.attempt;
        this.#reservations.set(result.reservationId, snapshot);
      } else {
        budget.pending.add(task.attempt);
        this.#queuedTasks.set(task.taskId, snapshot);
      }
    }
    return this.#receipt(snapshot, result);
  }

  release(reservationId) {
    requireId(reservationId, "reservationId");
    const current = this.#reservations.get(reservationId);
    const result = this.#core.release(reservationId);
    if (result.released) this.#reservations.delete(reservationId);
    const reassigned = result.reassigned.map(assignment => {
      const task = this.#queuedTasks.get(assignment.taskId);
      if (!task) throw new Error("unrecognized repair queue assignment");
      this.#queuedTasks.delete(task.taskId);
      const budget = this.#budgets.get(attemptKey(task));
      budget.pending.delete(task.attempt);
      budget.lastAccepted = task.attempt;
      this.#reservations.set(assignment.reservationId, task);
      return this.#receipt(task, assignment);
    });
    return {
      released: result.released,
      reservationId,
      completedTaskId: result.released ? current?.taskId ?? null : null,
      reassigned
    };
  }

  queueStatus() {
    return this.#core.queueStatus();
  }

  attemptStatus(experimentId, phase) {
    requireId(experimentId, "experimentId");
    if (!Object.hasOwn(PHASE_PRIORITY, phase)) throw new Error("unknown repair phase");
    const budget = this.#budgets.get(JSON.stringify([experimentId, phase]));
    return budget ? {
      maxAttempts: budget.maxAttempts,
      lastAccepted: budget.lastAccepted,
      pending: [...budget.pending].sort((a, b) => a - b)
    } : null;
  }

  scheduleBatch(tasks) {
    if (!Array.isArray(tasks)) throw new TypeError("tasks must be an array");
    for (const task of tasks) validateRepairTask(task);
    return [...tasks].sort(order).map(task => this.assign(task));
  }
}
