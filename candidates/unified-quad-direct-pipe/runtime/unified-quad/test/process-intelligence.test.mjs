import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  CapabilityCompositionCache,
  PostSynthesizedRuntime,
  ProcessEdgeObserver,
  ProcessFitnessTracker,
  ProcessIntelligenceBoundaryAdapter,
  ProcessIntelligenceError,
  ProcessSkillGraduationPolicy,
  ProcessSkillRegistry,
  ProSynthesine,
  createProcessGenome,
  evolveProcessGenome,
  executeProsynthesizedCapability,
  resumePostSynthesis,
  stateRoot,
  validateProcessGenome,
} from "../src/process-intelligence.mjs";

const fixedTime = Date.parse("2026-09-01T15:00:00.000Z");
const contextRoot = stateRoot("test-context", { class: "deterministic_local" });

function genome(processId, role) {
  return createProcessGenome({
    process_id: processId,
    role,
    purpose: `Deterministically perform ${role}.`,
    input_contract: { type: "object" },
    output_contract: { type: "object" },
    preconditions: ["local_fixture_ready"],
    postconditions: ["output_observed"],
    success_criteria: ["verified_fixture_output"],
    failure_criteria: ["fixture_output_mismatch"],
    created_at: new Date(fixedTime).toISOString(),
  });
}

function observe(observer, input) {
  return observer.observe({
    correlation_id: input.correlation_id ?? "correlation-process-proof-0001",
    source_component: input.source_component ?? "fixture-source",
    target_component: input.target_component ?? input.process_id,
    source_role: input.source_role ?? "FIXTURE",
    target_role: input.target_role ?? "PROCESS",
    process_id: input.process_id,
    skill_id: input.skill_id ?? null,
    capability_id: input.capability_id ?? null,
    input_state_root: stateRoot("input", input.input ?? {}),
    output_state_root: stateRoot("output", input.output ?? {}),
    start_time: input.start_time ?? fixedTime,
    end_time: input.end_time ?? fixedTime + 1,
    cost: input.cost ?? 0,
    success: input.success,
    verified: input.verified,
    evidence_refs: input.evidence_refs ?? [`evidence-${input.process_id}`],
    verification_refs: input.verification_refs ?? [],
    retry_count: input.retry_count ?? 0,
    fallback_count: input.fallback_count ?? 0,
    error_class: input.error_class ?? null,
    context_ref: input.context_ref ?? "context-alpha",
    authority_ref: "authority-local-fixture",
    receipt_ref: `receipt-${input.process_id}`,
    contribution: input.contribution ?? "EXECUTION",
  });
}

function graduationEvidence(profile, processId) {
  return {
    execution_count: profile.executions,
    verified_success_count: Math.round(
      profile.executions * profile.verified_success_rate,
    ),
    verified_failure_count: Math.round(profile.executions * profile.failure_rate),
    success_rate: profile.reliability,
    verification_rate: profile.verification_strength,
    repeatability_score: profile.reliability,
    reliability_score: profile.reliability,
    recovery_success_rate: profile.recovery_rate,
    context_coverage: 1,
    mean_latency: profile.mean_latency,
    p95_latency: profile.mean_latency,
    cost_per_verified_outcome: profile.mean_cost,
    rollback_success: 1,
    authority_violations: 0,
    security_failures: 0,
    edge_failure_rate: profile.failure_rate,
    drift_score: 0,
    supported_contexts: ["deterministic_local"],
    known_limitations: ["fixture_only"],
    evidence_refs: [`evidence-graduation-${processId}`],
  };
}

function skillResult(processId, transform, contribution = "EXECUTION") {
  return (state) => ({
    process_id: processId,
    state: transform(structuredClone(state)),
    start_time: fixedTime,
    end_time: fixedTime + 1,
    success: true,
    verified: true,
    evidence_refs: [`evidence-execution-${processId}`],
    verification_refs: [`verification-${processId}`],
    contribution,
  });
}

