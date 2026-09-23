import assert from "node:assert/strict";
import test from "node:test";

import {
  COGNITIVE_PORT_TYPES,
  CognitiveGraph,
  CognitivePortFabric,
  DCMLCompiler,
  cognitiveStateRoot,
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

const fixedTime =
  Date.parse("2026-09-01T21:30:00.000Z");

function genome(processId, role) {
  return createProcessGenome({
    process_id: processId,
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
      new Date(fixedTime).toISOString(),
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
      "local_deterministic_fixture_only",
    ],

    evidence_refs: [
      `evidence-graduation-${processId}`,
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
  "real promoted ProSynthesized Capability executes through the attached cognitive body",
  async () => {

    /*
     * ----------------------------------------------------------
     * 1. ESTABLISH VERIFIED REPEATED PROCESS EVIDENCE
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

    const graduationObserver =
      new ProcessEdgeObserver({
        now: () => fixedTime,
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
            `sw02b2-graduation-${processId}-${run}`,

          source_component:
            "sw02b2-graduation-fixture",

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
              "graduation-input",
              {
                processId,
                run,
              },
            ),

          output_state_root:
            stateRoot(
              "graduation-output",
              {
                processId,
                run,
                success: true,
              },
            ),

          start_time:
            fixedTime + run * 2,

          end_time:
            fixedTime + run * 2 + 1,

          cost:
            0,

          success:
            true,

          verified:
            true,

          evidence_refs: [
            `evidence-${processId}-${run}`,
          ],

          verification_refs: [
            `verification-${processId}-${run}`,
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
            processId === "process-c"
              ? "VERIFICATION"
              : "EXECUTION",
        });
      }
    }

    const fitness =
      new ProcessFitnessTracker(
        graduationObserver,
      );

    const policy =
      new ProcessSkillGraduationPolicy({
        execution_count:
          3,

        verified_success_count:
          3,

        success_rate:
          1,

        verification_rate:
          1,
      });

    const registry =
      new ProcessSkillRegistry(
        policy,
      );

    const skillA =
      registry.graduate(
        genomes.a,
        graduationEvidence(
          fitness.profile("process-a"),
          "process-a",
        ),
      );

    const skillB =
      registry.graduate(
        genomes.b,
        graduationEvidence(
          fitness.profile("process-b"),
          "process-b",
        ),
      );

    const skillC =
      registry.graduate(
        genomes.c,
        graduationEvidence(
          fitness.profile("process-c"),
          "process-c",
        ),
      );

    assert.equal(
      registry.skills.size,
      3,
    );

    /*
     * ----------------------------------------------------------
     * 2. REAL PROSYNTHESINE
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
        "sw02b2-context",
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
        "kindred.capability.sw02b2.v1",

      capability_version:
        1,

      name:
        "SW02B2.PROCESS.PROOF",

      role:
        "NORMALIZE_TRANSFORM_VERIFY",

      outcome_class:
        "VERIFIED_NUMERIC_RESULT",

      supported_contexts: [
        "deterministic_local",
      ],

      evidence_refs: [
        "evidence-sw02b2-three-skill-graduation",
      ],
    };

    const candidate =
      prosynthesine.synthesize(
        synthesisInput,
      );

    assert.equal(
      candidate.cache_hit,
      false,
    );

    assert.equal(
      candidate.discovery_count,
      3,
    );

    assert.equal(
      candidate.capability.status,
      "CANDIDATE",
    );

    /*
     * Promotion remains gated.
     */

    assert.throws(
      () =>
        prosynthesine.promote(
          candidate.capability,
          {
            intent_class:
              synthesisInput.intent_class,

            context_root:
              contextRoot,
          },
        ),

      (error) =>
        error.reasonClass ===
        "capability_promotion_evidence_incomplete",
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
     * 3. REAL ATTACHED PROCESS INTELLIGENCE BOUNDARY
     * ----------------------------------------------------------
     */

    const processObserver =
      new ProcessEdgeObserver({
        now: () => fixedTime,
      });

    const outboundLearningEvents = [];

    const boundary =
      new ProcessIntelligenceBoundaryAdapter({
        observer:
          processObserver,

        registry,

        prosynthesine,

        publish:
          (event) => {
            outboundLearningEvents.push(
              event,
            );
          },
      });

    try {
      const attachment =
        createProcessPortAttachment(
          boundary,
        );

      assert.equal(
        boundary.mapPort("PROCESS"),
        "PROCESS_PORT",
      );

      /*
       * --------------------------------------------------------
       * 4. COGNITIVE BODY
       * --------------------------------------------------------
       */

      const intentCogniton =
        createCogniton({
          kind:
            "INTENT",

          value: {
            intent_class:
              "NORMALIZE_TRANSFORM_VERIFY",

            desired_outcome:
              "VERIFIED_NUMERIC_RESULT",
          },

          provenance: {
            source:
              "sw02b2-capability-body-proof",
          },
        });

      const graph =
        new CognitiveGraph();

      graph.add(
        intentCogniton,
      );

      graph.activate(
        intentCogniton.cogniton_id,
      );

      const graphSnapshot =
        graph.snapshot();

      const fabric =
        new CognitivePortFabric();

      fabric.registerPort(
        {
          port_id:
            "intent.kindred.sw02b2",

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
            "cogniton.kindred.sw02b2",

          port_type:
            COGNITIVE_PORT_TYPES.COGNITON,

          role:
            "MATERIALIZE_ACTIVE_COGNITIVE_STATE",

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
       * --------------------------------------------------------
       * REAL PROCESS PORT EXECUTION
       * --------------------------------------------------------
       */

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
            "sw02b2-capability-execution-0001";

          /*
           * Runtime execution context.
           *
           * Contains functions/observer and therefore does NOT
           * belong inside the serializable control receipt.
           */

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

          /*
           * Serializable control-plane request receipt.
           */

          const receiptPayload = {
            capability_id:
              promotion.capability.capability_id,

            capability_version:
              promotion.capability.capability_version,

            capability_state_root:
              promotion.state_root,

            intent_class:
              synthesisInput.intent_class,

            context_root:
              contextRoot,

            correlation_id:
              correlationId,

            authority_ref:
              "authority-local-fixture",

            execution_mode:
              "LOCAL_DETERMINISTIC",

            side_effect_class:
              promotion.capability.side_effect_class,
          };

          const execution =
            await attachment.dispatch(
              "EXECUTE_CAPABILITY",
              executionPayload,
              receiptPayload,
            );

          return {
            ...state,

            process_intelligence: {
              request:
                execution.request,

              result:
                execution.result,
            },
          };
        },
      );

      /*
       * --------------------------------------------------------
       * VERIFICATION PORT
       * --------------------------------------------------------
       */

      fabric.registerPort(
        {
          port_id:
            "verification.kindred.sw02b2",

          port_type:
            COGNITIVE_PORT_TYPES.VERIFICATION,

          role:
            "VERIFY_PROSYNTHESIZED_CAPABILITY_OUTCOME",

          priority:
            100,

          intent_classes: [
            "NORMALIZE_TRANSFORM_VERIFY",
          ],
        },

        async ({ state }) => {
          const pi =
            state.process_intelligence;

          const result =
            pi?.result;

          const checks = {
            canonical_request:
              pi?.request?.request_type ===
              "EXECUTE_CAPABILITY",

            no_external_effect_authority:
              pi?.request
                ?.external_effects_authorized ===
              false,

            no_authority_escalation:
              pi?.request
                ?.authority_escalation_authorized ===
              false,

            capability_verified:
              result?.verified === true,

            value_is_four:
              result?.state?.value === 4,

            skill_verification_present:
              result?.state?.verified === true,

            three_skills_completed:
              result?.completed?.length === 3,

            process_edges_recorded:
              processObserver.records.length === 3,

            learning_events_emitted:
              outboundLearningEvents.length === 3,
          };

          const verified =
            Object.values(
              checks,
            ).every(Boolean);

          return {
            ...state,

            verified,

            proof_carrying_outcome: {
              kind:
                "REAL_PROSYNTHESIZED_CAPABILITY_VIA_COGNITIVE_BODY",

              checks,

              capability_id:
                promotion.capability.capability_id,

              process_outcome_state_root:
                result?.outcome_state_root ??
                null,

              cognitive_proof_state_root:
                cognitiveStateRoot(
                  "sw02b2-proof-carrying-outcome",
                  {
                    capability_id:
                      promotion.capability.capability_id,

                    checks,

                    process_outcome_state_root:
                      result?.outcome_state_root ??
                      null,
                  },
                ),
            },
          };
        },
      );

      /*
       * --------------------------------------------------------
       * 5. DCML ACTIVATION
       * --------------------------------------------------------
       */

      const compiler =
        new DCMLCompiler();

      const fabricSnapshot =
        fabric.snapshot();

      const planA =
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

      const planB =
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

      assert.equal(
        planA.state_root,
        planB.state_root,
      );

      assert.deepEqual(
        planA.active_port_ids,
        [
          "intent.kindred.sw02b2",
          "cogniton.kindred.sw02b2",
          "process.kindred",
          "verification.kindred.sw02b2",
        ],
      );

      /*
       * --------------------------------------------------------
       * 6. EXECUTE THE FULL LOCAL PATH
       * --------------------------------------------------------
       */

      const outcome =
        await executeActivationPlan({
          plan:
            planA,

          fabric,

          payload: {
            request_id:
              "sw02b2-request-0001",

            capability_input: {
              value:
                1,
            },
          },
        });

      /*
       * --------------------------------------------------------
       * 7. HARD ASSERTIONS
       * --------------------------------------------------------
       */

      assert.equal(
        outcome.verified,
        true,
      );

      assert.equal(
        outcome
          .process_intelligence
          .request
          .request_type,
        "EXECUTE_CAPABILITY",
      );

      assert.equal(
        outcome
          .process_intelligence
          .request
          .external_effects_authorized,
        false,
      );

      assert.equal(
        outcome
          .process_intelligence
          .request
          .authority_escalation_authorized,
        false,
      );

      assert.equal(
        outcome
          .process_intelligence
          .result
          .verified,
        true,
      );

      assert.deepEqual(
        outcome
          .process_intelligence
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
        outcome
          .process_intelligence
          .result
          .completed
          .length,
        3,
      );

      /*
       * Real Process Edge evidence.
       */

      assert.equal(
        processObserver.records.length,
        3,
      );

      assert.deepEqual(
        processObserver.records.map(
          (record) =>
            record.process_id,
        ),
        [
          "process-a",
          "process-b",
          "process-c",
        ],
      );

      /*
       * The real boundary subscribed to this same observer,
       * therefore every execution edge is translated through
       * toSynaptizerEvent().
       */

      assert.equal(
        outboundLearningEvents.length,
        3,
      );

      assert.equal(
        outboundLearningEvents.every(
          (event) =>
            event.event_type ===
            "PROCESS_EDGE_EVIDENCE",
        ),
        true,
      );

      assert.equal(
        outboundLearningEvents[2]
          .verification_contribution,
        true,
      );

      /*
       * This proves event emission, NOT a real Synaptizer
       * consumer/learning implementation.
       */

      assert.equal(
        typeof outcome
          .proof_carrying_outcome
          .cognitive_proof_state_root,
        "string",
      );

      assert.match(
        outcome
          .proof_carrying_outcome
          .cognitive_proof_state_root,
        /^[a-f0-9]{64}$/,
      );

      assert.match(
        outcome
          .process_intelligence
          .result
          .outcome_state_root,
        /^sha256:[a-f0-9]{64}$/,
      );

      /*
       * Promotion cached the proven capability.
       */

      const reused =
        prosynthesine.synthesize(
          synthesisInput,
        );

      assert.equal(
        reused.cache_hit,
        true,
      );

      assert.equal(
        reused.discovery_count,
        0,
      );
    }
    finally {
      boundary.close();
    }
  },
);
