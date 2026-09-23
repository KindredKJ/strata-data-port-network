import assert from "node:assert/strict";

import {
  COGNITIVE_PORT_TYPES,
  CognitivePortFabric,
  DCMLCompiler,
  createProcessPortAttachment,
  executeActivationPlan,
} from "../src/cognitive-body.mjs";

import {
  CapabilityCompositionCache,
  ProcessEdgeObserver,
  ProcessFitnessTracker,
  ProcessIntelligenceBoundaryAdapter,
  ProcessSkillGraduationPolicy,
  ProcessSkillRegistry,
  ProSynthesine,
  createProcessGenome,
  stateRoot,
} from "../src/process-intelligence.mjs";

import {
  Synaptizer,
} from "../src/synaptizer.mjs";

import {
  PersistentCognitiveStateStore,
} from "../src/cognitive-state-store.mjs";

const statePath =
  process.argv[2];

if (!statePath) {
  throw new Error(
    "persistent state path required",
  );
}

const fixedTime =
  Date.parse(
    "2026-09-01T22:15:00.000Z",
  );

function genome(
  processId,
  role,
) {
  return createProcessGenome({
    process_id:
      processId,

    role,

    purpose:
      `Deterministically perform ${role}.`,

    input_contract: {
      type: "object",
    },

    output_contract: {
      type: "object",
    },

    preconditions: [
      "local_fixture_ready",
    ],

    postconditions: [
      "output_observed",
    ],

    success_criteria: [
      "verified_fixture_output",
    ],

    failure_criteria: [
      "fixture_output_mismatch",
    ],

    created_at:
      new Date(
        fixedTime,
      ).toISOString(),
  });
}

function graduationEvidence(
  profile,
  processId,
) {
  return {
    execution_count:
      profile.executions,

    verified_success_count:
      Math.round(
        profile.executions *
        profile.verified_success_rate,
      ),

    verified_failure_count:
      Math.round(
        profile.executions *
        profile.failure_rate,
      ),

    success_rate:
      profile.reliability,

    verification_rate:
      profile.verification_strength,

    repeatability_score:
      profile.reliability,

    reliability_score:
      profile.reliability,

    recovery_success_rate:
      profile.recovery_rate,

    context_coverage:
      1,

    mean_latency:
      profile.mean_latency,

    p95_latency:
      profile.mean_latency,

    cost_per_verified_outcome:
      profile.mean_cost,

    rollback_success:
      1,

    authority_violations:
      0,

    security_failures:
      0,

    edge_failure_rate:
      profile.failure_rate,

    drift_score:
      0,

    supported_contexts: [
      "deterministic_local",
    ],

    known_limitations: [
      "restart-worker-local-fixture",
    ],

    evidence_refs: [
      `evidence-${processId}`,
    ],
  };
}

function skillResult(
  processId,
  transform,
  contribution = "EXECUTION",
) {
  return (state) => ({
    process_id:
      processId,

    state:
      transform(
        structuredClone(
          state,
        ),
      ),

    start_time:
      fixedTime,

    end_time:
      fixedTime + 1,

    success:
      true,

    verified:
      true,

    evidence_refs: [
      `evidence-continuation-${processId}`,
    ],

    verification_refs: [
      `verification-continuation-${processId}`,
    ],

    contribution,
  });
}

/*
 * ==============================================================
 * LOAD DURABLE COGNITIVE STATE
 * ==============================================================
 */

const store =
  new PersistentCognitiveStateStore({
    path:
      statePath,
  });

const recovered =
  await store.load();

assert.equal(
  recovered.sequence,
  1,
);

/*
 * ==============================================================
 * REHYDRATE A NEW LIVE SYNAPTIZER INSTANCE
 * ==============================================================
 */

const synaptizer =
  new Synaptizer();

const hydrated =
  synaptizer.hydrate(
    recovered.synaptic_snapshot,
  );

assert.equal(
  hydrated.state_root,
  recovered
    .synaptic_snapshot
    .state_root,
);

assert.equal(
  hydrated.relationships.length,
  3,
);

assert.equal(
  hydrated.learned_events,
  3,
);

const preExecutionReinforcement =
  hydrated.relationships.reduce(
    (sum, relationship) =>
      sum +
      relationship.reinforcement,
    0,
  );

assert.equal(
  preExecutionReinforcement,
  3.25,
);

/*
 * ==============================================================
 * RECONSTRUCT EXECUTABLE PROCESS SKILLS / CAPABILITY
 *
 * This is deliberately reconstructed runtime code.
 * SW06 proves SYNAPTIC continuation, not capability persistence.
 * ==============================================================
 */

const genomes = {
  a:
    genome(
      "process-a",
      "NORMALIZE_INPUT",
    ),

  b:
    genome(
      "process-b",
      "TRANSFORM_VALUE",
    ),

  c:
    genome(
      "process-c",
      "VERIFY_OUTPUT",
    ),
};

