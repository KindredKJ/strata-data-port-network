import assert from "node:assert/strict";

import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  spawnSync,
} from "node:child_process";

import test from "node:test";

import {
  CognitiveGraph,
  createCogniton,
  createProcessPortAttachment,
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

const here =
  dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const worker =
  join(
    here,
    "cognitive-state-continuation-worker.mjs",
  );

const fixedTime =
  Date.parse(
    "2026-09-01T22:10:00.000Z",
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
      `evidence-seed-${processId}`,
    ],

    verification_refs: [
      `verification-seed-${processId}`,
    ],

    contribution,
  });
}

test(
  "live Synaptizer rehydration continues learning after process restart and commits sequence 2",
  async () => {

    const temporaryRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "kindred-sw06-",
        ),
      );

    const statePath =
      join(
        temporaryRoot,
        "cognitive-state.json",
      );

    try {

      /*
       * ========================================================
       * COGNITIVE GRAPH
       * ========================================================
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
              "sw06-continuation-proof",
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

      /*
       * ========================================================
       * REAL FIRST-CYCLE PI EXECUTION
       * ========================================================
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
              `sw06-seed-grad-${processId}-${run}`,

            source_component:
              "sw06-seed-evidence",

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
                "sw06-seed-input",
                {
                  processId,
                  run,
                },
              ),

            output_state_root:
              stateRoot(
                "sw06-seed-output",
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

      const cache =
        new CapabilityCompositionCache();

      const prosynthesine =
        new ProSynthesine({
          registry,
          cache,
        });

      const contextRoot =
        stateRoot(
          "sw06-seed-context",
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
          "kindred.capability.sw06-seed.v1",

        capability_version:
          1,

        name:
          "SW06.SEED",

        role:
          "NORMALIZE_TRANSFORM_VERIFY",

        outcome_class:
          "VERIFIED_NUMERIC_RESULT",

        supported_contexts: [
          "deterministic_local",
        ],

        evidence_refs: [
          "evidence-sw06-seed",
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

      const synaptizer =
        new Synaptizer();

      const processObserver =
        new ProcessEdgeObserver({
          now:
            () => fixedTime,
        });

      const seedEvents = [];

      const boundary =
        new ProcessIntelligenceBoundaryAdapter({
          observer:
            processObserver,

          registry,

          prosynthesine,

          publish:
            (event) => {
              seedEvents.push(
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

        const firstExecution =
          await attachment.dispatch(
            "EXECUTE_CAPABILITY",

            {
              capability:
                promotion.capability,

              state: {
                value:
                  1,
              },

              correlation_id:
                "sw06-seed-execution",

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
                    (state) => ({
                      value:
                        state.value + 1,
                    }),
                  ),

                [skillB.skill_id]:
                  skillResult(
                    "process-b",
                    (state) => ({
                      value:
                        state.value * 2,
                    }),
                  ),

                [skillC.skill_id]:
                  skillResult(
                    "process-c",
                    (state) => ({
                      ...state,

                      verified:
                        state.value === 4,
                    }),
                    "VERIFICATION",
                  ),
              },

              verify:
                (state) =>
                  state.value === 4 &&
                  state.verified === true,
            },

            {
              capability_id:
                promotion
                  .capability
                  .capability_id,

              correlation_id:
                "sw06-seed-execution",

              execution_mode:
                "PRE_RESTART_SEED",
            },
          );

        assert.equal(
          firstExecution
            .result
            .verified,
          true,
        );

        assert.equal(
          seedEvents.length,
          3,
        );
      }
      finally {
        boundary.close();
      }

      const seedSnapshot =
        synaptizer.snapshot();

      assert.equal(
        seedSnapshot.relationships.length,
        3,
      );

      assert.equal(
        seedSnapshot.learned_events,
        3,
      );

      assert.equal(
        seedSnapshot.seen_event_ids.length,
        3,
      );

      const seedReinforcement =
        seedSnapshot
          .relationships
          .reduce(
            (sum, relationship) =>
              sum +
              relationship.reinforcement,
            0,
          );

      assert.equal(
        seedReinforcement,
        3.25,
      );

      /*
       * ========================================================
       * COMMIT SEQUENCE 1
       * ========================================================
       */

      const store =
        new PersistentCognitiveStateStore({
          path:
            statePath,
        });

      const firstCommit =
        await store.save({
          cognitive_graph:
            graphSnapshot,

          synaptic_snapshot:
            seedSnapshot,

          sequence:
            1,

          metadata: {
            wave:
              "SW06",

            phase:
              "before_restart",
          },
        });

      assert.equal(
        firstCommit.sequence,
        1,
      );

      /*
       * ========================================================
       * REAL SECOND NODE PROCESS
       * ========================================================
       */

      const restarted =
        spawnSync(
          process.execPath,
          [
            worker,
            statePath,
          ],
          {
            encoding:
              "utf8",

            windowsHide:
              true,
          },
        );

      if (
        restarted.status !== 0
      ) {
        throw new Error(
          [
            "continuation worker failed",
            restarted.stdout,
            restarted.stderr,
          ].join("\n"),
        );
      }

      const result =
        JSON.parse(
          restarted.stdout,
        );

      assert.notEqual(
        result.worker_process_id,
        process.pid,
      );

      assert.equal(
        result.recovered_sequence,
        1,
      );

      assert.equal(
        result.committed_sequence,
        2,
      );

      assert.equal(
        result.relationships_before,
        3,
      );

      assert.equal(
        result.relationships_after,
        3,
      );

      assert.equal(
        result.learned_events_before,
        3,
      );

      assert.equal(
        result.learned_events_after,
        6,
      );

      assert.equal(
        result.reinforcement_before,
        3.25,
      );

      assert.equal(
        result.reinforcement_after,
        6.5,
      );

      assert.equal(
        result.selected_process_port,
        "process.z-learned",
      );

      assert.equal(
        result.post_restart_execution_verified,
        true,
      );

      assert.equal(
        result.continued_learning_after_restart,
        true,
      );

      assert.equal(
        result.second_durable_commit,
        true,
      );

      assert.notEqual(
        result.recovered_state_root,
        result.continued_state_root,
      );

      assert.notEqual(
        result.recovered_synaptic_root,
        result.continued_synaptic_root,
      );

      /*
       * ========================================================
       * PARENT PROCESS CONFIRMS WORKER'S SECOND COMMIT
       * ========================================================
       */

      const finalState =
        await store.load();

      assert.equal(
        finalState.sequence,
        2,
      );

      assert.equal(
        finalState
          .synaptic_snapshot
          .learned_events,
        6,
      );

      assert.equal(
        finalState
          .synaptic_snapshot
          .relationships
          .length,
        3,
      );

      assert.equal(
        finalState
          .synaptic_snapshot
          .relationships
          .every(
            (relationship) =>
              relationship.observations ===
              2,
          ),
        true,
      );

      const finalReinforcement =
        finalState
          .synaptic_snapshot
          .relationships
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
    }
    finally {
      await rm(
        temporaryRoot,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);
