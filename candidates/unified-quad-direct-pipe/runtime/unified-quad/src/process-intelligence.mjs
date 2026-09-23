import { createHash, randomUUID } from "node:crypto";

export const PROCESS_GENOME_CONTRACT_VERSION = "kindred.process-genome.v1";
export const EDGE_SUCCESS_CONTRACT_VERSION = "kindred.process-edge-success.v1";
export const PROCESS_SKILL_CONTRACT_VERSION = "kindred.process-skill.v1";
export const PROSYNTHESIZED_CAPABILITY_CONTRACT_VERSION =
  "kindred.prosynthesized-capability.v1";
export const SYNTHESIS_RECEIPT_CONTRACT_VERSION =
  "kindred.prosynthesine-receipt.v1";
export const PROCESS_FITNESS_DELTA_CONTRACT_VERSION =
  "kindred.process-fitness-delta.v1";
export const PROCESS_INTELLIGENCE_BOUNDARY_CONTRACT_VERSION =
  "kindred.process-intelligence-boundary.v1";
export const PROCESS_INTELLIGENCE_EVENT_CONTRACT_VERSION =
  "kindred.process-intelligence-event.v1";
export const STRATA_PROCESS_COMMITMENT_CONTRACT_VERSION =
  "kindred.strata-process-commitment-adapter.v1";

export const PROCESS_PORT_TYPES = Object.freeze({
  PROCESS: "PROCESS_PORT",
  PROCESS_SKILL: "PROCESS_SKILL_PORT",
  PROSYNTHESIZED_CAPABILITY: "CAPABILITY_PORT",
  POST_SYNTHESIZED_CAPABILITY: "DYNAMIC_CAPABILITY_PORT",
});

export const PROCESS_INTELLIGENCE_REQUEST_TYPES = Object.freeze([
  "DISCOVER_PROCESS_SKILLS",
  "DISCOVER_PROSYNTHESIZED_CAPABILITY",
  "REQUEST_PROSYNTHESINE_CANDIDATE",
  "EXECUTE_CAPABILITY",
  "REQUEST_POST_SYNTHESIS_RECOMPOSITION",
]);

export const STRATA_PROCESS_COMMITMENT_KINDS = Object.freeze([
  "PROCESS_GENOME",
  "PROCESS_SKILL",
  "PROSYNTHESIZED_CAPABILITY",
  "POST_SYNTHESIS_CHECKPOINT",
  "PROCESS_FITNESS_DELTA",
  "PROCESS_EDGE_EVIDENCE",
]);

const capabilityStates = new Set([
  "CANDIDATE",
  "TESTING",
  "VERIFIED",
  "PROSYNTHESIZED",
  "DEPRECATED",
  "QUARANTINED",
]);
const compositionKinds = new Set([
  "SEQUENTIAL",
  "PARALLEL",
  "FAN_OUT",
  "FAN_IN",
  "CONDITIONAL",
  "ITERATIVE",
  "COMPETITIVE",
  "COOPERATIVE",
  "HIERARCHICAL",
  "EVENT_DRIVEN",
]);

export class ProcessIntelligenceError extends Error {
  constructor(reasonClass, message = "Process intelligence operation rejected.") {
    super(message);
    this.name = "ProcessIntelligenceError";
    this.code = "process_intelligence_rejected";
    this.reasonClass = reasonClass;
    this.retryable = false;
  }
}

function reject(reasonClass, message) {
  throw new ProcessIntelligenceError(reasonClass, message);
}

function clone(value) {
  return structuredClone(value);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stateRoot(label, value) {
  return `sha256:${createHash("sha256")
    .update(`${label}:${canonical(value)}`)
    .digest("hex")}`;
}

function iso(value, reasonClass) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    reject(reasonClass);
  }
  return value;
}

function nonEmpty(value, reasonClass) {
  if (typeof value !== "string" || value.trim().length === 0) reject(reasonClass);
  return value;
}

function stringArray(value, reasonClass, maximum = 128) {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0) ||
    new Set(value).size !== value.length
  ) {
    reject(reasonClass);
  }
  return [...value];
}