const graduationObserver =
  new ProcessEdgeObserver({
    now:
      () => fixedTime,
  });

const roles = {
  "process-a":
    "NORMALIZE_INPUT",

  "process-b":
    "TRANSFORM_VALUE",

  "process-c":
    "VERIFY_OUTPUT",
};

for (
  const processId of [
    "process-a",
    "process-b",
    "process-c",
  ]
) {
  for (
    let run = 0;
    run < 3;
    run += 1
  ) {
    graduationObserver.observe({
      correlation_id:
        `sw06-graduation-${processId}-${run}`,

      source_component:
        "sw06-restart-evidence",

      target_component:
        processId,

      source_role:
        "VERIFIED_EVIDENCE_SOURCE",

      target_role:
        roles[processId],

      process_id:
        processId,

      input_state_root:
        stateRoot(
          "sw06-input",
          {
            processId,
            run,
          },
        ),

      output_state_root:
        stateRoot(
          "sw06-output",
          {
            processId,
            run,
          },
        ),

      start_time:
        fixedTime + run * 2,

      end_time:
        fixedTime +
        run * 2 +
        1,

      success:
        true,

      verified:
        true,

      evidence_refs: [
        `sw06-evidence-${processId}-${run}`,
      ],

      verification_refs: [
        `sw06-verification-${processId}-${run}`,
      ],

      retry_count:
        0,

      fallback_count:
        0,

      context_ref:
        "deterministic_local",

      authority_ref:
        "authority-local-fixture",

      contribution:
        processId ===
        "process-c"
          ? "VERIFICATION"
          : "EXECUTION",
    });
  }
}

const fitness =
  new ProcessFitnessTracker(
    graduationObserver,
  );

const registry =
  new ProcessSkillRegistry(
    new ProcessSkillGraduationPolicy({
      execution_count:
        3,

      verified_success_count:
        3,

      success_rate:
        1,

      verification_rate:
        1,
    }),
  );

const skillA =
  registry.graduate(
    genomes.a,
    graduationEvidence(
      fitness.profile(
        "process-a",
      ),
      "process-a",
    ),
  );

const skillB =
  registry.graduate(
    genomes.b,
    graduationEvidence(
      fitness.profile(
        "process-b",
      ),
      "process-b",
    ),
  );

const skillC =
  registry.graduate(
    genomes.c,
    graduationEvidence(
      fitness.profile(
        "process-c",
      ),
      "process-c",
    ),
  );

const cache =
  new CapabilityCompositionCache();

const prosynthesine =
  new ProSynthesine({
    registry,
    cache,
  });

const contextRoot =
  stateRoot(
    "sw06-context",
    {
      class:
        "deterministic_local",
    },
  );

const synthesisInput = {
  intent_class:
    "NORMALIZE_TRANSFORM_VERIFY",

  context_root:
    contextRoot,

  composition_kind:
    "SEQUENTIAL",

  skill_ids: [
    skillA.skill_id,
    skillB.skill_id,
    skillC.skill_id,
  ],

  capability_id:
    "kindred.capability.sw06.v1",

  capability_version:
    1,

  name:
    "SW06.CONTINUATION.PROOF",

  role:
    "NORMALIZE_TRANSFORM_VERIFY",

  outcome_class:
    "VERIFIED_NUMERIC_RESULT",

  supported_contexts: [
    "deterministic_local",
  ],

  evidence_refs: [
    "evidence-sw06-synthesis",
  ],
};

const candidate =
  prosynthesine.synthesize(
    synthesisInput,
  );

const promotion =
  prosynthesine.promote(
    candidate.capability,
    {
      intent_class:
        synthesisInput.intent_class,

      context_root:
        contextRoot,

      sandbox_passed:
        true,

      deterministic_tests_passed:
        true,

      integration_test_passed:
        true,

      failure_tests_passed:
        true,

      verification_passed:
        true,

      authority_evaluation_passed:
        true,

      benchmark_results: {
        fixture:
          "PASS",
      },

      verification_results: {
        final_state:
          "PASS",
      },

      failure_tests: {
        denied_incomplete_evidence:
          "PASS",
      },
    },
  );

/*
 * ==============================================================
 * NEW REAL PI BOUNDARY USING THE REHYDRATED SYNAPTIZER
 * ==============================================================
 */

const processObserver =
  new ProcessEdgeObserver({
    now:
      () => fixedTime,
  });

const resumedEvents = [];

const boundary =
  new ProcessIntelligenceBoundaryAdapter({
    observer:
      processObserver,

    registry,

    prosynthesine,

    publish:
      (event) => {
        resumedEvents.push(
          structuredClone(
            event,
          ),
        );

        synaptizer.consume(
          event,
        );
      },
  });

