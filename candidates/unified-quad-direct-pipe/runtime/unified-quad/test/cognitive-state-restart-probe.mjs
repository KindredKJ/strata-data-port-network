import assert from "node:assert/strict";

import {
  COGNITIVE_PORT_TYPES,
  CognitivePortFabric,
  DCMLCompiler,
} from "../src/cognitive-body.mjs";

import {
  PersistentCognitiveStateStore,
} from "../src/cognitive-state-store.mjs";

const statePath =
  process.argv[2];

if (!statePath) {
  throw new Error(
    "state path required",
  );
}

/*
 * This is intentionally a separate Node process.
 * It has no in-memory access to the process that created
 * the Synaptizer state.
 */

const store =
  new PersistentCognitiveStateStore({
    path:
      statePath,
  });

const recovered =
  await store.load();

const fabric =
  new CognitivePortFabric();

fabric.registerPort(
  {
    port_id:
      "intent.sw05.restart",

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

  async ({ state }) =>
    state,
);

fabric.registerPort(
  {
    port_id:
      "cogniton.sw05.restart",

    port_type:
      COGNITIVE_PORT_TYPES.COGNITON,

    role:
      "RESTORED_COGNITIVE_STATE",

    priority:
      100,

    intent_classes: [
      "NORMALIZE_TRANSFORM_VERIFY",
    ],
  },

  async ({ state }) =>
    state,
);

/*
 * Baseline path.
 * Lexicographically first if evidence is absent.
 */

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

  async ({ state }) =>
    state,
);

/*
 * Learned path references the relationships that were
 * committed before restart.
 */

fabric.registerPort(
  {
    port_id:
      "process.z-learned",

    port_type:
      COGNITIVE_PORT_TYPES.PROCESS,

    role:
      "RECOVERED_EVIDENCE_BACKED_PATH",

    priority:
      100,

    intent_classes: [
      "NORMALIZE_TRANSFORM_VERIFY",
    ],

    evidence_targets: [
      "kindred.process-skill.process-a.v1",
      "kindred.process-skill.process-b.v1",
      "kindred.process-skill.process-c.v1",
    ],

    verification_required:
      true,
  },

  async ({ state }) =>
    state,
);

fabric.registerPort(
  {
    port_id:
      "verification.sw05.restart",

    port_type:
      COGNITIVE_PORT_TYPES.VERIFICATION,

    role:
      "VERIFY_RECOVERED_SELECTION",

    priority:
      100,

    intent_classes: [
      "NORMALIZE_TRANSFORM_VERIFY",
    ],
  },

  async ({ state }) =>
    state,
);

const compiler =
  new DCMLCompiler();

const fabricSnapshot =
  fabric.snapshot();

/*
 * Control comparison:
 * without recovered learning, baseline wins.
 */

const withoutRecoveredLearning =
  compiler.compile({
    intent_class:
      "NORMALIZE_TRANSFORM_VERIFY",

    graph:
      recovered.cognitive_graph,

    fabric:
      fabricSnapshot,

    context_ref:
      "deterministic_local",

    authority_scope:
      "LOCAL_RESTART_PROBE",

    verification_required:
      true,
  });

assert.equal(
  withoutRecoveredLearning
    .process_port_id,
  "process.a-baseline",
);

/*
 * Actual restart recovery:
 * persisted Synaptizer state must alter the decision.
 */

const withRecoveredLearning =
  compiler.compile({
    intent_class:
      "NORMALIZE_TRANSFORM_VERIFY",

    graph:
      recovered.cognitive_graph,

    fabric:
      fabricSnapshot,

    synaptic_snapshot:
      recovered.synaptic_snapshot,

    context_ref:
      "deterministic_local",

    authority_scope:
      "LOCAL_RESTART_PROBE",

    verification_required:
      true,
  });

assert.equal(
  withRecoveredLearning
    .process_port_id,
  "process.z-learned",
);

const learnedTrace =
  withRecoveredLearning
    .process_selection_trace
    .find(
      (entry) =>
        entry.port_id ===
        "process.z-learned",
    );

const baselineTrace =
  withRecoveredLearning
    .process_selection_trace
    .find(
      (entry) =>
        entry.port_id ===
        "process.a-baseline",
    );

assert.ok(
  learnedTrace,
);

assert.ok(
  baselineTrace,
);

assert.equal(
  learnedTrace.synaptic_score,
  3.25,
);

assert.equal(
  baselineTrace.synaptic_score,
  0,
);

console.log(
  JSON.stringify(
    {
      process_id:
        process.pid,

      recovered_sequence:
        recovered.sequence,

      persistent_state_root:
        recovered.state_root,

      recovered_graph_state_root:
        recovered
          .cognitive_graph
          .state_root,

      recovered_synaptic_state_root:
        recovered
          .synaptic_snapshot
          .state_root,

      relationships_recovered:
        recovered
          .synaptic_snapshot
          .relationships
          .length,

      selection_without_learning:
        withoutRecoveredLearning
          .process_port_id,

      selection_with_recovered_learning:
        withRecoveredLearning
          .process_port_id,

      learned_synaptic_score:
        learnedTrace
          .synaptic_score,

      baseline_synaptic_score:
        baselineTrace
          .synaptic_score,

      adaptive_decision_survived_restart:
        true,
    },
    null,
    2,
  ),
);