export function validateProcessGenome(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("process_genome_invalid");
  }
  const requiredObjects = [
    "input_contract",
    "output_contract",
    "state_requirements",
    "execution_topology",
    "authority_requirements",
    "verification_requirements",
    "retry_policy",
    "rollback_policy",
    "timing_profile",
    "latency_profile",
    "resource_profile",
    "cost_profile",
    "security_profile",
    "edge_metrics",
    "lineage",
  ];
  if (
    value.contract_version !== PROCESS_GENOME_CONTRACT_VERSION ||
    !requiredObjects.every(
      (field) =>
        value[field] && typeof value[field] === "object" && !Array.isArray(value[field]),
    ) ||
    !Number.isSafeInteger(value.process_version) ||
    value.process_version < 1 ||
    !Number.isSafeInteger(value.genome_version) ||
    value.genome_version < 1
  ) {
    reject("process_genome_invalid");
  }
  for (const field of ["process_id", "role", "purpose", "consequence_class"])
    nonEmpty(value[field], "process_genome_invalid");
  for (const field of [
    "preconditions",
    "postconditions",
    "dependencies",
    "abilities",
    "model_requirements",
    "provider_requirements",
    "success_criteria",
    "failure_criteria",
    "performance_history_refs",
    "evidence_refs",
    "receipt_refs",
    "parent_process_refs",
  ])
    stringArray(value[field], "process_genome_invalid");
  iso(value.created_at, "process_genome_invalid");
  iso(value.updated_at, "process_genome_invalid");
  nonEmpty(value.skill_status, "process_genome_invalid");
  nonEmpty(value.graduation_status, "process_genome_invalid");
  return clone(value);
}

export function createProcessGenome(input) {
  const now = input.created_at ?? new Date().toISOString();
  return validateProcessGenome({
    contract_version: PROCESS_GENOME_CONTRACT_VERSION,
    process_id: input.process_id,
    process_version: input.process_version ?? 1,
    genome_version: input.genome_version ?? 1,
    role: input.role,
    purpose: input.purpose,
    input_contract: input.input_contract ?? {},
    output_contract: input.output_contract ?? {},
    preconditions: input.preconditions ?? [],
    postconditions: input.postconditions ?? [],
    state_requirements: input.state_requirements ?? {},
    execution_topology: input.execution_topology ?? { kind: "SINGLE" },
    dependencies: input.dependencies ?? [],
    abilities: input.abilities ?? [],
    model_requirements: input.model_requirements ?? [],
    provider_requirements: input.provider_requirements ?? [],
    authority_requirements: input.authority_requirements ?? { level: "none" },
    consequence_class: input.consequence_class ?? "local_reversible",
    verification_requirements: input.verification_requirements ?? {
      required: true,
    },
    success_criteria: input.success_criteria ?? [],
    failure_criteria: input.failure_criteria ?? [],
    retry_policy: input.retry_policy ?? { maximum: 0 },
    rollback_policy: input.rollback_policy ?? { mode: "none_required" },
    timing_profile: input.timing_profile ?? {},
    latency_profile: input.latency_profile ?? {},
    resource_profile: input.resource_profile ?? {},
    cost_profile: input.cost_profile ?? {},
    security_profile: input.security_profile ?? { secrets: "forbidden" },
    edge_metrics: input.edge_metrics ?? {},
    performance_history_refs: input.performance_history_refs ?? [],
    evidence_refs: input.evidence_refs ?? [],
    receipt_refs: input.receipt_refs ?? [],
    parent_process_refs: input.parent_process_refs ?? [],
    lineage: input.lineage ?? { root_process_id: input.process_id },
    skill_status: input.skill_status ?? "PROCESS",
    graduation_status: input.graduation_status ?? "NOT_ELIGIBLE",
    created_at: now,
    updated_at: input.updated_at ?? now,
  });
}

export function evolveProcessGenome(current, changes) {
  const genome = validateProcessGenome(current);
  if (changes.role !== undefined && changes.role !== genome.role) {
    reject("process_role_change_requires_new_lineage");
  }
  if (
    changes.process_id !== undefined &&
    changes.process_id !== genome.process_id
  ) {
    reject("process_identity_change_requires_new_lineage");
  }
  return validateProcessGenome({
    ...genome,
    ...clone(changes),
    process_id: genome.process_id,
    role: genome.role,
    genome_version: genome.genome_version + 1,
    updated_at: changes.updated_at ?? new Date().toISOString(),
  });
}