function dynamicInput({ skills, observer, overrides = {} }) {
  return {
    initial_graph: [skills.a, skills.b, skills.c],
    state: { path: [] },
    correlation_id: "correlation-dynamic-proof-0001",
    capability_id: "kindred.capability.dynamic-proof.v1",
    context_ref: "deterministic_local",
    authority_ref: "authority-local-fixture",
    fencing_token: 1,
    deadline_ms: 100,
    now: () => fixedTime,
    observe: ({ selected }) =>
      selected === skills.b
        ? { changed: true, reason_category: "CONTEXT_CHANGED" }
        : { changed: false, reason_category: "UNCHANGED" },
    isSuitable: (selected) => selected !== skills.b,
    recompose: () => skills.d,
    authorize: () => true,
    skills: {
      [skills.a]: skillResult("process-a", (state) => ({
        path: [...state.path, "A"],
      })),
      [skills.b]: skillResult("process-b", (state) => ({
        path: [...state.path, "B"],
      })),
      [skills.c]: skillResult("process-c", (state) => ({
        path: [...state.path, "C"],
      })),
      [skills.d]: skillResult("process-d", (state) => ({
        path: [...state.path, "D"],
      })),
    },
    verify: (state) => state.path.join(",") === "A,D,C",
    observer,
    ...overrides,
  };
}