try {
  const attachment =
    createProcessPortAttachment(
      boundary,
    );

  /*
   * ============================================================
   * NEW COGNITIVE FABRIC AFTER RESTART
   * ============================================================
   */

  const fabric =
    new CognitivePortFabric();

  fabric.registerPort(
    {
      port_id:
        "intent.sw06",

      port_type:
        COGNITIVE_PORT_TYPES.INTENT,

      role:
        "NORMALIZE_INTENT",

      priority:
        100,

      intent_classes: [
        "NORMALIZE_TRANSFORM_VERIFY",
      ],
    },

    async ({ state }) => ({
      ...state,
      intent_normalized:
        true,
    }),
  );

  fabric.registerPort(
    {
      port_id:
        "cogniton.sw06",

      port_type:
        COGNITIVE_PORT_TYPES.COGNITON,

      role:
        "RECOVERED_COGNITIVE_STATE",

      priority:
        100,

      intent_classes: [
        "NORMALIZE_TRANSFORM_VERIFY",
      ],
    },

    async ({ state }) => ({
      ...state,

      recovered_graph_root:
        recovered
          .cognitive_graph
          .state_root,
    }),
  );

  fabric.registerPort(
    {
      port_id:
        "process.a-baseline",

      port_type:
        COGNITIVE_PORT_TYPES.PROCESS,

      role:
        "BASELINE_PROCESS_PATH",

      priority:
        100,

      intent_classes: [
        "NORMALIZE_TRANSFORM_VERIFY",
      ],

      evidence_targets: [
        "kindred.process-skill.unrelated.v1",
      ],

      verification_required:
        true,
    },

    async ({ state }) => ({
      ...state,

      selected_process_port:
        "process.a-baseline",
    }),
  );

  fabric.registerPort(
    {
      port_id:
        "process.z-learned",

      port_type:
        COGNITIVE_PORT_TYPES.PROCESS,

      role:
        "RECOVERED_LEARNING_PROCESS_PATH",

      priority:
        100,

      intent_classes: [
        "NORMALIZE_TRANSFORM_VERIFY",
      ],

      evidence_targets: [
        skillA.skill_id,
        skillB.skill_id,
        skillC.skill_id,
      ],

      verification_required:
        true,
    },

    async ({ state }) => {
      const correlationId =
        "sw06-post-restart-execution-0001";

      const executionPayload = {
        capability:
          promotion.capability,

        state:
          state.capability_input,

        correlation_id:
          correlationId,

        context_ref:
          "deterministic_local",

        authority_ref:
          "authority-local-fixture",

        observer:
          processObserver,

        skills: {
          [skillA.skill_id]:
            skillResult(
              "process-a",

              (current) => ({
                value:
                  current.value + 1,
              }),
            ),

          [skillB.skill_id]:
            skillResult(
              "process-b",

              (current) => ({
                value:
                  current.value * 2,
              }),
            ),

          [skillC.skill_id]:
            skillResult(
              "process-c",

              (current) => ({
                ...current,

                verified:
                  current.value === 4,
              }),

              "VERIFICATION",
            ),
        },

        verify:
          (current) =>
            current.value === 4 &&
            current.verified === true,
      };

      const receiptPayload = {
        capability_id:
          promotion
            .capability
            .capability_id,

        correlation_id:
          correlationId,

        context_ref:
          "deterministic_local",

        recovered_state_root:
          recovered.state_root,

        recovered_synaptic_root:
          recovered
            .synaptic_snapshot
            .state_root,

        execution_mode:
          "POST_RESTART_CONTINUATION",
      };

      const execution =
        await attachment.dispatch(
          "EXECUTE_CAPABILITY",
          executionPayload,
          receiptPayload,
        );

      return {
        ...state,

        selected_process_port:
          "process.z-learned",

        process_execution:
          execution,
      };
    },
  );

  fabric.registerPort(
    {
      port_id:
        "verification.sw06",

      port_type:
        COGNITIVE_PORT_TYPES.VERIFICATION,

      role:
        "VERIFY_POST_RESTART_CONTINUATION",

      priority:
        100,

      intent_classes: [
        "NORMALIZE_TRANSFORM_VERIFY",
      ],
    },

    async ({ state }) => ({
      ...state,

      verified:
        state.selected_process_port ===
          "process.z-learned" &&
        state
          .process_execution
          ?.result
          ?.verified === true,
    }),
  );

  /*
   * ============================================================
   * RECOVERED LEARNING MUST DRIVE THE POST-RESTART DECISION
   * ============================================================
   */

  const compiler =
    new DCMLCompiler();

  const recoveredSnapshot =
    synaptizer.snapshot();

  const plan =
    compiler.compile({
      intent_class:
        "NORMALIZE_TRANSFORM_VERIFY",

      graph:
        recovered.cognitive_graph,

      fabric:
        fabric.snapshot(),

      synaptic_snapshot:
        recoveredSnapshot,

      context_ref:
        "deterministic_local",

      authority_scope:
        "POST_RESTART_CONTINUATION",

      verification_required:
        true,
    });

  assert.equal(
    plan.process_port_id,
    "process.z-learned",
  );

  const learnedTrace =
    plan
      .process_selection_trace
      .find(
        (entry) =>
          entry.port_id ===
          "process.z-learned",
      );

  assert.ok(
    learnedTrace,
  );

  assert.equal(
    learnedTrace.synaptic_score,
    3.25,
  );

  /*
   * ============================================================
   * CONTINUE EXECUTION + CONTINUE LEARNING
   * ============================================================
   */

  const outcome =
    await executeActivationPlan({
      plan,

      fabric,

      payload: {
        request_id:
          "sw06-post-restart-request",

        capability_input: {
          value:
            1,
        },
      },
    });

  assert.equal(
    outcome.verified,
    true,
  );

  assert.equal(
    outcome.selected_process_port,
    "process.z-learned",
  );

  assert.deepEqual(
    outcome
      .process_execution
      .result
      .state,
    {
      value:
        4,

      verified:
        true,
    },
  );

  assert.equal(
    resumedEvents.length,
    3,
  );

  assert.equal(
    processObserver.records.length,
    3,
  );

  const continuedSnapshot =
    synaptizer.snapshot();

  assert.equal(
    continuedSnapshot.relationships.length,
    3,
  );

  assert.equal(
    continuedSnapshot.learned_events,
    6,
  );

  assert.equal(
    continuedSnapshot.relationships.every(
      (relationship) =>
        relationship.observations ===
        2,
    ),
    true,
  );

  const continuedReinforcement =
    continuedSnapshot
      .relationships
      .reduce(
        (sum, relationship) =>
          sum +
          relationship.reinforcement,
        0,
      );

  assert.equal(
    continuedReinforcement,
    6.5,
  );

  /*
   * ============================================================
   * REPLAY PROTECTION MUST SURVIVE RESTART
   * ============================================================
   */

  const replayCandidate =
    recovered
      .synaptic_snapshot
      .seen_event_ids?.[0] ??
    null;

  if (replayCandidate) {
    assert.equal(
      continuedSnapshot
        .seen_event_ids
        .includes(
          replayCandidate,
        ),
      true,
    );
  }

  /*
   * ============================================================
   * SECOND DURABLE COMMIT
   * ============================================================
   */

  const secondCommit =
    await store.save({
      cognitive_graph:
        recovered.cognitive_graph,

      synaptic_snapshot:
        continuedSnapshot,

      sequence:
        recovered.sequence + 1,

      metadata: {
        wave:
          "SW06",

        resumed_from_sequence:
          recovered.sequence,

        continued_learning:
          true,

        worker_pid:
          process.pid,
      },
    });

  assert.equal(
    secondCommit.sequence,
    2,
  );

  const reloaded =
    await store.load();

  assert.equal(
    reloaded.sequence,
    2,
  );

  assert.equal(
    reloaded.state_root,
    secondCommit.state_root,
  );

  assert.equal(
    reloaded
      .synaptic_snapshot
      .learned_events,
    6,
  );

  const persistedReinforcement =
    reloaded
      .synaptic_snapshot
      .relationships
      .reduce(
        (sum, relationship) =>
          sum +
          relationship.reinforcement,
        0,
      );

  assert.equal(
    persistedReinforcement,
    6.5,
  );

  console.log(
    JSON.stringify(
      {
        worker_process_id:
          process.pid,

        recovered_sequence:
          recovered.sequence,

        committed_sequence:
          secondCommit.sequence,

        recovered_state_root:
          recovered.state_root,

        continued_state_root:
          secondCommit.state_root,

        recovered_synaptic_root:
          recovered
            .synaptic_snapshot
            .state_root,

        continued_synaptic_root:
          continuedSnapshot.state_root,

        relationships_before:
          recovered
            .synaptic_snapshot
            .relationships
            .length,

        relationships_after:
          continuedSnapshot
            .relationships
            .length,

        learned_events_before:
          recovered
            .synaptic_snapshot
            .learned_events,

        learned_events_after:
          continuedSnapshot
            .learned_events,

        reinforcement_before:
          3.25,

        reinforcement_after:
          continuedReinforcement,

        selected_process_port:
          outcome.selected_process_port,

        post_restart_execution_verified:
          outcome.verified,

        continued_learning_after_restart:
          true,

        second_durable_commit:
          true,
      },
      null,
      2,
    ),
  );
}
finally {
  boundary.close();
}
