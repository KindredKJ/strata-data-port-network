import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
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
} from "../src/cognitive-body.mjs";

import {
  Synaptizer,
  synapticStateRoot,
} from "../src/synaptizer.mjs";

import {
  CognitiveStateStoreError,
  PersistentCognitiveStateStore,
} from "../src/cognitive-state-store.mjs";

const here =
  dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const restartProbe =
  join(
    here,
    "cognitive-state-restart-probe.mjs",
  );

function edgeEvent({
  id,
  source,
  target,
  sourceRole,
  targetRole,
  contribution = "EXECUTION",
}) {
  const material = {
    contract_version:
      "kindred.process-intelligence-event.v1",

    event_type:
      "PROCESS_EDGE_EVIDENCE",

    edge_relationship: {
      source_component:
        source,

      target_component:
        target,

      source_role:
        sourceRole,

      target_role:
        targetRole,
    },

    context_ref:
      "deterministic_local",

    success:
      true,

    failure:
      false,

    recovery:
      false,

    verification_contribution:
      contribution ===
      "VERIFICATION",

    fitness_evidence: {
      verified:
        true,

      latency:
        1,

      retry_count:
        0,

      fallback_count:
        0,

      evidence_refs: [
        `evidence-${id}`,
      ],

      verification_refs: [
        `verification-${id}`,
      ],
    },

    edge_execution_id:
      id,
  };

  return {
    ...material,

    state_root:
      synapticStateRoot(
        "sw05-process-edge-event",
        material,
      ),
  };
}

