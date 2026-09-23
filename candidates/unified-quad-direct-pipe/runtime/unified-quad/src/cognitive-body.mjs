import { createHash } from "node:crypto";

export const COGNITON_CONTRACT_VERSION =
  "kindred.cogniton.v1";

export const COGNITIVE_GRAPH_CONTRACT_VERSION =
  "kindred.cognitive-graph.v1";

export const COGNITIVE_PORT_CONTRACT_VERSION =
  "kindred.cognitive-port.v1";

export const COGNITIVE_PORT_FABRIC_CONTRACT_VERSION =
  "kindred.cognitive-port-fabric.v1";

export const DCML_ACTIVATION_PLAN_CONTRACT_VERSION =
  "kindred.dcml-activation-plan.v1";

export const PROCESS_PORT_ATTACHMENT_CONTRACT_VERSION =
  "kindred.process-port-attachment.v1";

export const COGNITIVE_PORT_TYPES = Object.freeze({
  INTENT: "INTENT",
  COGNITON: "COGNITON",
  PROCESS: "PROCESS",
  VERIFICATION: "VERIFICATION",
});

export class CognitiveBodyError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CognitiveBodyError";
    this.code = code;
    this.details = details;
  }
}

function reject(code, message, details = undefined) {
  throw new CognitiveBodyError(code, message, details);
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();

  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

export function cognitiveStateRoot(label, value) {
  if (typeof label !== "string" || label.length === 0) {
    reject(
      "invalid_state_root_label",
      "state-root label must be a non-empty string",
    );
  }

  return createHash("sha256")
    .update(label)
    .update("\0")
    .update(canonicalize(value))
    .digest("hex");
}

function freezeClone(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeClone(item)));
  }

  const result = {};

  for (const key of Object.keys(value).sort()) {
    result[key] = freezeClone(value[key]);
  }

  return Object.freeze(result);
}

export function createCogniton(input) {
  if (!input || typeof input !== "object") {
    reject("invalid_cogniton", "Cogniton input must be an object");
  }

  if (typeof input.kind !== "string" || input.kind.length === 0) {
    reject("invalid_cogniton_kind", "Cogniton kind is required");
  }

  const version =
    Number.isInteger(input.version) && input.version > 0
      ? input.version
      : 1;

  const relations = Array.isArray(input.relations)
    ? [...new Set(input.relations.map(String))].sort()
    : [];

  const material = {
    contract: COGNITON_CONTRACT_VERSION,
    version,
    kind: input.kind,
    value: input.value ?? null,
    relations,
    provenance: input.provenance ?? null,
  };

  const address =
    typeof input.cogniton_id === "string" &&
    input.cogniton_id.length > 0
      ? input.cogniton_id
      : cognitiveStateRoot("cogniton-address", material);

  return freezeClone({
    ...material,
    cogniton_id: address,
    state_root: cognitiveStateRoot(
      "cogniton-state",
      {
        ...material,
        cogniton_id: address,
      },
    ),
  });
}

export class CognitiveGraph {
  constructor() {
    this._cognitons = new Map();
    this._active = new Set();
  }

  add(cogniton) {
    if (
      !cogniton ||
      cogniton.contract !== COGNITON_CONTRACT_VERSION ||
      typeof cogniton.cogniton_id !== "string"
    ) {
      reject(
        "invalid_cogniton_contract",
        "CognitiveGraph accepts canonical Cognitons only",
      );
    }

    this._cognitons.set(cogniton.cogniton_id, cogniton);
    return cogniton;
  }

  get(cognitonId) {
    return this._cognitons.get(cognitonId) ?? null;
  }

  activate(cognitonId) {
    if (!this._cognitons.has(cognitonId)) {
      reject(
        "unknown_cogniton",
        `Cannot activate unknown Cogniton: ${cognitonId}`,
      );
    }

    this._active.add(cognitonId);

    return this.snapshot();
  }

  deactivate(cognitonId) {
    this._active.delete(cognitonId);
    return this.snapshot();
  }

  snapshot() {
    const cognitons = [...this._cognitons.values()]
      .sort((a, b) =>
        a.cogniton_id.localeCompare(b.cogniton_id),
      );

    const active_cogniton_ids = [...this._active].sort();

    const state = {
      contract: COGNITIVE_GRAPH_CONTRACT_VERSION,
      cognitons,
      active_cogniton_ids,
    };

    return freezeClone({
      ...state,
      state_root: cognitiveStateRoot(
        "cognitive-graph",
        state,
      ),
    });
  }
}

function validatePortDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    reject(
      "invalid_port",
      "Cognitive Port descriptor must be an object",
    );
  }

  if (
    typeof descriptor.port_id !== "string" ||
    descriptor.port_id.length === 0
  ) {
    reject(
      "invalid_port_id",
      "Cognitive Port requires port_id",
    );
  }

  if (
    !Object.values(COGNITIVE_PORT_TYPES).includes(
      descriptor.port_type,
    )
  ) {
    reject(
      "invalid_port_type",
      `Unsupported Cognitive Port type: ${descriptor.port_type}`,
    );
  }

  if (
    typeof descriptor.role !== "string" ||
    descriptor.role.length === 0
  ) {
    reject(
      "invalid_port_role",
      "Cognitive Port requires computational role",
    );
  }

  if (
    descriptor.intent_classes !== undefined &&
    !Array.isArray(descriptor.intent_classes)
  ) {
    reject(
      "invalid_intent_classes",
      "intent_classes must be an array when provided",
    );
  }

  if (
    descriptor.evidence_targets !== undefined &&
    !Array.isArray(descriptor.evidence_targets)
  ) {
    reject(
      "invalid_evidence_targets",
      "evidence_targets must be an array when provided",
    );
  }
}

export class CognitivePortFabric {
  constructor() {
    this._ports = new Map();
  }

  registerPort(descriptor, handler) {
    validatePortDescriptor(descriptor);

    if (this._ports.has(descriptor.port_id)) {
      reject(
        "duplicate_port",
        `Port already registered: ${descriptor.port_id}`,
      );
    }

    if (typeof handler !== "function") {
      reject(
        "invalid_port_handler",
        "Cognitive Port handler must be callable",
      );
    }

    const normalized = freezeClone({
      contract: COGNITIVE_PORT_CONTRACT_VERSION,
      port_id: descriptor.port_id,
      port_type: descriptor.port_type,
      role: descriptor.role,
      priority:
        Number.isFinite(descriptor.priority)
          ? descriptor.priority
          : 0,
      intent_classes: Array.isArray(
        descriptor.intent_classes,
      )
        ? [...new Set(descriptor.intent_classes.map(String))].sort()
        : [],

      evidence_targets: Array.isArray(
        descriptor.evidence_targets,
      )
        ? [...new Set(descriptor.evidence_targets.map(String))].sort()
        : [],

      verification_required:
        descriptor.verification_required === true,
    });

    this._ports.set(descriptor.port_id, {
      descriptor: normalized,
      handler,
    });

    return normalized;
  }

  describePorts() {
    return [...this._ports.values()]
      .map((entry) => entry.descriptor)
      .sort((a, b) =>
        a.port_id.localeCompare(b.port_id),
      );
  }

  async activate(portId, envelope) {
    const port = this._ports.get(portId);

    if (!port) {
      reject(
        "unknown_port",
        `Unknown Cognitive Port: ${portId}`,
      );
    }

    return port.handler(envelope);
  }

  snapshot() {
    const ports = this.describePorts();

    const state = {
      contract: COGNITIVE_PORT_FABRIC_CONTRACT_VERSION,
      ports,
    };

    return freezeClone({
      ...state,
      state_root: cognitiveStateRoot(
        "cognitive-port-fabric",
        state,
      ),
    });
  }
}

function matchesIntent(port, intentClass) {
  return (
    port.intent_classes.length === 0 ||
    port.intent_classes.includes("*") ||
    port.intent_classes.includes(intentClass)
  );
}

function synapticEvidenceScore(
  port,
  synapticSnapshot,
  contextRef,
) {
  if (!synapticSnapshot) {
    return 0;
  }

  if (
    !Array.isArray(
      synapticSnapshot.relationships,
    )
  ) {
    reject(
      "invalid_synaptic_snapshot",
      "Synaptic snapshot must contain relationships",
    );
  }

  if (
    !Array.isArray(port.evidence_targets) ||
    port.evidence_targets.length === 0
  ) {
    return 0;
  }

  const targets =
    new Set(
      port.evidence_targets,
    );

  return synapticSnapshot.relationships
    .filter(
      (relationship) =>
        targets.has(
          relationship.target_component,
        ) &&
        (
          contextRef === undefined ||
          contextRef === null ||
          relationship.context_ref === null ||
          relationship.context_ref === contextRef
        ),
    )
    .reduce(
      (sum, relationship) =>
        sum +
        (
          Number.isFinite(
            relationship.reinforcement,
          )
            ? relationship.reinforcement
            : 0
        ),
      0,
    );
}