function safeExecutionId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export class ProcessEdgeObserver {
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.records = [];
    this.listeners = new Set();
  }

  subscribe(listener) {
    if (typeof listener !== "function") reject("edge_listener_invalid");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  observe(input) {
    const start = Number(input.start_time ?? this.now());
    const end = Number(input.end_time ?? this.now());
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      reject("edge_time_invalid");
    }
    if (input.hidden_reasoning !== undefined || input.chain_of_thought !== undefined) {
      reject("hidden_reasoning_forbidden");
    }
    const record = Object.freeze({
      contract_version: EDGE_SUCCESS_CONTRACT_VERSION,
      edge_execution_id: input.edge_execution_id ?? safeExecutionId("edge"),
      correlation_id: nonEmpty(input.correlation_id, "edge_identity_invalid"),
      source_component: nonEmpty(input.source_component, "edge_identity_invalid"),
      target_component: nonEmpty(input.target_component, "edge_identity_invalid"),
      source_role: nonEmpty(input.source_role, "edge_identity_invalid"),
      target_role: nonEmpty(input.target_role, "edge_identity_invalid"),
      process_id: input.process_id ?? null,
      skill_id: input.skill_id ?? null,
      capability_id: input.capability_id ?? null,
      input_state_root: nonEmpty(input.input_state_root, "edge_state_invalid"),
      output_state_root: nonEmpty(input.output_state_root, "edge_state_invalid"),
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      latency: end - start,
      resource_use: clone(input.resource_use ?? {}),
      cost: input.cost ?? null,
      success: input.success === true,
      verified: input.verified === true,
      evidence_refs: stringArray(input.evidence_refs ?? [], "edge_evidence_invalid"),
      verification_refs: stringArray(
        input.verification_refs ?? [],
        "edge_evidence_invalid",
      ),
      retry_count: input.retry_count ?? 0,
      fallback_count: input.fallback_count ?? 0,
      error_class: input.error_class ?? null,
      context_ref: input.context_ref ?? null,
      authority_ref: input.authority_ref ?? null,
      receipt_ref: input.receipt_ref ?? null,
      contribution: input.contribution ?? "EXECUTION",
    });
    if (
      !Number.isSafeInteger(record.retry_count) ||
      record.retry_count < 0 ||
      !Number.isSafeInteger(record.fallback_count) ||
      record.fallback_count < 0
    ) {
      reject("edge_counts_invalid");
    }
    this.records.push(record);
    for (const listener of this.listeners) listener(clone(record));
    return clone(record);
  }

  fitness(filter = {}) {
    const selected = this.records.filter((record) =>
      Object.entries(filter).every(([key, value]) => record[key] === value),
    );
    const count = selected.length;
    const verifiedSuccesses = selected.filter(
      (record) => record.success && record.verified,
    ).length;
    const failures = selected.filter((record) => !record.success).length;
    const recovered = selected.filter(
      (record) => record.success && record.fallback_count > 0,
    ).length;
    return {
      executions: count,
      verified_success_rate: count === 0 ? 0 : verifiedSuccesses / count,
      reliability: count === 0 ? 0 : (count - failures) / count,
      mean_latency:
        count === 0
          ? 0
          : selected.reduce((sum, record) => sum + record.latency, 0) / count,
      mean_cost:
        count === 0
          ? 0
          : selected.reduce((sum, record) => sum + (record.cost ?? 0), 0) / count,
      retries: selected.reduce((sum, record) => sum + record.retry_count, 0),
      failure_rate: count === 0 ? 0 : failures / count,
      recovery_rate: failures === 0 ? 0 : recovered / failures,
      verification_strength:
        count === 0
          ? 0
          : selected.filter((record) => record.verified).length / count,
      context_fit: count === 0 ? 0 : verifiedSuccesses / count,
    };
  }

  credit(correlationId) {
    return this.records
      .filter((record) => record.correlation_id === correlationId)
      .map((record) => ({
        edge_execution_id: record.edge_execution_id,
        process_id: record.process_id,
        contribution: record.contribution,
        reinforcement:
          !record.success
            ? -1
            : record.contribution === "RECOVERY"
              ? 1.5
              : record.contribution === "VERIFICATION"
                ? 1.25
                : record.verified
                  ? 1
                  : 0.25,
        evidence_refs: [...record.evidence_refs, ...record.verification_refs],
      }));
  }
}

