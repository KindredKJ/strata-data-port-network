export const VERIFICATION_SCHEDULE_SCHEMA =
  "kindred.sdpn.verification-schedule.v1";

const GATE_PRIORITY = Object.freeze({
  provenance: 0,
  contract: 1,
  lint: 2,
  test: 3,
  build: 4,
  install: 5,
  benchmark: 6
});

export function validateVerificationWorker(worker) {
  if (!worker?.workerId) throw new Error("workerId is required");
  if (!worker.authorized) throw new Error("verification worker must be authorized");
  if (!Array.isArray(worker.gates)) {
    throw new Error("verification worker gates must be an array");
  }
  if (!Number.isSafeInteger(worker.maxConcurrent) || worker.maxConcurrent < 1) {
    throw new Error("worker maxConcurrent must be a positive integer");
  }
  return worker;
}

export function validateVerificationTask(task) {
  if (!task?.taskId) throw new Error("taskId is required");
  if (!(task.gateKind in GATE_PRIORITY)) {
    throw new Error(`unknown verification gate: ${task.gateKind}`);
  }
  if (!["required", "advisory"].includes(task.requirement)) {
    throw new Error("verification requirement must be required or advisory");
  }
  return task;
}

export class VerificationProofScheduler {
  #workers = new Map();
  #load = new Map();

  registerWorker(worker) {
    validateVerificationWorker(worker);
    this.#workers.set(worker.workerId, {
      ...worker,
      gates: [...new Set(worker.gates)].sort()
    });
    if (!this.#load.has(worker.workerId)) {
      this.#load.set(worker.workerId, 0);
    }
  }

  release(workerId) {
    const load = this.#load.get(workerId) ?? 0;
    this.#load.set(workerId, Math.max(0, load - 1));
  }

  status() {
    return [...this.#workers.values()]
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
      .map((worker) => ({
        workerId: worker.workerId,
        gates: worker.gates,
        inFlight: this.#load.get(worker.workerId) ?? 0,
        maxConcurrent: worker.maxConcurrent,
        available: (
          (this.#load.get(worker.workerId) ?? 0) < worker.maxConcurrent
        )
      }));
  }

  eligibleWorkers(task) {
    validateVerificationTask(task);
    return [...this.#workers.values()].filter((worker) => {
      const load = this.#load.get(worker.workerId) ?? 0;
      return (
        load < worker.maxConcurrent &&
        worker.gates.includes(task.gateKind)
      );
    });
  }

  assign(task) {
    const eligible = this.eligibleWorkers(task);
    if (!eligible.length) {
      return {
        schemaVersion: VERIFICATION_SCHEDULE_SCHEMA,
        taskId: task.taskId,
        gateKind: task.gateKind,
        requirement: task.requirement,
        scheduled: false,
        executed: false,
        workerId: null,
        reason: "No authorized verification worker has the gate capability and capacity."
      };
    }

    eligible.sort((a, b) => {
      const aLoad = (this.#load.get(a.workerId) ?? 0) / a.maxConcurrent;
      const bLoad = (this.#load.get(b.workerId) ?? 0) / b.maxConcurrent;
      if (aLoad !== bLoad) return aLoad - bLoad;

      const aSurplus = a.gates.length - 1;
      const bSurplus = b.gates.length - 1;
      if (aSurplus !== bSurplus) return aSurplus - bSurplus;

      return a.workerId.localeCompare(b.workerId);
    });

    const worker = eligible[0];
    this.#load.set(
      worker.workerId,
      (this.#load.get(worker.workerId) ?? 0) + 1
    );

    return {
      schemaVersion: VERIFICATION_SCHEDULE_SCHEMA,
      taskId: task.taskId,
      gateKind: task.gateKind,
      requirement: task.requirement,
      scheduled: true,
      executed: false,
      workerId: worker.workerId,
      endpoint: worker.endpoint ?? null,
      priority: GATE_PRIORITY[task.gateKind],
      reason: "Assigned to an authorized verifier by gate capability and normalized load."
    };
  }

  scheduleBatch(tasks) {
    const ordered = [...tasks].sort((a, b) => {
      validateVerificationTask(a);
      validateVerificationTask(b);

      if (a.requirement !== b.requirement) {
        return a.requirement === "required" ? -1 : 1;
      }

      const gateDelta = GATE_PRIORITY[a.gateKind] - GATE_PRIORITY[b.gateKind];
      if (gateDelta !== 0) return gateDelta;

      const priorityDelta = (b.priority ?? 50) - (a.priority ?? 50);
      if (priorityDelta !== 0) return priorityDelta;

      return a.taskId.localeCompare(b.taskId);
    });

    return ordered.map((task) => this.assign(task));
  }
}
