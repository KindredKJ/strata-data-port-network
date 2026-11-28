import { randomUUID } from "node:crypto";

export const PRODUCTION_SCHEDULE_SCHEMA = "kindred.sdpn.production-schedule.v1";

const EFFECT_RANK = Object.freeze({ E0: 0, E1: 1, E2: 2, E3: 3, E4: 4, E5: 5 });
const KIND_PRIORITY = Object.freeze({
  control: 0, proof: 1, test: 2, build: 3, scaffold: 4, bulk: 5
});

function requireId(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(name + " must be a nonempty string");
  }
}

function requireCapabilities(value, name) {
  if (!Array.isArray(value) || value.some(x => typeof x !== "string" || !x.trim())) {
    throw new TypeError(name + " must be an array of nonempty strings");
  }
}

export function validateWorker(worker) {
  if (!worker || typeof worker !== "object") throw new TypeError("worker is required");
  requireId(worker.workerId, "workerId");
  if (worker.authorized !== true) throw new Error("worker must be explicitly authorized");
  requireCapabilities(worker.capabilities, "worker capabilities");
  if (!Number.isSafeInteger(worker.maxConcurrent) || worker.maxConcurrent < 1) {
    throw new RangeError("worker maxConcurrent must be a positive integer");
  }
  if (worker.endpoint != null && typeof worker.endpoint !== "string") {
    throw new TypeError("worker endpoint must be a string");
  }
  return worker;
}

export function validateProductionTask(task) {
  if (!task || typeof task !== "object") throw new TypeError("task is required");
  requireId(task.taskId, "taskId");
  requireCapabilities(task.requiredCapabilities, "task requiredCapabilities");
  if (!Object.hasOwn(EFFECT_RANK, task.effectClass)) {
    throw new Error("unknown effect class: " + String(task.effectClass));
  }
  if (!Object.hasOwn(KIND_PRIORITY, task.kind)) {
    throw new Error("unknown production task kind: " + String(task.kind));
  }
  if (task.priority !== undefined &&
      (typeof task.priority !== "number" || !Number.isFinite(task.priority))) {
    throw new TypeError("task priority must be a finite number");
  }
  return task;
}

function taskOrder(a, b) {
  const kindDelta = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
  if (kindDelta) return kindDelta;
  const priorityDelta = (b.priority ?? 50) - (a.priority ?? 50);
  return priorityDelta || a.taskId.localeCompare(b.taskId);
}

function approved(task) {
  return EFFECT_RANK[task.effectClass] < EFFECT_RANK.E2 || task.approved === true;
}

function highPriority(task) {
  return task.kind === "control" || task.kind === "proof";
}

export class ProductionCapabilityScheduler {
  #workers = new Map();
  #load = new Map();
  #reservations = new Map();
  #activeTaskIds = new Set();
  #queued = new Map();
  #maxQueued;

