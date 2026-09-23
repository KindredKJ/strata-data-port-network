import { createHash } from "node:crypto";

export const SYNAPTIZER_CONTRACT_VERSION =
  "kindred.synaptizer.v1";

export const SYNAPTIC_RELATIONSHIP_CONTRACT_VERSION =
  "kindred.synaptic-relationship.v1";

export const SYNAPTIZER_SNAPSHOT_CONTRACT_VERSION =
  "kindred.synaptizer-snapshot.v1";

export class SynaptizerError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "SynaptizerError";
    this.code = code;
    this.details = details;
  }
}

function reject(code, message, details = undefined) {
  throw new SynaptizerError(
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
      .map((item) => canonical(item))
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

export function synapticStateRoot(
  label,
  value,
) {
  if (
    typeof label !== "string" ||
    label.length === 0
  ) {
    reject(
      "invalid_state_root_label",
      "Synaptizer state-root label is required",
    );
  }

  return `sha256:${createHash("sha256")
    .update(`${label}:${canonical(value)}`)
    .digest("hex")}`;
}

function nonEmpty(value, code) {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    reject(
      code,
      `${code}: non-empty string required`,
    );
  }

  return value;
}

function relationshipIdentity(event) {
  const edge =
    event.edge_relationship;

  return {
    source_component:
      nonEmpty(
        edge.source_component,
        "synaptic_source_component_invalid",
      ),

    target_component:
      nonEmpty(
        edge.target_component,
        "synaptic_target_component_invalid",
      ),

    source_role:
      nonEmpty(
        edge.source_role,
        "synaptic_source_role_invalid",
      ),

    target_role:
      nonEmpty(
        edge.target_role,
        "synaptic_target_role_invalid",
      ),

    context_ref:
      event.context_ref ?? null,
  };
}

function reinforcement(event) {
  if (
    event.failure === true &&
    event.fitness_evidence?.verified === true
  ) {
    return -1;
  }

  if (event.recovery === true) {
    return 1.5;
  }

  if (
    event.verification_contribution === true
  ) {
    return 1.25;
  }

  if (event.success === true) {
    return 1;
  }

  return 0.25;
}

export class Synaptizer {
  constructor() {
    this.relationships = new Map();
    this.seenEvents = new Set();

    this.receivedEvents = 0;
    this.learnedEvents = 0;
    this.ignoredUnverifiedEvents = 0;
    this.duplicateEvents = 0;
  }

  consume(event) {
    if (
      !event ||
      typeof event !== "object"
    ) {
      reject(
        "synaptic_event_invalid",
        "Synaptizer requires an event object",
      );
    }

    if (
      event.event_type !==
      "PROCESS_EDGE_EVIDENCE"
    ) {
      reject(
        "synaptic_event_type_invalid",
        "Synaptizer accepts PROCESS_EDGE_EVIDENCE only",
      );
    }

    nonEmpty(
      event.contract_version,
      "synaptic_contract_version_invalid",
    );

    nonEmpty(
      event.edge_execution_id,
      "synaptic_edge_execution_id_invalid",
    );

    if (
      typeof event.state_root !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(
        event.state_root,
      )
    ) {
      reject(
        "synaptic_evidence_root_invalid",
        "Process Edge evidence must carry a canonical SHA-256 state root",
      );
    }

    if (
      !event.edge_relationship ||
      typeof event.edge_relationship !==
        "object"
    ) {
      reject(
        "synaptic_relationship_invalid",
        "edge_relationship is required",
      );
    }

    if (
      !event.fitness_evidence ||
      typeof event.fitness_evidence !==
        "object"
    ) {
      reject(
        "synaptic_fitness_evidence_invalid",
        "fitness_evidence is required",
      );
    }

    this.receivedEvents += 1;

    if (
      this.seenEvents.has(
        event.edge_execution_id,
      )
    ) {
      this.duplicateEvents += 1;

      return {
        accepted: false,
        duplicate: true,
        learned: false,
      };
    }

    this.seenEvents.add(
      event.edge_execution_id,
    );

    /*
     * Architectural rule:
     * relationships are learned only from VERIFIED
     * execution evidence.
     */

    if (
      event.fitness_evidence.verified !==
      true
    ) {
      this.ignoredUnverifiedEvents += 1;

      return {
        accepted: true,
        duplicate: false,
        learned: false,
        reason:
          "UNVERIFIED_EXECUTION_EVIDENCE",
      };
    }

    const identity =
      relationshipIdentity(event);

    const relationshipId =
      synapticStateRoot(
        "synaptic-relationship-identity",
        identity,
      );

    const existing =
      this.relationships.get(
        relationshipId,
      ) ?? {
        contract:
          SYNAPTIC_RELATIONSHIP_CONTRACT_VERSION,

        relationship_id:
          relationshipId,

        ...identity,

        observations:
          0,

        verified_successes:
          0,

        verified_failures:
          0,

        recoveries:
          0,

        verification_contributions:
          0,

        reinforcement:
          0,

        evidence_state_roots:
          [],
      };

    const evidenceRoots =
      new Set(
        existing.evidence_state_roots,
      );

    evidenceRoots.add(
      event.state_root,
    );

    const updated = {
      ...existing,

      observations:
        existing.observations + 1,

      verified_successes:
        existing.verified_successes +
        (
          event.success === true
            ? 1
            : 0
        ),

      verified_failures:
        existing.verified_failures +
        (
          event.failure === true
            ? 1
            : 0
        ),

      recoveries:
        existing.recoveries +
        (
          event.recovery === true
            ? 1
            : 0
        ),

      verification_contributions:
        existing.verification_contributions +
        (
          event.verification_contribution ===
          true
            ? 1
            : 0
        ),

      reinforcement:
        existing.reinforcement +
        reinforcement(event),

      evidence_state_roots:
        [...evidenceRoots].sort(),
    };

    const committed = Object.freeze({
      ...updated,

      state_root:
        synapticStateRoot(
          "synaptic-relationship-state",
          updated,
        ),
    });

    this.relationships.set(
      relationshipId,
      committed,
    );

    this.learnedEvents += 1;

    return {
      accepted:
        true,

      duplicate:
        false,

      learned:
        true,

      relationship:
        structuredClone(committed),
    };
  }

  hydrate(snapshot) {
    if (
      !snapshot ||
      typeof snapshot !== "object"
    ) {
      reject(
        "synaptizer_snapshot_invalid",
        "Synaptizer hydrate requires a snapshot object",
      );
    }

    if (
      snapshot.contract !==
      SYNAPTIZER_SNAPSHOT_CONTRACT_VERSION
    ) {
      reject(
        "synaptizer_snapshot_contract_invalid",
        "Synaptizer snapshot contract is invalid",
      );
    }

    if (
      !Array.isArray(
        snapshot.relationships,
      )
    ) {
      reject(
        "synaptizer_snapshot_relationships_invalid",
        "Synaptizer snapshot relationships are required",
      );
    }

    if (
      typeof snapshot.state_root !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(
        snapshot.state_root,
      )
    ) {
      reject(
        "synaptizer_snapshot_root_invalid",
        "Synaptizer snapshot state root is invalid",
      );
    }

    const cloned =
      structuredClone(
        snapshot,
      );

    const suppliedRoot =
      cloned.state_root;

    delete cloned.state_root;

    const expectedRoot =
      synapticStateRoot(
        "synaptizer-state",
        cloned,
      );

    if (
      expectedRoot !==
      suppliedRoot
    ) {
      reject(
        "synaptizer_snapshot_integrity_mismatch",
        "Synaptizer snapshot commitment does not match its contents",
      );
    }

    const counterFields = [
      "received_events",
      "learned_events",
      "ignored_unverified_events",
      "duplicate_events",
    ];

    for (
      const field of counterFields
    ) {
      const value =
        snapshot[field];

      if (
        !Number.isSafeInteger(value) ||
        value < 0
      ) {
        reject(
          "synaptizer_snapshot_counter_invalid",
          `Invalid Synaptizer counter: ${field}`,
        );
      }
    }

    const restoredRelationships =
      new Map();

    for (
      const relationship of
      snapshot.relationships
    ) {
      if (
        !relationship ||
        typeof relationship !== "object"
      ) {
        reject(
          "synaptizer_relationship_snapshot_invalid",
          "Synaptic relationship snapshot is invalid",
        );
      }

      if (
        relationship.contract !==
        SYNAPTIC_RELATIONSHIP_CONTRACT_VERSION
      ) {
        reject(
          "synaptizer_relationship_contract_invalid",
          "Synaptic relationship contract is invalid",
        );
      }

      const identity = {
        source_component:
          nonEmpty(
            relationship.source_component,
            "synaptic_source_component_invalid",
          ),

        target_component:
          nonEmpty(
            relationship.target_component,
            "synaptic_target_component_invalid",
          ),

        source_role:
          nonEmpty(
            relationship.source_role,
            "synaptic_source_role_invalid",
          ),

        target_role:
          nonEmpty(
            relationship.target_role,
            "synaptic_target_role_invalid",
          ),

        context_ref:
          relationship.context_ref ??
          null,
      };

      const expectedRelationshipId =
        synapticStateRoot(
          "synaptic-relationship-identity",
          identity,
        );

      if (
        relationship.relationship_id !==
        expectedRelationshipId
      ) {
        reject(
          "synaptizer_relationship_identity_mismatch",
          "Synaptic relationship identity commitment is invalid",
        );
      }

      if (
        typeof relationship.state_root !==
          "string"
      ) {
        reject(
          "synaptizer_relationship_root_missing",
          "Synaptic relationship state root is missing",
        );
      }

      const relationshipMaterial =
        structuredClone(
          relationship,
        );

      const suppliedRelationshipRoot =
        relationshipMaterial.state_root;

      delete relationshipMaterial.state_root;

      const expectedRelationshipRoot =
        synapticStateRoot(
          "synaptic-relationship-state",
          relationshipMaterial,
        );

      if (
        suppliedRelationshipRoot !==
        expectedRelationshipRoot
      ) {
        reject(
          "synaptizer_relationship_integrity_mismatch",
          "Synaptic relationship commitment is invalid",
        );
      }

      if (
        restoredRelationships.has(
          relationship.relationship_id,
        )
      ) {
        reject(
          "synaptizer_relationship_duplicate",
          "Duplicate relationship identity in snapshot",
        );
      }

      restoredRelationships.set(
        relationship.relationship_id,
        Object.freeze(
          structuredClone(
            relationship,
          ),
        ),
      );
    }

    const seenEventIds =
      snapshot.seen_event_ids ??
      [];

    if (
      !Array.isArray(
        seenEventIds,
      ) ||
      seenEventIds.some(
        (eventId) =>
          typeof eventId !== "string" ||
          eventId.length === 0,
      )
    ) {
      reject(
        "synaptizer_seen_events_invalid",
        "Synaptizer seen_event_ids must be an array of identifiers",
      );
    }

    if (
      new Set(
        seenEventIds,
      ).size !==
      seenEventIds.length
    ) {
      reject(
        "synaptizer_seen_events_duplicate",
        "Synaptizer seen_event_ids contains duplicates",
      );
    }

    this.relationships =
      restoredRelationships;

    this.seenEvents =
      new Set(
        seenEventIds,
      );

    this.receivedEvents =
      snapshot.received_events;

    this.learnedEvents =
      snapshot.learned_events;

    this.ignoredUnverifiedEvents =
      snapshot.ignored_unverified_events;

    this.duplicateEvents =
      snapshot.duplicate_events;

    return this.snapshot();
  }
  relationship(relationshipId) {
    const relationship =
      this.relationships.get(
        relationshipId,
      );

    return relationship
      ? structuredClone(
          relationship,
        )
      : null;
  }

  describeRelationships() {
    return [...this.relationships.values()]
      .map(
        (relationship) =>
          structuredClone(
            relationship,
          ),
      )
      .sort(
        (a, b) =>
          a.relationship_id.localeCompare(
            b.relationship_id,
          ),
      );
  }

  snapshot() {
    const state = {
      contract:
        SYNAPTIZER_SNAPSHOT_CONTRACT_VERSION,

      relationships:
        this.describeRelationships(),

      received_events:
        this.receivedEvents,

      learned_events:
        this.learnedEvents,

      ignored_unverified_events:
        this.ignoredUnverifiedEvents,

      duplicate_events:
        this.duplicateEvents,

      seen_event_ids:
        [...this.seenEvents].sort(),
    };

    return {
      ...structuredClone(state),

      state_root:
        synapticStateRoot(
          "synaptizer-state",
          state,
        ),
    };
  }
}