export class ProcessFitnessTracker {
  constructor(observer) {
    if (!(observer instanceof ProcessEdgeObserver)) reject("edge_observer_required");
    this.observer = observer;
  }

  profile(processId, contextRef = undefined) {
    const filter = { process_id: processId };
    if (contextRef !== undefined) filter.context_ref = contextRef;
    return this.observer.fitness(filter);
  }

  delta(processId, baseFitnessRoot, priorProfile = {}) {
    const profile = this.profile(processId);
    const delta = {
      contract_version: PROCESS_FITNESS_DELTA_CONTRACT_VERSION,
      delta_id: safeExecutionId("fitness-delta"),
      process_id: processId,
      skill_id: null,
      base_fitness_root: baseFitnessRoot,
      context_class: "deterministic_local",
      new_executions: profile.executions - (priorProfile.executions ?? 0),
      verified_successes: Math.round(
        profile.verified_success_rate * profile.executions,
      ),
      verified_failures: Math.round(profile.failure_rate * profile.executions),
      latency_delta: profile.mean_latency - (priorProfile.mean_latency ?? 0),
      cost_delta: profile.mean_cost - (priorProfile.mean_cost ?? 0),
      recovery_delta: profile.recovery_rate - (priorProfile.recovery_rate ?? 0),
      evidence_refs: this.observer.records
        .filter((record) => record.process_id === processId)
        .flatMap((record) => record.evidence_refs),
      verification_refs: this.observer.records
        .filter((record) => record.process_id === processId)
        .flatMap((record) => record.verification_refs),
      created_at: new Date(this.observer.now()).toISOString(),
    };
    return { ...delta, result_fitness_root: stateRoot("process-fitness", delta) };
  }
}

export class ProcessSkillGraduationPolicy {
  constructor(thresholds = {}) {
    this.thresholds = Object.freeze({
      execution_count: thresholds.execution_count ?? 3,
      verified_success_count: thresholds.verified_success_count ?? 3,
      success_rate: thresholds.success_rate ?? 1,
      verification_rate: thresholds.verification_rate ?? 1,
      maximum_authority_violations: thresholds.maximum_authority_violations ?? 0,
      maximum_security_failures: thresholds.maximum_security_failures ?? 0,
    });
  }

  evaluate(evidence) {
    const reasons = [];
    const checks = [
      ["execution_count", evidence.execution_count],
      ["verified_success_count", evidence.verified_success_count],
      ["success_rate", evidence.success_rate],
      ["verification_rate", evidence.verification_rate],
    ];
    for (const [name, actual] of checks) {
      if (actual < this.thresholds[name]) reasons.push(`${name}_below_threshold`);
    }
    if (
      (evidence.authority_violations ?? 0) >
      this.thresholds.maximum_authority_violations
    )
      reasons.push("authority_violations_exceeded");
    if (
      (evidence.security_failures ?? 0) > this.thresholds.maximum_security_failures
    )
      reasons.push("security_failures_exceeded");
    return { eligible: reasons.length === 0, reasons, thresholds: this.thresholds };
  }
}

export class ProcessSkillRegistry {
  constructor(policy = new ProcessSkillGraduationPolicy()) {
    this.policy = policy;
    this.skills = new Map();
  }

  graduate(genomeInput, evidence) {
    const genome = validateProcessGenome(genomeInput);
    const decision = this.policy.evaluate(evidence);
    if (!decision.eligible) reject("process_skill_graduation_denied");
    const skill = Object.freeze({
      contract_version: PROCESS_SKILL_CONTRACT_VERSION,
      skill_id: `kindred.process-skill.${genome.process_id}.v${genome.process_version}`,
      source_process_id: genome.process_id,
      genome_ref: stateRoot("process-genome", genome),
      skill_version: genome.process_version,
      role: genome.role,
      fitness_profile: clone(evidence),
      supported_contexts: stringArray(
        evidence.supported_contexts ?? ["deterministic_local"],
        "skill_context_invalid",
      ),
      known_limitations: stringArray(
        evidence.known_limitations ?? [],
        "skill_limitations_invalid",
      ),
      verification_profile: {
        verified_success_count: evidence.verified_success_count,
        verification_rate: evidence.verification_rate,
      },
      lineage: clone(genome.lineage),
      evidence_refs: stringArray(evidence.evidence_refs ?? [], "skill_evidence_invalid"),
    });
    this.skills.set(skill.skill_id, skill);
    return clone(skill);
  }

