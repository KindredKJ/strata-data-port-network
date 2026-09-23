import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

export const COGNITIVE_STATE_STORE_CONTRACT_VERSION =
  "kindred.cognitive-state-store.v1";

export class CognitiveStateStoreError extends Error {
  constructor(
    code,
    message,
    details = undefined,
  ) {
    super(message);
    this.name =
      "CognitiveStateStoreError";
    this.code =
      code;
    this.details =
      details;
  }
}

function reject(
  code,
  message,
  details = undefined,
) {
  throw new CognitiveStateStoreError(
    code,
    message,
    details,
  );
}

function canonical(value) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(
        (item) =>
          canonical(item),
      )
      .join(",")}]`;
  }

  const keys =
    Object.keys(value).sort();

  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`,
    )
    .join(",")}}`;
}

export function persistentStateRoot(
  label,
  value,
) {
  if (
    typeof label !== "string" ||
    label.length === 0
  ) {
    reject(
      "persistent_state_label_invalid",
      "State-root label is required",
    );
  }

  return `sha256:${createHash("sha256")
    .update(
      `${label}:${canonical(value)}`,
    )
    .digest("hex")}`;
}

function validateGraphSnapshot(
  graph,
) {
  if (
    !graph ||
    typeof graph !== "object" ||
    typeof graph.state_root !== "string"
  ) {
    reject(
      "persistent_graph_invalid",
      "A canonical Cognitive Graph snapshot is required",
    );
  }
}

function validateSynapticSnapshot(
  snapshot,
) {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof snapshot.state_root !== "string" ||
    !Array.isArray(
      snapshot.relationships,
    )
  ) {
    reject(
      "persistent_synaptic_state_invalid",
      "A canonical Synaptizer snapshot is required",
    );
  }
}

function validateSequence(
  sequence,
) {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  ) {
    reject(
      "persistent_sequence_invalid",
      "State sequence must be a positive safe integer",
    );
  }
}

export class PersistentCognitiveStateStore {
  constructor({
    path,
  } = {}) {
    if (
      typeof path !== "string" ||
      path.length === 0
    ) {
      reject(
        "persistent_state_path_invalid",
        "Persistent state path is required",
      );
    }

    this.path =
      path;
  }

  async save({
    cognitive_graph,
    synaptic_snapshot,
    sequence,
    metadata = {},
  }) {
    validateGraphSnapshot(
      cognitive_graph,
    );

    validateSynapticSnapshot(
      synaptic_snapshot,
    );

    validateSequence(
      sequence,
    );

    const state = {
      contract_version:
        COGNITIVE_STATE_STORE_CONTRACT_VERSION,

      sequence,

      cognitive_graph:
        structuredClone(
          cognitive_graph,
        ),

      synaptic_snapshot:
        structuredClone(
          synaptic_snapshot,
        ),

      metadata:
        structuredClone(
          metadata,
        ),
    };

    const stateRoot =
      persistentStateRoot(
        "persistent-cognitive-state",
        state,
      );

    const envelope = {
      ...state,

      state_root:
        stateRoot,
    };

    await mkdir(
      dirname(
        this.path,
      ),
      {
        recursive:
          true,
      },
    );

    const temporaryPath =
      `${this.path}.tmp-${process.pid}`;

    await writeFile(
      temporaryPath,
      `${JSON.stringify(
        envelope,
        null,
        2,
      )}\n`,
      "utf8",
    );

    /*
     * Atomic replacement within the same filesystem.
     */

    await rename(
      temporaryPath,
      this.path,
    );

    return structuredClone(
      envelope,
    );
  }

  async load() {
    let raw;

    try {
      raw =
        await readFile(
          this.path,
          "utf8",
        );
    }
    catch (error) {
      reject(
        "persistent_state_read_failed",
        "Unable to read persistent cognitive state",
        {
          cause:
            error?.message ??
            String(error),
        },
      );
    }

    let envelope;

    try {
      envelope =
        JSON.parse(
          raw,
        );
    }
    catch {
      reject(
        "persistent_state_json_invalid",
        "Persistent cognitive state is not valid JSON",
      );
    }

    if (
      envelope.contract_version !==
      COGNITIVE_STATE_STORE_CONTRACT_VERSION
    ) {
      reject(
        "persistent_state_contract_invalid",
        "Persistent cognitive state contract version is invalid",
      );
    }

    validateSequence(
      envelope.sequence,
    );

    validateGraphSnapshot(
      envelope.cognitive_graph,
    );

    validateSynapticSnapshot(
      envelope.synaptic_snapshot,
    );

    if (
      typeof envelope.state_root !==
        "string"
    ) {
      reject(
        "persistent_state_root_missing",
        "Persistent cognitive state commitment is missing",
      );
    }

    const material = {
      contract_version:
        envelope.contract_version,

      sequence:
        envelope.sequence,

      cognitive_graph:
        envelope.cognitive_graph,

      synaptic_snapshot:
        envelope.synaptic_snapshot,

      metadata:
        envelope.metadata ??
        {},
    };

    const expectedRoot =
      persistentStateRoot(
        "persistent-cognitive-state",
        material,
      );

    if (
      expectedRoot !==
      envelope.state_root
    ) {
      reject(
        "persistent_state_integrity_mismatch",
        "Persistent cognitive state commitment does not match its contents",
      );
    }

    return structuredClone(
      envelope,
    );
  }
}