  constructor({ maxQueued = 1024 } = {}) {
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 1) {
      throw new RangeError("maxQueued must be a positive integer");
    }
    this.#maxQueued = maxQueued;
  }

  registerWorker(worker) {
    validateWorker(worker);
    if ([...this.#reservations.values()].some(r => r.workerId === worker.workerId)) {
      throw new Error("cannot replace worker while assignments are active");
    }
    this.#workers.set(worker.workerId, {
      workerId: worker.workerId,
      authorized: true,
      capabilities: [...new Set(worker.capabilities)].sort(),
      maxConcurrent: worker.maxConcurrent,
      endpoint: worker.endpoint ?? null
    });
    this.#load.set(worker.workerId, 0);
  }

  workerStatus() {
    return [...this.#workers.values()]
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
      .map(worker => {
        const inFlight = this.#load.get(worker.workerId) ?? 0;
        return {
          workerId: worker.workerId,
          capabilities: [...worker.capabilities],
          maxConcurrent: worker.maxConcurrent,
          inFlight,
          available: inFlight < worker.maxConcurrent,
          normalAvailable: inFlight < (worker.maxConcurrent > 1 ? worker.maxConcurrent - 1 : 1)
        };
      });
  }

  #candidateWorkers(task) {
    if (!approved(task)) return [];
    return [...this.#workers.values()].filter(worker => {
      const inFlight = this.#load.get(worker.workerId) ?? 0;
      const limit = highPriority(task)
        ? worker.maxConcurrent
        : worker.maxConcurrent > 1 ? worker.maxConcurrent - 1 : worker.maxConcurrent;
      return inFlight < limit && task.requiredCapabilities.every(c => worker.capabilities.includes(c));
    });
  }

  eligibleWorkers(task) {
    validateProductionTask(task);
    return this.#candidateWorkers(task).map(worker => ({
      workerId: worker.workerId,
      authorized: worker.authorized,
      capabilities: [...worker.capabilities],
      maxConcurrent: worker.maxConcurrent,
      endpoint: worker.endpoint
    }));
  }

  #allocate(task) {
    const eligible = this.#candidateWorkers(task);
    if (!eligible.length) return null;
    eligible.sort((a, b) => {
      const aLoad = (this.#load.get(a.workerId) ?? 0) / a.maxConcurrent;
      const bLoad = (this.#load.get(b.workerId) ?? 0) / b.maxConcurrent;
      if (aLoad !== bLoad) return aLoad - bLoad;
      const aSurplus = a.capabilities.length - task.requiredCapabilities.length;
      const bSurplus = b.capabilities.length - task.requiredCapabilities.length;
      return aSurplus - bSurplus || a.workerId.localeCompare(b.workerId);
    });
    const selected = eligible[0];
    const reservationId = randomUUID();
    this.#reservations.set(reservationId, {
      workerId: selected.workerId, taskId: task.taskId
    });
    this.#activeTaskIds.add(task.taskId);
    this.#load.set(selected.workerId, (this.#load.get(selected.workerId) ?? 0) + 1);
    return {
      schemaVersion: PRODUCTION_SCHEDULE_SCHEMA,
      taskId: task.taskId,
      scheduled: true,
      queued: false,
      executed: false,
      reservationId,
      workerId: selected.workerId,
      endpoint: selected.endpoint,
      requiredCapabilities: [...task.requiredCapabilities],
      effectClass: task.effectClass,
      taskKind: task.kind,
      priority: KIND_PRIORITY[task.kind],
      reason: "Assigned to an authorized capable worker; execution not implied."
    };
  }

  assign(task) {
    validateProductionTask(task);
    if (!approved(task)) return {
      schemaVersion: PRODUCTION_SCHEDULE_SCHEMA,
      taskId: task.taskId, scheduled: false, queued: false, executed: false,
      reservationId: null, workerId: null,
      reason: "Task requires explicit approval before scheduling."
    };
    if (this.#activeTaskIds.has(task.taskId) || this.#queued.has(task.taskId)) {
      return {
        schemaVersion: PRODUCTION_SCHEDULE_SCHEMA,
        taskId: task.taskId, scheduled: false, queued: this.#queued.has(task.taskId),
        executed: false, reservationId: null, workerId: null,
        reason: "Task already assigned or queued."
      };
    }
    const snapshot = {
      taskId: task.taskId, kind: task.kind,
      effectClass: task.effectClass, approved: task.approved === true,
      requiredCapabilities: [...task.requiredCapabilities],
      priority: task.priority ?? 50
    };
    const assigned = this.#allocate(snapshot);
    if (assigned) return assigned;
    if (this.#queued.size >= this.#maxQueued) {
      return {
        schemaVersion: PRODUCTION_SCHEDULE_SCHEMA,
        taskId: task.taskId, scheduled: false, queued: false,
        executed: false, reservationId: null, workerId: null,
        reason: "Scheduler's bounded waiting queue is full."
      };
    }
    this.#queued.set(task.taskId, snapshot);
    return {
      schemaVersion: PRODUCTION_SCHEDULE_SCHEMA,
      taskId: task.taskId, scheduled: false, queued: true,
      executed: false, reservationId: null, workerId: null,
      reason: "Queued for the next authorized capable worker slot."
    };
  }

  release(reservationId) {
    requireId(reservationId, "reservationId");
    const reservation = this.#reservations.get(reservationId);
    if (!reservation) return { released: false, reassigned: [] };
    this.#reservations.delete(reservationId);
    this.#activeTaskIds.delete(reservation.taskId);
    const current = this.#load.get(reservation.workerId) ?? 0;
    this.#load.set(reservation.workerId, Math.max(0, current - 1));
    const reassigned = [];
    for (const task of [...this.#queued.values()].sort(taskOrder)) {
      const assigned = this.#allocate(task);
      if (assigned) {
        this.#queued.delete(task.taskId);
        reassigned.push(assigned);
      }
    }
    return { released: true, reservationId, reassigned };
  }

  queueStatus() {
    return {
      queued: this.#queued.size,
      maxQueued: this.#maxQueued,
      tasks: [...this.#queued.values()].sort(taskOrder).map(t => t.taskId)
    };
  }

  scheduleBatch(tasks) {
    if (!Array.isArray(tasks)) throw new TypeError("tasks must be an array");
    for (const task of tasks) validateProductionTask(task);
    return [...tasks].sort(taskOrder).map(task => this.assign(task));
  }
}