  get(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) reject("process_skill_unknown");
    return clone(skill);
  }
}

export class ProcessSkillCache {
  constructor(registry) {
    if (!(registry instanceof ProcessSkillRegistry)) reject("process_skill_registry_required");
    this.registry = registry;
    this.hits = 0;
    this.misses = 0;
  }

  get(skillId) {
    try {
      const skill = this.registry.get(skillId);
      this.hits += 1;
      return skill;
    } catch (error) {
      if (error instanceof ProcessIntelligenceError) this.misses += 1;
      throw error;
    }
  }
}

export class CapabilityCompositionCache {
  constructor() {
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  key(intentClass, contextRoot) {
    return stateRoot("capability-composition-cache-key", { intentClass, contextRoot });
  }

  get(intentClass, contextRoot) {
    const entry = this.entries.get(this.key(intentClass, contextRoot));
    if (!entry) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return clone(entry);
  }

  set(intentClass, contextRoot, capability) {
    this.entries.set(this.key(intentClass, contextRoot), clone(capability));
  }
}

export class ProSynthesine {
  constructor(options = {}) {
    this.registry = options.registry;
    this.cache = options.cache ?? new CapabilityCompositionCache();
    this.discoveryCount = 0;
  }

  synthesize(input) {
    const cached = this.cache.get(input.intent_class, input.context_root);
    if (cached) return { capability: cached, cache_hit: true, discovery_count: 0 };
    if (!(this.registry instanceof ProcessSkillRegistry)) {
      reject("process_skill_registry_required");
    }
    if (!compositionKinds.has(input.composition_kind)) {
      reject("composition_kind_invalid");
    }
    const skills = input.skill_ids.map((skillId) => this.registry.get(skillId));
    if (skills.length < 2) reject("prosynthesis_requires_multiple_skills");
    this.discoveryCount += skills.length;
    const graph = {
      kind: input.composition_kind,
      nodes: skills.map((skill, index) => ({
        node_id: `node-${index + 1}`,
        skill_id: skill.skill_id,
        role: skill.role,
      })),
      edges: skills.slice(1).map((skill, index) => ({
        from: `node-${index + 1}`,
        to: `node-${index + 2}`,
      })),
    };
    const candidate = {
      contract_version: PROSYNTHESIZED_CAPABILITY_CONTRACT_VERSION,
      capability_id: input.capability_id,
      capability_version: input.capability_version ?? 1,
      name: input.name,
      role: input.role,
      outcome_class: input.outcome_class,
      source_skill_refs: skills.map((skill) => skill.skill_id),
      source_genome_refs: skills.map((skill) => skill.genome_ref),
      composition_graph: graph,
      inputs: clone(input.inputs ?? {}),
      outputs: clone(input.outputs ?? {}),
      supported_contexts: stringArray(
        input.supported_contexts ?? ["deterministic_local"],
        "capability_context_invalid",
      ),
      authority_requirements: clone(input.authority_requirements ?? { level: "none" }),
      side_effect_class: input.side_effect_class ?? "local_reversible",
      state_requirements: clone(input.state_requirements ?? {}),
      verification_policy: clone(input.verification_policy ?? { required: true }),
      resource_profile: clone(input.resource_profile ?? {}),
      performance_profile: clone(input.performance_profile ?? {}),
      failure_profile: clone(input.failure_profile ?? {}),
      rollback_profile: clone(input.rollback_profile ?? { mode: "checkpoint" }),
      evidence_refs: stringArray(input.evidence_refs ?? [], "capability_evidence_invalid"),
      synthesis_receipt_ref: null,
      lineage: { source_process_ids: skills.map((skill) => skill.source_process_id) },
      status: "CANDIDATE",
    };
    return { capability: candidate, cache_hit: false, discovery_count: skills.length };
  }

