import assert from "node:assert/strict";
import test from "node:test";

import {
  COGNITIVE_PORT_TYPES,
  CognitiveGraph,
  CognitivePortFabric,
  DCMLCompiler,
  createCogniton,
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

const fixedTime =
  Date.parse(
    "2026-09-01T22:00:00.000Z",
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
      type:
        "object",
    },

    output_contract: {
      type:
        "object",
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
      "local_fixture_only",
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
        structuredClone(state),
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
      `evidence-execution-${processId}`,
    ],

    verification_refs: [
      `verification-${processId}`,
    ],

    contribution,
  });
}

function makeExecutionPayload({
  promotion,
  observer,
  skillA,
  skillB,
  skillC,
  state,
  correlationId,
}) {
  return {
    capability:
      promotion.capability,

    state,

    correlation_id:
      correlationId,

    context_ref:
      "deterministic_local",

    authority_ref:
      "authority-local-fixture",

    observer,

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
}

test(
  "learned Synaptizer relationships influence the subsequent DCML activation decision",
  async () => {

    /*
     * ==========================================================
     * PROCESS SKILLS + PROSYNTHESINE
     * ==========================================================
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
            `sw04-graduation-${processId}-${run}`,

          source_component:
            "sw04-evidence-source",

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
              "sw04-graduation-input",
              {
                processId,
                run,
              },
            ),

          output_state_root:
            stateRoot(
              "sw04-graduation-output",
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
            `sw04-evidence-${processId}-${run}`,
          ],

          verification_refs: [
            `sw04-verification-${processId}-${run}`,
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
        "sw04-context",
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
        "kindred.capability.sw04.v1",

      capability_version:
        1,

      name:
        "SW04.ADAPTIVE.PROOF",

      role:
        "NORMALIZE_TRANSFORM_VERIFY",

      outcome_class:
        "VERIFIED_NUMERIC_RESULT",

      supported_contexts: [
        "deterministic_local",
      ],

      evidence_refs: [
        "evidence-sw04-synthesis",
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
     * ==========================================================
     * SHARED LEARNING RUNTIME
     * ==========================================================
     */

    const synaptizer =
      new Synaptizer();

    const processObserver =
      new ProcessEdgeObserver({
        now:
          () => fixedTime,
      });

    const boundaryEvents = [];

    const boundary =
      new ProcessIntelligenceBoundaryAdapter({
        observer:
          processObserver,

        registry,

        prosynthesine,

        publish:
          (event) => {
            boundaryEvents.push(
              structuredClone(event),
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

      const cogniton =
        createCogniton({
          kind:
            "INTENT",

          value: {
            intent_class:
              "NORMALIZE_TRANSFORM_VERIFY",
          },

          provenance: {
            source:
              "sw04-adaptive-loop-proof",
          },
        });

      const graph =
        new CognitiveGraph();

      graph.add(
        cogniton,
      );

      graph.activate(
        cogniton.cogniton_id,
      );

      const graphSnapshot =
        graph.snapshot();

      const compiler =
        new DCMLCompiler();

      /*
       * ========================================================
       * CYCLE 1 — GENERATE LEARNING
       * ========================================================
       */

      const seedFabric =
        new CognitivePortFabric();

      seedFabric.registerPort(
        {
          port_id:
            "intent.sw04.seed",

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

      seedFabric.registerPort(
        {
          port_id:
            "cogniton.sw04.seed",

          port_type:
            COGNITIVE_PORT_TYPES.COGNITON,

          role:
            "MATERIALIZE_COGNITIVE_STATE",

          priority:
            100,

          intent_classes: [
            "NORMALIZE_TRANSFORM_VERIFY",
          ],
        },

        async ({ state }) => ({
          ...state,

          cognitive_graph_root:
            graphSnapshot.state_root,
        }),
      );

      seedFabric.registerPort(
        {
          port_id:
            "process.sw04.seed",

          port_type:
            COGNITIVE_PORT_TYPES.PROCESS,

          role:
            "GENERATE_VERIFIED_PROCESS_EVIDENCE",

          priority:
            100,

          intent_classes: [
            "NORMALIZE_TRANSFORM_VERIFY",
          ],

          verification_required:
            true,
        },

        async ({ state }) => {

          const correlationId =
            "sw04-cycle-1";

          const execution =
            await attachment.dispatch(
              "EXECUTE_CAPABILITY",

              makeExecutionPayload({
                promotion,
                observer:
                  processObserver,
                skillA,
                skillB,
                skillC,
                state:
                  state.capability_input,
                correlationId,
              }),

              {
                capability_id:
                  promotion.capability
                    .capability_id,

                correlation_id:
                  correlationId,

                context_ref:
                  "deterministic_local",

                execution_mode:
                  "LOCAL_DETERMINISTIC",

                adaptive_cycle:
                  1,
              },
            );

          return {
            ...state,

            selected_process_port:
              "process.sw04.seed",

            process_execution:
              execution,
          };
        },
      );

      seedFabric.registerPort(
        {
          port_id:
            "verification.sw04.seed",

          port_type:
            COGNITIVE_PORT_TYPES.VERIFICATION,

          role:
            "VERIFY_SEED_EXECUTION",

          priority:
            100,

          intent_classes: [
            "NORMALIZE_TRANSFORM_VERIFY",
          ],
        },

        async ({ state }) => ({
          ...state,

          verified:
            state
              .process_execution
              .result
              .verified === true,
        }),
      );

      const cycle1Plan =
        compiler.compile({
          intent_class:
            "NORMALIZE_TRANSFORM_VERIFY",

          graph:
            graphSnapshot,

          fabric:
            seedFabric.snapshot(),

          context_ref:
            "deterministic_local",

          authority_scope:
            "LOCAL_DETERMINISTIC_TEST",

          verification_required:
            true,
        });

      const cycle1Outcome =
        await executeActivationPlan({
          plan:
            cycle1Plan,

          fabric:
            seedFabric,

          payload: {
            request_id:
              "sw04-cycle-1-request",

            capability_input: {
              value:
                1,
            },
          },
        });

      assert.equal(
        cycle1Outcome.verified,
        true,
      );

      assert.equal(
        processObserver.records.length,
        3,
      );

      assert.equal(
        boundaryEvents.length,
        3,
      );

      const learnedSnapshot =
        synaptizer.snapshot();

      assert.equal(
        learnedSnapshot.learned_events,
        3,
      );

      assert.equal(
        learnedSnapshot.relationships.length,
        3,
      );

      const firstCycleReinforcement =
        learnedSnapshot.relationships
          .reduce(
            (sum, relationship) =>
              sum +
              relationship.reinforcement,
            0,
          );

      assert.equal(
        firstCycleReinforcement,
        3.25,
      );

      /*
       * ========================================================
       * CYCLE 2 — LEARNING MUST ALTER DCML SELECTION
       * ========================================================
       */

      const adaptiveFabric =
        new CognitivePortFabric();

      adaptiveFabric.registerPort(
        {
          port_id:
            "intent.sw04.adaptive",

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

      adaptiveFabric.registerPort(
        {
          port_id:
            "cogniton.sw04.adaptive",

          port_type:
            COGNITIVE_PORT_TYPES.COGNITON,

          role:
            "MATERIALIZE_COGNITIVE_STATE",

          priority:
            100,

          intent_classes: [
            "NORMALIZE_TRANSFORM_VERIFY",
          ],
        },

        async ({ state }) => ({
          ...state,

          cognitive_graph_root:
            graphSnapshot.state_root,
        }),
      );

      /*
       * BASELINE PORT
       *
       * Same priority as learned candidate.
       * Lexicographically first, therefore it wins when
       * there is NO Synaptizer evidence.
       */

      adaptiveFabric.registerPort(
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

          baseline_selected:
            true,
        }),
      );

      /*
       * LEARNED PORT
       *
       * Same static priority, but references the actual
       * Skill targets reinforced by Cycle 1.
       */

      adaptiveFabric.registerPort(
        {
          port_id:
            "process.z-learned",

          port_type:
            COGNITIVE_PORT_TYPES.PROCESS,

          role:
            "EVIDENCE_BACKED_PROCESS_PATH",

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
            "sw04-cycle-2";

          const execution =
            await attachment.dispatch(
              "EXECUTE_CAPABILITY",

              makeExecutionPayload({
                promotion,
                observer:
                  processObserver,
                skillA,
                skillB,
                skillC,
                state:
                  state.capability_input,
                correlationId,
              }),

              {
                capability_id:
                  promotion.capability
                    .capability_id,

                correlation_id:
                  correlationId,

                context_ref:
                  "deterministic_local",

                execution_mode:
                  "LOCAL_DETERMINISTIC",

                adaptive_cycle:
                  2,

                selection_evidence_root:
                  learnedSnapshot
                    .state_root,
              },
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

      adaptiveFabric.registerPort(
        {
          port_id:
            "verification.sw04.adaptive",

          port_type:
            COGNITIVE_PORT_TYPES.VERIFICATION,

          role:
            "VERIFY_ADAPTIVE_EXECUTION",

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

      const adaptiveFabricSnapshot =
        adaptiveFabric.snapshot();

      /*
       * Without learning, equal priorities resolve
       * deterministically by port ID.
       */

      const noLearningPlan =
        compiler.compile({
          intent_class:
            "NORMALIZE_TRANSFORM_VERIFY",

          graph:
            graphSnapshot,

          fabric:
            adaptiveFabricSnapshot,

          context_ref:
            "deterministic_local",

          authority_scope:
            "LOCAL_DETERMINISTIC_TEST",

          verification_required:
            true,
        });

      assert.equal(
        noLearningPlan.process_port_id,
        "process.a-baseline",
      );

      assert.equal(
        noLearningPlan
          .selection_evidence_root,
        null,
      );

      /*
       * With learned evidence, the actual execution relationships
       * must alter the decision.
       */

      const adaptivePlanA =
        compiler.compile({
          intent_class:
            "NORMALIZE_TRANSFORM_VERIFY",

          graph:
            graphSnapshot,

          fabric:
            adaptiveFabricSnapshot,

          synaptic_snapshot:
            learnedSnapshot,

          context_ref:
            "deterministic_local",

          authority_scope:
            "LOCAL_DETERMINISTIC_TEST",

          verification_required:
            true,
        });

      const adaptivePlanB =
        compiler.compile({
          intent_class:
            "NORMALIZE_TRANSFORM_VERIFY",

          graph:
            graphSnapshot,

          fabric:
            adaptiveFabricSnapshot,

          synaptic_snapshot:
            learnedSnapshot,

          context_ref:
            "deterministic_local",

          authority_scope:
            "LOCAL_DETERMINISTIC_TEST",

          verification_required:
            true,
        });

      /*
       * Adaptive selection remains deterministic.
       */

      assert.equal(
        adaptivePlanA.state_root,
        adaptivePlanB.state_root,
      );

      assert.equal(
        adaptivePlanA.process_port_id,
        "process.z-learned",
      );

      assert.notEqual(
        adaptivePlanA.process_port_id,
        noLearningPlan.process_port_id,
      );

      assert.equal(
        adaptivePlanA.selection_evidence_root,
        learnedSnapshot.state_root,
      );

      const baselineTrace =
        adaptivePlanA
          .process_selection_trace
          .find(
            (entry) =>
              entry.port_id ===
              "process.a-baseline",
          );

      const learnedTrace =
        adaptivePlanA
          .process_selection_trace
          .find(
            (entry) =>
              entry.port_id ===
              "process.z-learned",
          );

      assert.ok(
        baselineTrace,
      );

      assert.ok(
        learnedTrace,
      );

      assert.equal(
        baselineTrace.synaptic_score,
        0,
      );

      assert.equal(
        learnedTrace.synaptic_score,
        3.25,
      );

      assert.equal(
        learnedTrace.synaptic_score >
          baselineTrace.synaptic_score,
        true,
      );

      /*
       * ========================================================
       * EXECUTE THE LEARNING-INFLUENCED DECISION
       * ========================================================
       */

      const cycle2Outcome =
        await executeActivationPlan({
          plan:
            adaptivePlanA,

          fabric:
            adaptiveFabric,

          payload: {
            request_id:
              "sw04-cycle-2-request",

            capability_input: {
              value:
                1,
            },
          },
        });

      assert.equal(
        cycle2Outcome.verified,
        true,
      );

      assert.equal(
        cycle2Outcome.selected_process_port,
        "process.z-learned",
      );

      assert.equal(
        cycle2Outcome
          .process_execution
          .result
          .verified,
        true,
      );

      assert.deepEqual(
        cycle2Outcome
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

      /*
       * Second execution produced another 3 real Process edges.
       */

      assert.equal(
        processObserver.records.length,
        6,
      );

      assert.equal(
        boundaryEvents.length,
        6,
      );

      const finalSnapshot =
        synaptizer.snapshot();

      assert.equal(
        finalSnapshot.learned_events,
        6,
      );

      /*
       * Same three relationships were reinforced,
       * rather than creating duplicate relationship identities.
       */

      assert.equal(
        finalSnapshot.relationships.length,
        3,
      );

      assert.equal(
        finalSnapshot.relationships.every(
          (relationship) =>
            relationship.observations ===
            2,
        ),
        true,
      );

      const finalReinforcement =
        finalSnapshot.relationships
          .reduce(
            (sum, relationship) =>
              sum +
              relationship.reinforcement,
            0,
          );

      assert.equal(
        finalReinforcement,
        6.5,
      );

      /*
       * This proves same-runtime subsequent-cycle adaptation.
       *
       * It does NOT yet claim persistent memory across
       * process/runtime restart.
       */
    }
    finally {
      boundary.close();
    }
  },
);
