export const PRODUCTION_SCHEDULE_SCHEMA = "kindred.sdpn.production-schedule.v1";

const EFFECT_RANK = Object.freeze({
  E0: 0,
  E1: 1,
  E2: 2,
  E3: 3,
  E4: 4,
  E5: 5
});

const KIND_PRIORITY = Object.freeze({
  control: 0,
  proof: 1,
  test: 2,
  build: 3,
  scaffold: 4,
  bulk: 5
});

function assertEffectClass(effectClass) {
  if (!(effectClass in EFFECT_RANK)) {
    throw new Error(`unknown effect class: ${effectClass}`);
  }
}

export function validateWorker(worker) {
  if (!worker?.workerId) throw new Error("workerId is required");
  if (!worker.authorized) throw new Error("worker must be authorized");
  if (!Array.isArray(worker.capabilities)) {
    throw new Error("worker capabilities must be an array");
  }
  if (!Number.isSafeInteger(worker.maxConcurrent) || worker.maxConcurrent < 1) {
    throw new Error("worker maxConcurrent must be a positive integer");
  }
  return worker;
}

export function validateProductionTask(task) {
  if (!task?.taskId) throw new Error("taskId is required");
  if (!Array.isArray(task.requiredCapabilities)) {
    throw new Error("task requiredCapabilities must be an array");
  }
  assertEffectClass(task.effectClass);
  if (!(task.kind in KIND_PRIORITY)) {
    throw new Error(`unknown production task kind: ${task.kind}`);
  }
  return task;
}

export class ProductionCapabilityScheduler {
  #workers = new Map();
  #load = new Map();

  registerWorker(worker) {
    validateWorker(worker);
    this.#workers.set(worker.workerId, {
      ...worker,
      capabilities: [...new Set(worker.capabilities)].sort()
    });
    if (!this.#load.has(worker.workerId)) {
      this.#load.set(worker.workerId, 0);
    }
  }

  release(workerId) {
    const current = this.#load.get(workerId) ?? 0;
    this.#load.set(workerId, Math.max(0, current - 1));
  }

  workerStatus() {
    return [...this.#workers.values()]
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
      .map((worker) => ({
        workerId: worker.workerId,
        capabilities: worker.capabilities,
        maxConcurrent: worker.maxConcurrent,
        inFlight: this.#load.get(worker.workerId) ?? 0,
        available: (
          (this.#load.get(worker.workerId) ?? 0) < worker.maxConcurrent
        )
      }));
  }

  eligibleWorkers(task) {
    validateProductionTask(task);

    if (EFFECT_RANK[task.effectClass] >= EFFECT_RANK.E2 && !task.approved) {
      return [];
    }

    return [...this.#workers.values()].filter((worker) => {
      const load = this.#load.get(worker.workerId) ?? 0;
      if (load >= worker.maxConcurrent) return false;
      return task.requiredCapabilities.every(
        (capability) => worker.capabilities.includes(capability)
      );
    });
  }

  assign(task) {
    const eligible = this.eligibleWorkers(task);
    if (!eligible.length) {
      return {
        schemaVersion: PRODUCTION_SCHEDULE_SCHEMA,
        taskId: task.taskId,
        scheduled: false,
        executed: false,
        workerId: null,
        reason: (
          EFFECT_RANK[task.effectClass] >= EFFECT_RANK.E2 && !task.approved
            ? "Task requires explicit approval before scheduling."
            : "No authorized worker has the required capability and capacity."
        )
      };
    }

    eligible.sort((a, b) => {
      const loadA = (this.#load.get(a.workerId) ?? 0) / a.maxConcurrent;
      const loadB = (this.#load.get(b.workerId) ?? 0) / b.maxConcurrent;
      if (loadA !== loadB) return loadA - loadB;

      const surplusA = a.capabilities.length - task.requiredCapabilities.length;
      const surplusB = b.capabilities.length - task.requiredCapabilities.length;
      if (surplusA !== surplusB) return surplusA - surplusB;

      return a.workerId.localeCompare(b.workerId);
    });

    const selected = eligible[0];
    this.#load.set(
      selected.workerId,
      (this.#load.get(selected.workerId) ?? 0) + 1
    );

    return {
      schemaVersion: PRODUCTION_SCHEDULE_SCHEMA,
      taskId: task.taskId,
      scheduled: true,
      executed: false,
      workerId: selected.workerId,
      endpoint: selected.endpoint ?? null,
      requiredCapabilities: task.requiredCapabilities,
      effectClass: task.effectClass,
      taskKind: task.kind,
      priority: KIND_PRIORITY[task.kind],
      reason: "Assigned to an authorized worker by capability and normalized load."
    };
  }

  scheduleBatch(tasks) {
    const ordered = [...tasks].sort((a, b) => {
      validateProductionTask(a);
      validateProductionTask(b);
      const kindDelta = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
      if (kindDelta !== 0) return kindDelta;
      const priorityDelta = (b.priority ?? 50) - (a.priority ?? 50);
      if (priorityDelta !== 0) return priorityDelta;
      return a.taskId.localeCompare(b.taskId);
    });

    return ordered.map((task) => this.assign(task));
  }
}