function rankPorts(
  ports,
  type,
  intentClass,
  synapticSnapshot = null,
  contextRef = null,
) {
  return ports
    .filter(
      (port) =>
        port.port_type === type &&
        matchesIntent(
          port,
          intentClass,
        ),
    )
    .map(
      (port) => ({
        port,
        synaptic_score:
          synapticEvidenceScore(
            port,
            synapticSnapshot,
            contextRef,
          ),
      }),
    )
    .sort(
      (a, b) => {
        if (
          a.port.priority !==
          b.port.priority
        ) {
          return (
            b.port.priority -
            a.port.priority
          );
        }

        if (
          a.synaptic_score !==
          b.synaptic_score
        ) {
          return (
            b.synaptic_score -
            a.synaptic_score
          );
        }

        return a.port.port_id.localeCompare(
          b.port.port_id,
        );
      },
    );
}

function selectOne(
  ports,
  type,
  intentClass,
  synapticSnapshot = null,
  contextRef = null,
) {
  return (
    rankPorts(
      ports,
      type,
      intentClass,
      synapticSnapshot,
      contextRef,
    )[0]?.port ??
    null
  );
}

export class DCMLCompiler {
  compile(input) {
    if (!input || typeof input !== "object") {
      reject(
        "invalid_dcml_input",
        "DCML compilation input must be an object",
      );
    }

    if (
      typeof input.intent_class !== "string" ||
      input.intent_class.length === 0
    ) {
      reject(
        "missing_intent_class",
        "DCML requires intent_class",
      );
    }

    if (
      !input.graph ||
      typeof input.graph.state_root !== "string"
    ) {
      reject(
        "missing_cognitive_graph",
        "DCML requires a Cognitive Graph snapshot",
      );
    }

    if (
      !input.fabric ||
      typeof input.fabric.state_root !== "string" ||
      !Array.isArray(input.fabric.ports)
    ) {
      reject(
        "missing_port_fabric",
        "DCML requires a Cognitive Port Fabric snapshot",
      );
    }

    if (
      input.synaptic_snapshot !== undefined &&
      input.synaptic_snapshot !== null
    ) {
      if (
        typeof input.synaptic_snapshot !== "object" ||
        !Array.isArray(
          input.synaptic_snapshot.relationships,
        ) ||
        typeof input.synaptic_snapshot.state_root !== "string"
      ) {
        reject(
          "invalid_synaptic_snapshot",
          "DCML synaptic_snapshot must be a canonical Synaptizer snapshot",
        );
      }
    }

    const intentPort = selectOne(
      input.fabric.ports,
      COGNITIVE_PORT_TYPES.INTENT,
      input.intent_class,
      input.synaptic_snapshot ?? null,
      input.context_ref ?? null,
    );

    const cognitonPort = selectOne(
      input.fabric.ports,
      COGNITIVE_PORT_TYPES.COGNITON,
      input.intent_class,
      input.synaptic_snapshot ?? null,
      input.context_ref ?? null,
    );

    const processRanking = rankPorts(
      input.fabric.ports,
      COGNITIVE_PORT_TYPES.PROCESS,
      input.intent_class,
      input.synaptic_snapshot ?? null,
      input.context_ref ?? null,
    );

    const processPort =
      processRanking[0]?.port ??
      null;

    const verificationPort = selectOne(
      input.fabric.ports,
      COGNITIVE_PORT_TYPES.VERIFICATION,
      input.intent_class,
      input.synaptic_snapshot ?? null,
      input.context_ref ?? null,
    );

    if (!intentPort) {
      reject(
        "intent_port_unavailable",
        `No Intent Port available for ${input.intent_class}`,
      );
    }

    if (!processPort) {
      reject(
        "process_port_unavailable",
        `No Process Port available for ${input.intent_class}`,
      );
    }

    const verificationRequired =
      input.verification_required !== false ||
      processPort.verification_required === true;

    if (verificationRequired && !verificationPort) {
      reject(
        "verification_port_unavailable",
        "Verification is required but no Verification Port is active",
      );
    }

    const active = [
      intentPort,
      cognitonPort,
      processPort,
      verificationPort,
    ]
      .filter(Boolean)
      .map((port) => port.port_id);

    const plan = {
      contract: DCML_ACTIVATION_PLAN_CONTRACT_VERSION,
      intent_class: input.intent_class,
      graph_state_root: input.graph.state_root,
      fabric_state_root: input.fabric.state_root,

      selection_evidence_root:
        input.synaptic_snapshot?.state_root ??
        null,

      process_selection_trace:
        processRanking.map(
          ({ port, synaptic_score }) => ({
            port_id:
              port.port_id,

            priority:
              port.priority,

            synaptic_score,

            evidence_targets:
              port.evidence_targets,
          }),
        ),

      active_port_ids: active,
      process_port_id: processPort.port_id,
      verification_port_id:
        verificationPort?.port_id ?? null,
      verification_required: verificationRequired,
      authority_scope: input.authority_scope ?? null,
    };

    return freezeClone({
      ...plan,
      state_root: cognitiveStateRoot(
        "dcml-activation-plan",
        plan,
      ),
    });
  }
}

