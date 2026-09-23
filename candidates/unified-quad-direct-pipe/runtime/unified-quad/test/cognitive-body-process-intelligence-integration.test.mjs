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
  ProcessIntelligenceBoundaryAdapter,
  ProcessSkillRegistry,
  ProSynthesine,
} from "../src/process-intelligence.mjs";

test(
  "real Process Intelligence attachment through canonical Cognitive Process Port",
  async () => {
    const fixedTime =
      Date.parse("2026-09-01T21:15:00.000Z");

    /*
     * REAL PROCESS INTELLIGENCE DEPENDENCIES
     *
     * No fake boundary.
     * No monkey-patched adapter.
     * No fabricated Process Skill.
     */

    const observer =
      new ProcessEdgeObserver({
        now: () => fixedTime,
      });

    const registry =
      new ProcessSkillRegistry();

    const cache =
      new CapabilityCompositionCache();

    const prosynthesine =
      new ProSynthesine({
        registry,
        cache,
      });

    const publishedEvents = [];

    const boundary =
      new ProcessIntelligenceBoundaryAdapter({
        observer,
        registry,
        prosynthesine,
        publish: (event) => {
          publishedEvents.push(event);
        },
      });

    try {
      /*
       * Attach the REAL boundary to the canonical Process Port
       * attachment contract introduced in the Cognitive Body.
       */

      const attachment =
        createProcessPortAttachment(boundary);

      assert.equal(
        boundary.mapPort("PROCESS"),
        "PROCESS_PORT",
      );

      assert.equal(
        typeof attachment.request,
        "function",
      );

      assert.equal(
        typeof attachment.dispatch,
        "function",
      );

      assert.equal(
        attachment.request_types.includes(
          "DISCOVER_PROCESS_SKILLS",
        ),
        true,
      );

      /*
       * Create canonical cognitive state.
       */

      const intentCogniton =
        createCogniton({
          kind: "INTENT",

          value: {
            intent_class:
              "TEST.REAL_PI_DISCOVERY",

            desired_outcome:
              "VERIFIED_NUMERIC_RESULT",

            context:
              "deterministic_local",
          },

          provenance: {
            source:
              "sw02b1c-real-pi-attachment-proof",
          },
        });

      const graph =
        new CognitiveGraph();

      graph.add(intentCogniton);
      graph.activate(
        intentCogniton.cogniton_id,
      );

      const graphSnapshot =
        graph.snapshot();

      /*
       * Canonical Cognitive Port Fabric.
       */

      const fabric =
        new CognitivePortFabric();

      fabric.registerPort(
        {
          port_id:
            "intent.kindred.default",

          port_type:
            COGNITIVE_PORT_TYPES.INTENT,

          role:
            "NORMALIZE_INTENT",

          priority:
            100,

          intent_classes: [
            "TEST.REAL_PI_DISCOVERY",
          ],
        },

        async ({ state }) => ({
          ...state,

          normalized_intent: {
            intent_class:
              "TEST.REAL_PI_DISCOVERY",

            desired_outcome:
              "VERIFIED_NUMERIC_RESULT",

            context:
              "deterministic_local",
          },
        }),
      );

      fabric.registerPort(
        {
          port_id:
            "cogniton.kindred.default",

          port_type:
            COGNITIVE_PORT_TYPES.COGNITON,

          role:
            "MATERIALIZE_ACTIVE_COGNITIVE_STATE",

          priority:
            100,

          intent_classes: [
            "TEST.REAL_PI_DISCOVERY",
          ],
        },

        async ({ state }) => ({
          ...state,

          cognitive_graph_state_root:
            graphSnapshot.state_root,
        }),
      );

      /*
       * This is the nerve attachment.
       *
       * The handler below calls the REAL
       * ProcessIntelligenceBoundaryAdapter through
       * createProcessPortAttachment().
       */

      fabric.registerPort(
        {
          port_id:
            "process.kindred",

          port_type:
            COGNITIVE_PORT_TYPES.PROCESS,

          role:
            "EXECUTE_PROCESS_INTELLIGENCE",

          priority:
            100,

          intent_classes: [
            "TEST.REAL_PI_DISCOVERY",
          ],

          verification_required:
            true,
        },

        async ({ state }) => {
          const execution =
            await attachment.dispatch(
              "DISCOVER_PROCESS_SKILLS",

              {
                outcome_class:
                  "VERIFIED_NUMERIC_RESULT",

                context:
                  "deterministic_local",
              },
            );

          return {
            ...state,

            process_intelligence: {
              request:
                execution.request,

              result:
                execution.result,

              mapped_process_port:
                boundary.mapPort(
                  "PROCESS",
                ),

              cache_evidence:
                boundary.cacheEvidence(),
            },
          };
        },
      );

      /*
       * Verification Port verifies the actual
       * Process Intelligence response crossing the
       * cognitive boundary.
       */

      fabric.registerPort(
        {
          port_id:
            "verification.kindred.default",

          port_type:
            COGNITIVE_PORT_TYPES.VERIFICATION,

          role:
            "VERIFY_PROCESS_INTELLIGENCE_ATTACHMENT",

          priority:
            100,

          intent_classes: [
            "TEST.REAL_PI_DISCOVERY",
          ],
        },

        async ({ state }) => {
          const pi =
            state.process_intelligence;

          const checks = {
            request_present:
              !!pi?.request,

            canonical_request_type:
              pi?.request?.request_type ===
              "DISCOVER_PROCESS_SKILLS",

            no_external_effects_authorized:
              pi?.request
                ?.external_effects_authorized ===
              false,

            no_authority_escalation_authorized:
              pi?.request
                ?.authority_escalation_authorized ===
              false,

            result_is_array:
              Array.isArray(pi?.result),

            canonical_process_port:
              pi?.mapped_process_port ===
              "PROCESS_PORT",

            registry_count_is_numeric:
              Number.isSafeInteger(
                pi?.cache_evidence
                  ?.process_skill_reuse,
              ),
          };

          const verified =
            Object.values(
              checks,
            ).every(Boolean);

          const proofMaterial = {
            checks,

            request_type:
              pi?.request?.request_type ??
              null,

            result_count:
              Array.isArray(pi?.result)
                ? pi.result.length
                : null,

            mapped_process_port:
              pi?.mapped_process_port ??
              null,

            graph_state_root:
              state
                .cognitive_graph_state_root ??
              null,
          };

          return {
            ...state,

            verified,

            proof_carrying_outcome: {
              kind:
                "REAL_PROCESS_INTELLIGENCE_ATTACHMENT",

              verification:
                checks,

              state_root:
                cognitiveStateRoot(
                  "real-process-intelligence-attachment",
                  proofMaterial,
                ),
            },
          };
        },
      );

      /*
       * DCML chooses the active pathway.
       */

      const compiler =
        new DCMLCompiler();

      const fabricSnapshot =
        fabric.snapshot();

      const planA =
        compiler.compile({
          intent_class:
            "TEST.REAL_PI_DISCOVERY",

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
            "TEST.REAL_PI_DISCOVERY",

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
       * DCML compilation must remain deterministic.
       */

      assert.equal(
        planA.state_root,
        planB.state_root,
      );

      assert.deepEqual(
        planA.active_port_ids,
        [
          "intent.kindred.default",
          "cogniton.kindred.default",
          "process.kindred",
          "verification.kindred.default",
        ],
      );

      /*
       * Execute the ACTUAL end-to-end local attachment.
       */

      const outcome =
        await executeActivationPlan({
          plan:
            planA,

          fabric,

          payload: {
            request_id:
              "sw02b1c-real-pi-attachment-0001",
          },
        });

      /*
       * Attachment proof.
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
        "DISCOVER_PROCESS_SKILLS",
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
          .mapped_process_port,
        "PROCESS_PORT",
      );

      assert.equal(
        Array.isArray(
          outcome
            .process_intelligence
            .result,
        ),
        true,
      );

      /*
       * Empty registry is valid.
       *
       * The point of this proof is the REAL boundary
       * crossing, not fabricated Skill inventory.
       */

      assert.equal(
        outcome
          .process_intelligence
          .result
          .length,
        0,
      );

      assert.equal(
        typeof outcome
          .proof_carrying_outcome
          .state_root,
        "string",
      );

      assert.match(
        outcome
          .proof_carrying_outcome
          .state_root,
        /^[a-f0-9]{64}$/,
      );

      /*
       * DISCOVER_PROCESS_SKILLS itself does not create
       * Process Edge evidence, so no Synaptizer event
       * should be falsely expected here.
       */

      assert.equal(
        publishedEvents.length,
        0,
      );
    }
    finally {
      boundary.close();
    }
  },
);
