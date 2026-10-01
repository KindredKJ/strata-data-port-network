export const REPAIR_SCHEDULE_SCHEMA =
  "kindred.sdpn.repair-schedule.v1";

const PHASE_PRIORITY = Object.freeze({
  diagnose: 0,
  synthesize: 1,
  stage: 2,
  verify: 3,
  compare: 4,
  full_verify: 5
});

export function validateRepairWorker(worker) {
  if (!worker?.workerId) throw new Error("workerId is required");
  if (!worker.authorized) throw new Error("repair worker must be authorized");
  if (!Array.isArray(worker.phases)) {
    throw new Error("repair worker phases must be an array");
  }
  if (!Number.isSafeInteger(worker.maxConcurrent) || worker.maxConcurrent < 1) {
    throw new Error("worker maxConcurrent must be a positive integer");
  }
  return worker;
}

export function validateRepairTask(task) {
  if (!task?.taskId) throw new Error("taskId is required");
  if (!task?.experimentId) throw new Error("experimentId is required");
  if (!(task.phase in PHASE_PRIORITY)) {
    throw new Error(`unknown repair phase: ${task.phase}`);
  }
  if (!["E0", "E1"].includes(task.effectClass)) {
    throw new Error("bounded repair scheduler only accepts E0/E1 work");
  }
  if (!Number.isSafeInteger(task.attempt) || task.attempt < 1) {
    throw new Error("repair task attempt must be a positive integer");
  }
  if (!Number.isSafeInteger(task.maxAttempts) || task.maxAttempts < 1) {
    throw new Error("repair task maxAttempts must be a positive integer");
  }
  return task;
}

export class RepairExperimentScheduler {
  #workers = new Map();
  #load = new Map();
  #attempts = new Map();

  registerWorker(worker) {
    validateRepairWorker(worker);
    this.#workers.set(worker.workerId, {
      ...worker,
      phases: [...new Set(worker.phases)].sort()
    });
    if (!this.#load.has(worker.workerId)) {
      this.#load.set(worker.workerId, 0);
    }
  }

  release(workerId) {
    const current = this.#load.get(workerId) ?? 0;
    this.#load.set(workerId, Math.max(0, current - 1));
  }

  status() {
    return [...this.#workers.values()]
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
      .map((worker) => ({
        workerId: worker.workerId,
        phases: worker.phases,
        inFlight: this.#load.get(worker.workerId) ?? 0,
        maxConcurrent: worker.maxConcurrent,
        available: (
          (this.#load.get(worker.workerId) ?? 0) < worker.maxConcurrent
        )
      }));
  }

  eligibleWorkers(task) {
    validateRepairTask(task);
    if (task.attempt > task.maxAttempts) return [];

    return [...this.#workers.values()].filter((worker) => {
      const load = this.#load.get(worker.workerId) ?? 0;
      return (
        load < worker.maxConcurrent &&
        worker.phases.includes(task.phase)
      );
    });
  }

  assign(task) {
    validateRepairTask(task);

    const attemptKey = `${task.experimentId}|${task.phase}`;
    const observedAttempt = this.#attempts.get(attemptKey) ?? 0;
    if (task.attempt < observedAttempt) {
      return {
        schemaVersion: REPAIR_SCHEDULE_SCHEMA,
        taskId: task.taskId,
        experimentId: task.experimentId,
        phase: task.phase,
        scheduled: false,
        executed: false,
        workerId: null,
        reason: "Stale repair attempt rejected."
      };
    }

    if (task.attempt > task.maxAttempts) {
      return {
        schemaVersion: REPAIR_SCHEDULE_SCHEMA,
        taskId: task.taskId,
        experimentId: task.experimentId,
        phase: task.phase,
        scheduled: false,
        executed: false,
        workerId: null,
        reason: "Repair attempt budget exhausted."
      };
    }

    const eligible = this.eligibleWorkers(task);
    if (!eligible.length) {
      return {
        schemaVersion: REPAIR_SCHEDULE_SCHEMA,
        taskId: task.taskId,
        experimentId: task.experimentId,
        phase: task.phase,
        scheduled: false,
        executed: false,
        workerId: null,
        reason: "No authorized repair worker has the required phase and capacity."
      };
    }

    eligible.sort((a, b) => {
      const loadA = (this.#load.get(a.workerId) ?? 0) / a.maxConcurrent;
      const loadB = (this.#load.get(b.workerId) ?? 0) / b.maxConcurrent;
      if (loadA !== loadB) return loadA - loadB;

      const surplusA = a.phases.length - 1;
      const surplusB = b.phases.length - 1;
      if (surplusA !== surplusB) return surplusA - surplusB;

      return a.workerId.localeCompare(b.workerId);
    });

    const selected = eligible[0];
    this.#load.set(
      selected.workerId,
      (this.#load.get(selected.workerId) ?? 0) + 1
    );
    this.#attempts.set(attemptKey, task.attempt);

    return {
      schemaVersion: REPAIR_SCHEDULE_SCHEMA,
      taskId: task.taskId,
      experimentId: task.experimentId,
      candidateId: task.candidateId ?? null,
      phase: task.phase,
      attempt: task.attempt,
      maxAttempts: task.maxAttempts,
      priority: PHASE_PRIORITY[task.phase],
      scheduled: true,
      executed: false,
      workerId: selected.workerId,
      endpoint: selected.endpoint ?? null,
      reason: "Assigned by repair phase, attempt budget, and normalized worker load."
    };
  }

  scheduleBatch(tasks) {
    const ordered = [...tasks].sort((a, b) => {
      validateRepairTask(a);
      validateRepairTask(b);

      const phaseDelta = PHASE_PRIORITY[a.phase] - PHASE_PRIORITY[b.phase];
      if (phaseDelta !== 0) return phaseDelta;

      const priorityDelta = (b.priority ?? 50) - (a.priority ?? 50);
      if (priorityDelta !== 0) return priorityDelta;

      return a.taskId.localeCompare(b.taskId);
    });
    return ordered.map((task) => this.assign(task));
  }
}
