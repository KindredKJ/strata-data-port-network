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
    "2026-09-01T21:45:00.000Z",
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

function evidence(
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
      0,

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

test(
  "real Process Edge evidence is consumed by Synaptizer and produces evidence-backed relationship learning",
  async () => {

    /*
     * ----------------------------------------------------------
     * VERIFIED PROCESS SKILLS
     * ----------------------------------------------------------
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

    const evidenceObserver =
      new ProcessEdgeObserver({
        now:
          () => fixedTime,
      });

    const roleMap = {
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
        evidenceObserver.observe({
          correlation_id:
            `sw03-graduation-${processId}-${run}`,

          source_component:
            "sw03-evidence-source",

          target_component:
            processId,

          source_role:
            "VERIFIED_EVIDENCE_SOURCE",

          target_role:
            roleMap[processId],

          process_id:
            processId,

          input_state_root:
            stateRoot(
              "sw03-graduation-input",
              {
                processId,
                run,
              },
            ),

          output_state_root:
            stateRoot(
              "sw03-graduation-output",
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
            `sw03-evidence-${processId}-${run}`,
          ],

          verification_refs: [
            `sw03-verification-${processId}-${run}`,
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
        evidenceObserver,
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
        evidence(
          fitness.profile(
            "process-a",
          ),
          "process-a",
        ),
      );

    const skillB =
      registry.graduate(
        genomes.b,
        evidence(
          fitness.profile(
            "process-b",
          ),
          "process-b",
        ),
      );

    const skillC =
      registry.graduate(
        genomes.c,
        evidence(
          fitness.profile(
            "process-c",
          ),
          "process-c",
        ),
      );

    /*
     * ----------------------------------------------------------
     * REAL PROSYNTHESINE
     * ----------------------------------------------------------
     */

    const cache =
      new CapabilityCompositionCache();

    const prosynthesine =
      new ProSynthesine({
        registry,
        cache,
      });

    const contextRoot =
      stateRoot(
        "sw03-context",
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
        "kindred.capability.sw03.v1",

      capability_version:
        1,

      name:
        "SW03.SYNAPTIC.PROOF",

      role:
        "NORMALIZE_TRANSFORM_VERIFY",

      outcome_class:
        "VERIFIED_NUMERIC_RESULT",

      supported_contexts: [
        "deterministic_local",
      ],

      evidence_refs: [
        "evidence-sw03-synthesis",
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

    assert.equal(
      promotion.capability.status,
      "PROSYNTHESIZED",
    );

    /*
     * ----------------------------------------------------------
     * FIRST REAL SYNAPTIZER
     * ----------------------------------------------------------
     */

    const synaptizer =
      new Synaptizer();

    const processObserver =
      new ProcessEdgeObserver({
        now:
          () => fixedTime,
      });

    const deliveredEvents = [];

    const boundary =
      new ProcessIntelligenceBoundaryAdapter({
        observer:
          processObserver,

        registry,

        prosynthesine,

        publish:
          (event) => {
            deliveredEvents.push(
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

      /*
       * --------------------------------------------------------
       * COGNITIVE BODY
       * --------------------------------------------------------
       */

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
              "sw03-real-feedback-proof",
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

      const fabric =
        new CognitivePortFabric();

      fabric.registerPort(
        {
          port_id:
            "intent.kindred.sw03",

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
            "cogniton.kindred.sw03",

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

      fabric.registerPort(
        {
          port_id:
            "process.kindred",

          port_type:
            COGNITIVE_PORT_TYPES.PROCESS,

          role:
            "EXECUTE_PROSYNTHESIZED_CAPABILITY",

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
            "sw03-capability-execution-0001";

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
              promotion.capability
                .capability_id,

            capability_state_root:
              promotion.state_root,

            correlation_id:
              correlationId,

            context_ref:
              "deterministic_local",

            authority_ref:
              "authority-local-fixture",

            execution_mode:
              "LOCAL_DETERMINISTIC",
          };

          const execution =
            await attachment.dispatch(
              "EXECUTE_CAPABILITY",
              executionPayload,
              receiptPayload,
            );

          return {
            ...state,

            process_intelligence:
              execution,
          };
        },
      );

      fabric.registerPort(
        {
          port_id:
            "verification.kindred.sw03",

          port_type:
            COGNITIVE_PORT_TYPES.VERIFICATION,

          role:
            "VERIFY_CAPABILITY_AND_SYNAPTIC_FEEDBACK",

          priority:
            100,

          intent_classes: [
            "NORMALIZE_TRANSFORM_VERIFY",
          ],
        },

        async ({ state }) => {

          const execution =
            state.process_intelligence;

          const synapticSnapshot =
            synaptizer.snapshot();

          const checks = {
            process_verified:
              execution.result
                .verified === true,

            final_value_four:
              execution.result
                .state.value === 4,

            three_process_edges:
              processObserver
                .records.length === 3,

            three_events_delivered:
              deliveredEvents
                .length === 3,

            three_events_received:
              synapticSnapshot
                .received_events === 3,

            three_events_learned:
              synapticSnapshot
                .learned_events === 3,

            no_unverified_learning:
              synapticSnapshot
                .ignored_unverified_events === 0,

            three_relationships:
              synapticSnapshot
                .relationships.length === 3,
          };

          return {
            ...state,

            verified:
              Object.values(
                checks,
              ).every(Boolean),

            synaptic_snapshot:
              synapticSnapshot,

            verification_checks:
              checks,
          };
        },
      );

      /*
       * --------------------------------------------------------
       * DCML
       * --------------------------------------------------------
       */

      const compiler =
        new DCMLCompiler();

      const fabricSnapshot =
        fabric.snapshot();

      const plan =
        compiler.compile({
          intent_class:
            "NORMALIZE_TRANSFORM_VERIFY",

          graph:
            graphSnapshot,

          fabric:
            fabricSnapshot,

          authority_scope:
            "LOCAL_DETERMINISTIC_TEST",

          verification_required:
            true,
        });

      /*
       * --------------------------------------------------------
       * EXECUTE
       * --------------------------------------------------------
       */

      const outcome =
        await executeActivationPlan({
          plan,

          fabric,

          payload: {
            request_id:
              "sw03-request-0001",

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
        outcome
          .process_intelligence
          .result
          .verified,
        true,
      );

      assert.equal(
        processObserver.records.length,
        3,
      );

      assert.equal(
        deliveredEvents.length,
        3,
      );

      const snapshot =
        synaptizer.snapshot();

      assert.equal(
        snapshot.received_events,
        3,
      );

      assert.equal(
        snapshot.learned_events,
        3,
      );

      assert.equal(
        snapshot.ignored_unverified_events,
        0,
      );

      assert.equal(
        snapshot.relationships.length,
        3,
      );

      /*
       * Expected learned path:
       *
       * capability_port -> Skill A
       * Skill A         -> Skill B
       * Skill B         -> Skill C
       */

      const relationships =
        snapshot.relationships;

      const targetIds =
        relationships
          .map(
            (relationship) =>
              relationship.target_component,
          )
          .sort();

      assert.deepEqual(
        targetIds,
        [
          skillA.skill_id,
          skillB.skill_id,
          skillC.skill_id,
        ].sort(),
      );

      /*
       * All three observed edges were verified.
       */

      assert.equal(
        relationships.every(
          (relationship) =>
            relationship.observations ===
              1 &&
            relationship
              .verified_successes ===
              1,
        ),
        true,
      );

      /*
       * Final Process C edge contributed verification,
       * therefore one relationship must carry the stronger
       * verification reinforcement.
       */

      const verificationRelation =
        relationships.find(
          (relationship) =>
            relationship.target_component ===
            skillC.skill_id,
        );

      assert.ok(
        verificationRelation,
      );

      assert.equal(
        verificationRelation
          .verification_contributions,
        1,
      );

      assert.equal(
        verificationRelation
          .reinforcement,
        1.25,
      );

      /*
       * Other two verified execution edges score +1 each.
       */

      const totalReinforcement =
        relationships.reduce(
          (sum, relationship) =>
            sum +
            relationship.reinforcement,
          0,
        );

      assert.equal(
        totalReinforcement,
        3.25,
      );

      assert.match(
        snapshot.state_root,
        /^sha256:[a-f0-9]{64}$/,
      );

      /*
       * Duplicate evidence must NOT double-learn.
       */

      const duplicateResult =
        synaptizer.consume(
          deliveredEvents[0],
        );

      assert.equal(
        duplicateResult.duplicate,
        true,
      );

      assert.equal(
        duplicateResult.learned,
        false,
      );

      const afterDuplicate =
        synaptizer.snapshot();

      assert.equal(
        afterDuplicate.learned_events,
        3,
      );

      assert.equal(
        afterDuplicate.duplicate_events,
        1,
      );

      /*
       * Unverified evidence is accepted as observed history
       * but MUST NOT update relationship learning.
       */

      const unverifiedEvent =
        structuredClone(
          deliveredEvents[0],
        );

      unverifiedEvent.edge_execution_id =
        "sw03-unverified-edge-0001";

      unverifiedEvent.fitness_evidence
        .verified =
        false;

      /*
       * Preserve the required evidence-root shape for this
       * negative-path contract test.
       */
      unverifiedEvent.state_root =
        "sha256:" +
        "0".repeat(64);

      const unverifiedResult =
        synaptizer.consume(
          unverifiedEvent,
        );

      assert.equal(
        unverifiedResult.learned,
        false,
      );

      assert.equal(
        unverifiedResult.reason,
        "UNVERIFIED_EXECUTION_EVIDENCE",
      );

      const finalSnapshot =
        synaptizer.snapshot();

      assert.equal(
        finalSnapshot.learned_events,
        3,
      );

      assert.equal(
        finalSnapshot
          .ignored_unverified_events,
        1,
      );

      assert.equal(
        finalSnapshot
          .relationships.length,
        3,
      );
    }
    finally {
      boundary.close();
    }
  },
);