  promote(candidateInput, evidence) {
    const candidate = clone(candidateInput);
    if (!capabilityStates.has(candidate.status) || candidate.status !== "CANDIDATE") {
      reject("capability_not_candidate");
    }
    const required = [
      "sandbox_passed",
      "deterministic_tests_passed",
      "integration_test_passed",
      "failure_tests_passed",
      "verification_passed",
      "authority_evaluation_passed",
    ];
    if (required.some((field) => evidence[field] !== true)) {
      reject("capability_promotion_evidence_incomplete");
    }
    const receipt = {
      contract_version: SYNTHESIS_RECEIPT_CONTRACT_VERSION,
      synthesis_id: safeExecutionId("prosynthesis"),
      candidate_capability_id: candidate.capability_id,
      source_process_skills: candidate.source_skill_refs,
      source_genomes: candidate.source_genome_refs,
      composition_graph: candidate.composition_graph,
      synaptic_evidence: clone(evidence.synaptic_evidence ?? []),
      benchmark_results: clone(evidence.benchmark_results ?? {}),
      verification_results: clone(evidence.verification_results ?? {}),
      authority: clone(evidence.authority ?? { level: "none" }),
      performance: clone(evidence.performance ?? {}),
      failure_tests: clone(evidence.failure_tests ?? {}),
      promotion_decision: "PROMOTED",
    };
    const promoted = {
      ...candidate,
      status: "PROSYNTHESIZED",
      synthesis_receipt_ref: stateRoot("prosynthesine-receipt", receipt),
    };
    const commitment = {
      capability: promoted,
      source_skills: promoted.source_skill_refs,
      source_genomes: promoted.source_genome_refs,
      composition_graph: promoted.composition_graph,
      verification_policy: promoted.verification_policy,
      performance_profile: promoted.performance_profile,
      evidence_summary: promoted.evidence_refs,
      version: promoted.capability_version,
    };
    receipt.resulting_state_root = stateRoot("prosynthesized-capability", commitment);
    this.cache.set(evidence.intent_class, evidence.context_root, promoted);
    return { capability: promoted, receipt, state_root: receipt.resulting_state_root };
  }
}

export function executeProsynthesizedCapability(input) {
  const capability = clone(input.capability);
  if (capability.status !== "PROSYNTHESIZED") reject("capability_not_promoted");
  if (capability.composition_graph.kind !== "SEQUENTIAL") {
    reject("seed_runtime_requires_sequential_graph");
  }
  if (!(input.observer instanceof ProcessEdgeObserver)) reject("edge_observer_required");
  let state = clone(input.state);
  const completed = [];
  for (const node of capability.composition_graph.nodes) {
    const implementation = input.skills[node.skill_id];
    if (typeof implementation !== "function") reject("process_skill_implementation_missing");
    const before = clone(state);
    const output = implementation(state);
    state = output.state;
    input.observer.observe({
      correlation_id: input.correlation_id,
      source_component: completed.at(-1) ?? "capability_port",
      target_component: node.skill_id,
      source_role: completed.length === 0 ? "PROSYNTHESIZED_CAPABILITY" : "PROCESS_SKILL",
      target_role: node.role,
      process_id: output.process_id,
      skill_id: node.skill_id,
      capability_id: capability.capability_id,
      input_state_root: stateRoot("edge-input", before),
      output_state_root: stateRoot("edge-output", state),
      start_time: output.start_time,
      end_time: output.end_time,
      success: output.success,
      verified: output.verified,
      evidence_refs: output.evidence_refs ?? [],
      verification_refs: output.verification_refs ?? [],
      retry_count: output.retry_count ?? 0,
      fallback_count: output.fallback_count ?? 0,
      error_class: output.error_class ?? null,
      context_ref: input.context_ref,
      authority_ref: input.authority_ref,
      receipt_ref: output.receipt_ref ?? null,
      contribution: output.contribution ?? "EXECUTION",
    });
    if (!output.success) reject("prosynthesized_capability_skill_failed");
    completed.push(node.skill_id);
  }
  return {
    state,
    completed,
    verified: input.verify(state) === true,
    outcome_state_root: stateRoot("verified-outcome", state),
  };
}

export class PostSynthesizedRuntime {
  constructor(options = {}) {
    this.observer = options.observer;
    this.maximumRecompositions = options.maximumRecompositions ?? 4;
    this.maximumSteps = options.maximumSteps ?? 64;
  }