test("Process Intelligence focused deterministic proof", async () => {
  const genomes = {
    a: genome("process-a", "NORMALIZE_INPUT"),
    b: genome("process-b", "TRANSFORM_VALUE"),
    c: genome("process-c", "VERIFY_OUTPUT"),
    failed: genome("process-failed", "UNRELIABLE_FIXTURE"),
  };
  assert.deepEqual(validateProcessGenome(genomes.a), genomes.a);
  const evolved = evolveProcessGenome(genomes.a, {
    resource_profile: { compute: "reduced" },
    updated_at: new Date(fixedTime + 1000).toISOString(),
  });
  assert.equal(evolved.role, genomes.a.role);
  assert.equal(evolved.genome_version, genomes.a.genome_version + 1);
  assert.throws(
    () => evolveProcessGenome(genomes.a, { role: "CHANGED_ROLE" }),
    (error) =>
      error instanceof ProcessIntelligenceError &&
      error.reasonClass === "process_role_change_requires_new_lineage",
  );

  const edgeObserver = new ProcessEdgeObserver({ now: () => fixedTime });
  observe(edgeObserver, {
    process_id: "credit-a",
    success: true,
    verified: true,
    contribution: "EXECUTION",
  });
  observe(edgeObserver, {
    process_id: "credit-b",
    success: false,
    verified: false,
    error_class: "DETERMINISTIC_FAILURE",
  });
  observe(edgeObserver, {
    process_id: "credit-c",
    success: true,
    verified: true,
    contribution: "RECOVERY",
    fallback_count: 1,
  });
  observe(edgeObserver, {
    process_id: "credit-d",
    success: true,
    verified: true,
    contribution: "VERIFICATION",
    verification_refs: ["verification-final-outcome"],
  });
  observe(edgeObserver, {
    process_id: "credit-a",
    success: true,
    verified: true,
    context_ref: "context-beta",
  });
  const credit = edgeObserver.credit("correlation-process-proof-0001");
  assert.deepEqual(
    credit.slice(0, 4).map((entry) => entry.reinforcement),
    [1, -1, 1.5, 1.25],
  );
  assert.deepEqual(
    credit.slice(0, 4).map((entry) => entry.contribution),
    ["EXECUTION", "EXECUTION", "RECOVERY", "VERIFICATION"],
  );

  const fitness = new ProcessFitnessTracker(edgeObserver);
  assert.equal(fitness.profile("credit-a").executions, 2);
  assert.equal(fitness.profile("credit-a", "context-alpha").executions, 1);
  assert.equal(fitness.profile("credit-a", "context-beta").executions, 1);
  assert.equal(fitness.profile("credit-b").failure_rate, 1);
  const fitnessDelta = fitness.delta(
    "credit-a",
    stateRoot("base-fitness", { executions: 0 }),
  );
  assert.equal(fitnessDelta.new_executions, 2);

  const graduationObserver = new ProcessEdgeObserver({ now: () => fixedTime });
  for (const processId of ["process-a", "process-b", "process-c"]) {
    for (let run = 0; run < 3; run += 1) {
      observe(graduationObserver, {
        correlation_id: `correlation-graduation-${processId}-${run}`,
        process_id: processId,
        success: true,
        verified: true,
        context_ref: "deterministic_local",
      });
    }
  }
  observe(graduationObserver, {
    correlation_id: "correlation-graduation-failed-0",
    process_id: "process-failed",
    success: false,
    verified: false,
    context_ref: "deterministic_local",
    error_class: "FIXTURE_FAILURE",
  });
  const graduationFitness = new ProcessFitnessTracker(graduationObserver);
  const policy = new ProcessSkillGraduationPolicy({
    execution_count: 3,
    verified_success_count: 3,
    success_rate: 1,
    verification_rate: 1,
  });
  const registry = new ProcessSkillRegistry(policy);
  const skillA = registry.graduate(
    genomes.a,
    graduationEvidence(graduationFitness.profile("process-a"), "process-a"),
  );
  const skillB = registry.graduate(
    genomes.b,
    graduationEvidence(graduationFitness.profile("process-b"), "process-b"),
  );
  const skillC = registry.graduate(
    genomes.c,
    graduationEvidence(graduationFitness.profile("process-c"), "process-c"),
  );
  assert.equal(registry.skills.size, 3);
  assert.throws(
    () =>
      registry.graduate(
        genomes.failed,
        graduationEvidence(
          graduationFitness.profile("process-failed"),
          "process-failed",
        ),
      ),
    (error) => error.reasonClass === "process_skill_graduation_denied",
  );

  const cache = new CapabilityCompositionCache();
  const prosynthesine = new ProSynthesine({ registry, cache });
  const synthesisInput = {
    intent_class: "NORMALIZE_TRANSFORM_VERIFY",
    context_root: contextRoot,
    composition_kind: "SEQUENTIAL",
    skill_ids: [skillA.skill_id, skillB.skill_id, skillC.skill_id],
    capability_id: "kindred.capability.process-proof.v1",
    capability_version: 1,
    name: "PROCESS.PROOF",
    role: "NORMALIZE_TRANSFORM_VERIFY",
    outcome_class: "VERIFIED_NUMERIC_RESULT",
    supported_contexts: ["deterministic_local"],
    evidence_refs: ["evidence-three-skill-graduation"],
  };
  const candidateResult = prosynthesine.synthesize(synthesisInput);
  assert.equal(candidateResult.cache_hit, false);
  assert.equal(candidateResult.discovery_count, 3);
  assert.equal(cache.misses, 1);
  assert.throws(
    () =>
      prosynthesine.promote(candidateResult.capability, {
        intent_class: synthesisInput.intent_class,
        context_root: contextRoot,
      }),
    (error) => error.reasonClass === "capability_promotion_evidence_incomplete",
  );
  const promotion = prosynthesine.promote(candidateResult.capability, {
    intent_class: synthesisInput.intent_class,
    context_root: contextRoot,
    sandbox_passed: true,
    deterministic_tests_passed: true,
    integration_test_passed: true,
    failure_tests_passed: true,
    verification_passed: true,
    authority_evaluation_passed: true,
    benchmark_results: { fixture: "PASS" },
    verification_results: { final_state: "PASS" },
    failure_tests: { denied_incomplete_evidence: "PASS" },
  });
  assert.equal(promotion.capability.status, "PROSYNTHESIZED");
  const capabilityObserver = new ProcessEdgeObserver({ now: () => fixedTime });
  const capabilityExecution = executeProsynthesizedCapability({
    capability: promotion.capability,
    state: { value: 1 },
    correlation_id: "correlation-capability-proof-0001",
    context_ref: "deterministic_local",
    authority_ref: "authority-local-fixture",
    observer: capabilityObserver,
    skills: {
      [skillA.skill_id]: skillResult("process-a", (state) => ({
        value: state.value + 1,
      })),
      [skillB.skill_id]: skillResult("process-b", (state) => ({
        value: state.value * 2,
      })),
      [skillC.skill_id]: skillResult(
        "process-c",
        (state) => ({ ...state, verified: state.value === 4 }),
        "VERIFICATION",
      ),
    },
    verify: (state) => state.value === 4 && state.verified === true,
  });
  assert.equal(capabilityExecution.verified, true);
  assert.deepEqual(capabilityExecution.state, { value: 4, verified: true });
  assert.equal(capabilityObserver.records.length, 3);
  const repeated = prosynthesine.synthesize(synthesisInput);
  assert.equal(repeated.cache_hit, true);
  assert.equal(repeated.discovery_count, 0);
  assert.equal(cache.hits, 1);
  assert.equal(prosynthesine.discoveryCount, 3);

  const dynamicObserver = new ProcessEdgeObserver({ now: () => fixedTime });
  const dynamicSkills = {
    a: skillA.skill_id,
    b: skillB.skill_id,
    c: skillC.skill_id,
    d: "kindred.process-skill.process-d.v1",
  };
  const dynamicRuntime = new PostSynthesizedRuntime({
    observer: dynamicObserver,
    maximumRecompositions: 2,
    maximumSteps: 8,
  });
  const dynamicExecution = dynamicRuntime.execute(
    dynamicInput({ skills: dynamicSkills, observer: dynamicObserver }),
  );
  assert.equal(dynamicExecution.verified, true);
  assert.equal(dynamicExecution.recompositions, 1);
  assert.deepEqual(dynamicExecution.state.path, ["A", "D", "C"]);
  assert.equal(dynamicExecution.completed.filter((id) => id === dynamicSkills.a).length, 1);
  assert.equal(dynamicExecution.completed.includes(dynamicSkills.b), false);
  assert.equal(dynamicExecution.completed.includes(dynamicSkills.d), true);

  assert.throws(
    () =>
      new PostSynthesizedRuntime({
        observer: new ProcessEdgeObserver({ now: () => fixedTime }),
        maximumRecompositions: 0,
      }).execute(
        dynamicInput({
          skills: dynamicSkills,
          observer: new ProcessEdgeObserver({ now: () => fixedTime }),
        }),
      ),
    (error) => error.reasonClass === "post_synthesis_recomposition_budget_exceeded",
  );
  const stepObserver = new ProcessEdgeObserver({ now: () => fixedTime });
  assert.throws(
    () =>
      new PostSynthesizedRuntime({ observer: stepObserver, maximumSteps: 1 }).execute(
        dynamicInput({
          skills: dynamicSkills,
          observer: stepObserver,
          overrides: {
            initial_graph: [dynamicSkills.a, dynamicSkills.c],
            observe: () => ({ changed: false, reason_category: "UNCHANGED" }),
            verify: () => false,
          },
        }),
      ),
    (error) => error.reasonClass === "post_synthesis_step_budget_exceeded",
  );
  const deadlineObserver = new ProcessEdgeObserver({ now: () => fixedTime });
  const deadlineTimes = [fixedTime, fixedTime + 2];
  assert.throws(
    () =>
      new PostSynthesizedRuntime({ observer: deadlineObserver }).execute(
        dynamicInput({
          skills: dynamicSkills,
          observer: deadlineObserver,
          overrides: { deadline_ms: 1, now: () => deadlineTimes.shift() },
        }),
      ),
    (error) => error.reasonClass === "post_synthesis_deadline_exceeded",
  );
  const cycleObserver = new ProcessEdgeObserver({ now: () => fixedTime });
  assert.throws(
    () =>
      new PostSynthesizedRuntime({ observer: cycleObserver }).execute(
        dynamicInput({
          skills: dynamicSkills,
          observer: cycleObserver,
          overrides: { recompose: ({ selected }) => selected },
        }),
      ),
    (error) => error.reasonClass === "post_synthesis_cycle_detected",
  );
  assert.throws(
    () =>
      resumePostSynthesis(dynamicExecution.checkpoint, {
        port: "port-b",
        fencing_token: dynamicExecution.checkpoint.fencing_token,
      }),
    (error) => error.reasonClass === "stale_failover_fencing_token",
  );

  const boundaryEvents = [];
  const boundaryObserver = new ProcessEdgeObserver({ now: () => fixedTime });
  const boundary = new ProcessIntelligenceBoundaryAdapter({
    observer: boundaryObserver,
    registry,
    prosynthesine,
    publish: (event) => boundaryEvents.push(event),
  });
  assert.equal(boundary.mapPort("PROCESS"), "PROCESS_PORT");
  assert.equal(boundary.mapPort("PROCESS_SKILL"), "PROCESS_SKILL_PORT");
  assert.equal(
    boundary.mapPort("PROSYNTHESIZED_CAPABILITY"),
    "CAPABILITY_PORT",
  );
  assert.equal(
    boundary.mapPort("POST_SYNTHESIZED_CAPABILITY"),
    "DYNAMIC_CAPABILITY_PORT",
  );
  assert.equal(
    boundary.discoverProcessSkills({
      outcome_class: "VERIFIED_NUMERIC_RESULT",
      context: "deterministic_local",
    }).length,
    3,
  );
  assert.equal(
    boundary.requestRecomposition({ reason: "CONTEXT_CHANGED" })
      .external_effects_authorized,
    false,
  );
  observe(boundaryObserver, {
    correlation_id: "correlation-boundary-event-0001",
    process_id: "process-c",
    success: true,
    verified: true,
    contribution: "VERIFICATION",
    verification_refs: ["verification-boundary-event"],
    context_ref: "deterministic_local",
  });
  assert.equal(boundaryEvents.length, 1);
  assert.equal(boundaryEvents[0].event_type, "PROCESS_EDGE_EVIDENCE");
  assert.equal(boundaryEvents[0].verification_contribution, true);
  const strataCommitment = boundary.createStrataCommitment(
    "PROSYNTHESIZED_CAPABILITY",
    promotion.capability,
  );
  assert.equal(strataCommitment.adapter_only, true);
  assert.equal(strataCommitment.direct_pipe, false);
  const cacheEvidence = boundary.cacheEvidence();
  assert.equal(cacheEvidence.capability_composition_hits >= 1, true);
  assert.equal(cacheEvidence.planning_discovery_avoided >= 1, true);
  boundary.close();

  const receipt = {
    organization: "KINDRED LABS",
    founded_by: "Kindred Jermaine Cox",
    generated_at: new Date(fixedTime).toISOString(),
    evidence_class: "E3_LOCAL_DETERMINISTIC_CANDIDATE",
    process_genome: "PROVEN",
    role_preservation: "PROVEN",
    edge_observer: "PROVEN",
    edge_credit_assignment: "PROVEN",
    process_fitness: "PROVEN",
    process_skill_graduation: "PROVEN",
    failed_process_rejection: "PROVEN",
    prosynthesine: "PROVEN",
    prosynthesized_capability: "PROVEN",
    capability_execution: "PROVEN",
    composition_cache: {
      status: "PROVEN",
      ...cacheEvidence,
      fresh_discovery_count: prosynthesine.discoveryCount,
    },
    post_synthesis: "PROVEN",
    dynamic_recomposition: "PROVEN",
    cycle_guard: "PROVEN",
    deadline_guard: "PROVEN",
    budget_guard: "PROVEN",
    fencing_guard: "PROVEN",
    dcml_connection: "ADAPTER_ONLY",
    cognitive_port_connection: "ADAPTER_ONLY",
    synaptizer_connection: "ADAPTER_ONLY",
    strata_adapter: "IMPLEMENTED",
    real_strata_execution: "UNPROVEN",
    direct_pipe: "UNPROVEN",
    tests: {
      command: "node test/process-intelligence.test.mjs",
      status: "PASSED",
      scope: "focused_process_intelligence",
    },
    state_roots: {
      process_genome: stateRoot("process-genome", genomes.a),
      process_fitness_delta: fitnessDelta.result_fitness_root,
      prosynthesized_capability: promotion.state_root,
      capability_outcome: capabilityExecution.outcome_state_root,
      post_synthesis_checkpoint: stateRoot(
        "post-synthesis-checkpoint",
        dynamicExecution.checkpoint,
      ),
      strata_adapter_commitment: strataCommitment.state_root,
    },
  };
  const receiptUrl = new URL("../../../evidence/process-intelligence-proof.json", import.meta.url);
  await mkdir(new URL(".", receiptUrl), { recursive: true });
  await writeFile(receiptUrl, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
});