export function createProcessPortAttachment(boundary) {
  if (!boundary || typeof boundary !== "object") {
    reject(
      "invalid_process_boundary",
      "Process Port attachment requires a boundary object",
    );
  }

  const requiredMethods = [
    "request",
    "mapPort",
    "discoverProcessSkills",
    "discoverProsynthesizedCapability",
    "requestCandidate",
    "executeCapability",
    "requestRecomposition",
  ];

  const missingMethods = requiredMethods.filter(
    (method) => typeof boundary[method] !== "function",
  );

  if (missingMethods.length > 0) {
    reject(
      "incompatible_process_boundary",
      "Process boundary is missing required methods",
      { missing_methods: missingMethods },
    );
  }

  const dispatchers = Object.freeze({
    DISCOVER_PROCESS_SKILLS: (payload) =>
      boundary.discoverProcessSkills(payload),

    DISCOVER_PROSYNTHESIZED_CAPABILITY: (payload) =>
      boundary.discoverProsynthesizedCapability(payload),

    REQUEST_PROSYNTHESINE_CANDIDATE: (payload) =>
      boundary.requestCandidate(payload),

    EXECUTE_CAPABILITY: (payload) =>
      boundary.executeCapability(payload),

    REQUEST_POST_SYNTHESIS_RECOMPOSITION: (payload) =>
      boundary.requestRecomposition(payload),
  });

  const requestTypes = Object.freeze(
    Object.keys(dispatchers).sort(),
  );

  function prepare(requestType, payload = {}) {
    if (
      typeof requestType !== "string" ||
      !Object.hasOwn(dispatchers, requestType)
    ) {
      reject(
        "unsupported_process_request_type",
        `Unsupported Process Intelligence request type: ${String(requestType)}`,
      );
    }

    const receipt = boundary.request(
      requestType,
      payload,
    );

    if (
      !receipt ||
      typeof receipt !== "object" ||
      receipt.request_type !== requestType
    ) {
      reject(
        "invalid_process_boundary_receipt",
        "Process Intelligence boundary returned an invalid request receipt",
      );
    }

    if (
      receipt.external_effects_authorized !== false ||
      receipt.authority_escalation_authorized !== false
    ) {
      reject(
        "unsafe_process_boundary_receipt",
        "Process Intelligence request unexpectedly authorized consequence",
      );
    }

    return receipt;
  }

  return Object.freeze({
    contract: PROCESS_PORT_ATTACHMENT_CONTRACT_VERSION,

    required_methods: Object.freeze([...requiredMethods]),

    request_types: requestTypes,

    request(requestType, payload = {}) {
      return prepare(requestType, payload);
    },

    async dispatch(
      requestType,
      payload = {},
      receiptPayload = payload,
    ) {
      const request = prepare(
        requestType,
        receiptPayload,
      );

      const result = await dispatchers[
        requestType
      ](payload);

      return freezeClone({
        request,
        result,
      });
    },
  });
}
export async function executeActivationPlan({
  plan,
  fabric,
  payload,
}) {
  if (
    !plan ||
    plan.contract !==
      DCML_ACTIVATION_PLAN_CONTRACT_VERSION
  ) {
    reject(
      "invalid_activation_plan",
      "Canonical DCML activation plan required",
    );
  }

  if (!(fabric instanceof CognitivePortFabric)) {
    reject(
      "invalid_fabric_runtime",
      "CognitivePortFabric runtime instance required",
    );
  }

  let state = payload;

  for (const portId of plan.active_port_ids) {
    state = await fabric.activate(portId, {
      plan,
      state,
    });
  }

  return state;
}