  execute(input) {
    if (!(this.observer instanceof ProcessEdgeObserver)) reject("edge_observer_required");
    const started = Number(input.now());
    const deadline = started + input.deadline_ms;
    let graph = [...input.initial_graph];
    const visitedGraphs = new Set();
    const events = [];
    const completed = [];
    let cursor = 0;
    let recompositions = 0;
    while (cursor < graph.length) {
      if (completed.length >= this.maximumSteps) reject("post_synthesis_step_budget_exceeded");
      if (Number(input.now()) > deadline) reject("post_synthesis_deadline_exceeded");
      const graphRoot = stateRoot("post-synthesis-graph", graph);
      if (cursor === 0 && visitedGraphs.has(graphRoot)) reject("post_synthesis_cycle_detected");
      visitedGraphs.add(graphRoot);
      const selected = graph[cursor];
      const observation = input.observe({ selected, cursor, graph: [...graph] });
      if (observation.changed && !input.isSuitable(selected, observation)) {
        if (recompositions >= this.maximumRecompositions) {
          reject("post_synthesis_recomposition_budget_exceeded");
        }
        const replacement = input.recompose({
          selected,
          observation,
          graph: [...graph],
          cursor,
        });
        if (replacement === selected || completed.includes(replacement)) {
          reject("post_synthesis_cycle_detected");
        }
        input.authorize({ selected: replacement, observation });
        graph[cursor] = replacement;
        recompositions += 1;
        events.push({
          event: "RECOMPILED",
          reason_category: observation.reason_category,
          replaced: selected,
          selected: replacement,
          graph_root: stateRoot("post-synthesis-graph", graph),
        });
        continue;
      }
      input.authorize({ selected, observation });
      const before = clone(input.state);
      const output = input.skills[selected](input.state, observation);
      input.state = output.state;
      this.observer.observe({
        correlation_id: input.correlation_id,
        source_component: cursor === 0 ? "dynamic_capability_port" : graph[cursor - 1],
        target_component: selected,
        source_role: cursor === 0 ? "POST_SYNTHESIZED_CAPABILITY" : "PROCESS_SKILL",
        target_role: "PROCESS_SKILL",
        process_id: output.process_id,
        skill_id: selected,
        capability_id: input.capability_id,
        input_state_root: stateRoot("edge-input", before),
        output_state_root: stateRoot("edge-output", input.state),
        start_time: output.start_time,
        end_time: output.end_time,
        success: output.success,
        verified: output.verified,
        evidence_refs: output.evidence_refs,
        verification_refs: output.verification_refs,
        retry_count: output.retry_count ?? 0,
        fallback_count: output.fallback_count ?? 0,
        error_class: output.error_class ?? null,
        context_ref: input.context_ref,
        authority_ref: input.authority_ref,
        receipt_ref: output.receipt_ref,
        contribution: output.contribution ?? "EXECUTION",
      });
      if (!output.success) reject("post_synthesis_skill_failed");
      completed.push(selected);
      cursor += 1;
    }
    const checkpoint = {
      contract_version: "kindred.post-synthesis-checkpoint.v1",
      capability_id: input.capability_id,
      correlation_id: input.correlation_id,
      graph,
      completed,
      pending: [],
      recompilation_events: events,
      edge_record_refs: this.observer.records
        .filter((record) => record.correlation_id === input.correlation_id)
        .map((record) => record.edge_execution_id),
      authority_ref: input.authority_ref,
      state_root: stateRoot("post-synthesis-working-set", input.state),
      fencing_token: input.fencing_token,
    };
    return {
      state: clone(input.state),
      verified: input.verify(input.state) === true,
      completed,
      recompositions,
      events,
      checkpoint,
    };
  }
}

export function resumePostSynthesis(checkpoint, options = {}) {
  if (options.fencing_token <= checkpoint.fencing_token) {
    reject("stale_failover_fencing_token");
  }
  return {
    ...clone(checkpoint),
    materialized_at_port: nonEmpty(options.port, "failover_port_invalid"),
    fencing_token: options.fencing_token,
    duplicate_consequential_effects: 0,
  };
}

export function selectExecutionComplexity(input) {
  if (input.simple_conversation === true && input.external_effects !== true) {
    return "DIRECT_RESPONSE";
  }
  if (input.retrieval_only === true) return "SIMPLE_RETRIEVAL";
  if (input.skill_count === 1 && input.dynamic !== true) return "SINGLE_SKILL";
  if (input.proven_process === true && input.skill_count === 1) return "PROCESS_SKILL";
  if (input.dynamic === true) return "POST_SYNTHESIZED_CAPABILITY";
  if (input.skill_count > 1) return "PROSYNTHESIZED_CAPABILITY";
  return "DIRECT_RESPONSE";
}

export class ProcessIntelligenceBoundaryAdapter {
  constructor(options = {}) {
    if (!(options.observer instanceof ProcessEdgeObserver)) reject("edge_observer_required");
    if (!(options.registry instanceof ProcessSkillRegistry)) {
      reject("process_skill_registry_required");
    }
    if (!(options.prosynthesine instanceof ProSynthesine)) reject("prosynthesine_required");
    this.observer = options.observer;
    this.registry = options.registry;
    this.prosynthesine = options.prosynthesine;
    this.publish = options.publish ?? (() => {});
    if (typeof this.publish !== "function") reject("event_publisher_invalid");
    this.unsubscribe = this.observer.subscribe((record) => {
      this.publish(this.toSynaptizerEvent(record));
    });
  }