test(
  "cognitive and learned synaptic state survives a real process restart and preserves the adaptive decision",
  async () => {

    const temporaryRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "kindred-sw05-",
        ),
      );

    const statePath =
      join(
        temporaryRoot,
        "cognitive-state.json",
      );

    try {
      /*
       * --------------------------------------------------------
       * REAL COGNITIVE GRAPH SNAPSHOT
       * --------------------------------------------------------
       */

      const cogniton =
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
              "sw05-persistence-proof",
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
       * --------------------------------------------------------
       * REAL SYNAPTIZER STATE
       *
       * SW03/SW04 already prove these events can originate
       * from the real PI execution path.
       *
       * SW05 isolates only persistence/recovery.
       * --------------------------------------------------------
       */

      const synaptizer =
        new Synaptizer();

      const events = [
        edgeEvent({
          id:
            "sw05-edge-a",

          source:
            "capability_port",

          target:
            "kindred.process-skill.process-a.v1",

          sourceRole:
            "PROSYNTHESIZED_CAPABILITY",

          targetRole:
            "NORMALIZE_INPUT",
        }),

        edgeEvent({
          id:
            "sw05-edge-b",

          source:
            "kindred.process-skill.process-a.v1",

          target:
            "kindred.process-skill.process-b.v1",

          sourceRole:
            "PROCESS_SKILL",

          targetRole:
            "TRANSFORM_VALUE",
        }),

        edgeEvent({
          id:
            "sw05-edge-c",

          source:
            "kindred.process-skill.process-b.v1",

          target:
            "kindred.process-skill.process-c.v1",

          sourceRole:
            "PROCESS_SKILL",

          targetRole:
            "VERIFY_OUTPUT",

          contribution:
            "VERIFICATION",
        }),
      ];

      for (
        const event of events
      ) {
        const result =
          synaptizer.consume(
            event,
          );

        assert.equal(
          result.learned,
          true,
        );
      }

      const synapticSnapshot =
        synaptizer.snapshot();

      assert.equal(
        synapticSnapshot
          .relationships
          .length,
        3,
      );

      const reinforcement =
        synapticSnapshot
          .relationships
          .reduce(
            (sum, relationship) =>
              sum +
              relationship
                .reinforcement,
            0,
          );

      assert.equal(
        reinforcement,
        3.25,
      );

      /*
       * --------------------------------------------------------
       * COMMIT DURABLE STATE
       * --------------------------------------------------------
       */

      const store =
        new PersistentCognitiveStateStore({
          path:
            statePath,
        });

      const committed =
        await store.save({
          cognitive_graph:
            graphSnapshot,

          synaptic_snapshot:
            synapticSnapshot,

          sequence:
            1,

          metadata: {
            wave:
              "SW05",

            purpose:
              "restart-recovery-proof",
          },
        });

      assert.match(
        committed.state_root,
        /^sha256:[a-f0-9]{64}$/,
      );

      const loadedInWriterProcess =
        await store.load();

      assert.equal(
        loadedInWriterProcess
          .state_root,
        committed.state_root,
      );

      assert.equal(
        loadedInWriterProcess
          .cognitive_graph
          .state_root,
        graphSnapshot.state_root,
      );

      assert.equal(
        loadedInWriterProcess
          .synaptic_snapshot
          .state_root,
        synapticSnapshot.state_root,
      );

      /*
       * --------------------------------------------------------
       * REAL RESTART BOUNDARY
       *
       * A new Node process must recover the state and independently
       * compile the learned DCML decision.
       * --------------------------------------------------------
       */

      const restarted =
        spawnSync(
          process.execPath,
          [
            restartProbe,
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
            "restart probe failed",
            restarted.stdout,
            restarted.stderr,
          ].join("\n"),
        );
      }

      const restartResult =
        JSON.parse(
          restarted.stdout,
        );

      assert.notEqual(
        restartResult.process_id,
        process.pid,
      );

      assert.equal(
        restartResult
          .recovered_sequence,
        1,
      );

      assert.equal(
        restartResult
          .persistent_state_root,
        committed.state_root,
      );

      assert.equal(
        restartResult
          .recovered_graph_state_root,
        graphSnapshot.state_root,
      );

      assert.equal(
        restartResult
          .recovered_synaptic_state_root,
        synapticSnapshot.state_root,
      );

      assert.equal(
        restartResult
          .relationships_recovered,
        3,
      );

      assert.equal(
        restartResult
          .selection_without_learning,
        "process.a-baseline",
      );

      assert.equal(
        restartResult
          .selection_with_recovered_learning,
        "process.z-learned",
      );

      assert.equal(
        restartResult
          .learned_synaptic_score,
        3.25,
      );

      assert.equal(
        restartResult
          .adaptive_decision_survived_restart,
        true,
      );

      /*
       * --------------------------------------------------------
       * CORRUPTION REJECTION
       * --------------------------------------------------------
       */

      const originalRaw =
        await readFile(
          statePath,
          "utf8",
        );

      const corrupted =
        JSON.parse(
          originalRaw,
        );

      corrupted
        .synaptic_snapshot
        .relationships[0]
        .reinforcement =
        999;

      await writeFile(
        statePath,
        `${JSON.stringify(
          corrupted,
          null,
          2,
        )}\n`,
        "utf8",
      );

      await assert.rejects(
        () =>
          store.load(),

        (error) =>
          error instanceof
            CognitiveStateStoreError &&
          error.code ===
            "persistent_state_integrity_mismatch",
      );

      /*
       * Restore original committed state and prove it loads again.
       */

      await writeFile(
        statePath,
        originalRaw,
        "utf8",
      );

      const restored =
        await store.load();

      assert.equal(
        restored.state_root,
        committed.state_root,
      );

      /*
       * --------------------------------------------------------
       * CONTRACT-VERSION REJECTION
       * --------------------------------------------------------
       */

      const wrongContract =
        JSON.parse(
          originalRaw,
        );

      wrongContract.contract_version =
        "kindred.invalid-state.v999";

      await writeFile(
        statePath,
        `${JSON.stringify(
          wrongContract,
          null,
          2,
        )}\n`,
        "utf8",
      );

      await assert.rejects(
        () =>
          store.load(),

        (error) =>
          error instanceof
            CognitiveStateStoreError &&
          error.code ===
            "persistent_state_contract_invalid",
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