  mapPort(componentClass) {
    const portType = PROCESS_PORT_TYPES[componentClass];
    if (!portType) reject("process_port_class_invalid");
    return portType;
  }

  discoverProcessSkills({ outcome_class, context }) {
    nonEmpty(outcome_class, "boundary_outcome_invalid");
    nonEmpty(context, "boundary_context_invalid");
    return [...this.registry.skills.values()]
      .filter((skill) => skill.supported_contexts.includes(context))
      .map(clone);
  }

  discoverProsynthesizedCapability({ intent_class, context_root }) {
    return this.prosynthesine.cache.get(intent_class, context_root);
  }

  request(requestType, payload = {}) {
    if (!PROCESS_INTELLIGENCE_REQUEST_TYPES.includes(requestType)) {
      reject("process_intelligence_request_invalid");
    }
    return {
      contract_version: PROCESS_INTELLIGENCE_BOUNDARY_CONTRACT_VERSION,
      request_type: requestType,
      payload: clone(payload),
      external_effects_authorized: false,
      authority_escalation_authorized: false,
    };
  }

  requestCandidate(payload) {
    return this.prosynthesine.synthesize(payload);
  }

  executeCapability(payload) {
    return executeProsynthesizedCapability(payload);
  }

  requestRecomposition(payload) {
    return this.request("REQUEST_POST_SYNTHESIS_RECOMPOSITION", payload);
  }

  toSynaptizerEvent(record) {
    return {
      contract_version: PROCESS_INTELLIGENCE_EVENT_CONTRACT_VERSION,
      event_type: "PROCESS_EDGE_EVIDENCE",
      edge_relationship: {
        source_component: record.source_component,
        target_component: record.target_component,
        source_role: record.source_role,
        target_role: record.target_role,
      },
      context_ref: record.context_ref,
      success: record.success,
      failure: !record.success,
      recovery: record.contribution === "RECOVERY",
      verification_contribution: record.contribution === "VERIFICATION",
      fitness_evidence: {
        verified: record.verified,
        latency: record.latency,
        retry_count: record.retry_count,
        fallback_count: record.fallback_count,
        evidence_refs: record.evidence_refs,
        verification_refs: record.verification_refs,
      },
      edge_execution_id: record.edge_execution_id,
      state_root: stateRoot("process-intelligence-event", record),
    };
  }

  createStrataCommitment(kind, value) {
    if (!STRATA_PROCESS_COMMITMENT_KINDS.includes(kind)) {
      reject("strata_process_commitment_kind_invalid");
    }
    return {
      contract_version: STRATA_PROCESS_COMMITMENT_CONTRACT_VERSION,
      kind,
      state_root: stateRoot(`strata-${kind.toLowerCase()}`, value),
      payload_ref: null,
      adapter_only: true,
      direct_pipe: false,
    };
  }

  cacheEvidence() {
    const cache = this.prosynthesine.cache;
    return {
      process_skill_reuse: this.registry.skills.size,
      capability_composition_hits: cache.hits,
      capability_composition_misses: cache.misses,
      planning_discovery_avoided: cache.hits,
    };
  }

  close() {
    this.unsubscribe();
  }
}
