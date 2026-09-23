export const AGENT_IDENTITY_CONTRACT_VERSION = "kindred.agent.identity.v1";
export const CAPABILITY_CONTRACT_VERSION = "kindred.agent.capability.v1";
export const AUTHORITY_GRANT_CONTRACT_VERSION =
  "kindred.agent.authority-grant.v1";
export const MESSAGE_ENVELOPE_CONTRACT_VERSION =
  "kindred.agent.message-envelope.v1";
export const PROTOCOL_RECEIPT_CONTRACT_VERSION =
  "kindred.agent.protocol-receipt.v1";
export const REVOCATION_NOTICE_CONTRACT_VERSION =
  "kindred.agent.revocation-notice.v1";
export const REVOCATION_RECEIPT_CONTRACT_VERSION =
  "kindred.agent.revocation-receipt.v1";

export const RUNTIME_COMPONENTS = Object.freeze([
  "brainstem",
  "kindred_cloud",
  "emit_core",
  "retrobank",
]);
export const AGENT_CLASSES = Object.freeze([
  "living_companion",
  "founder_intelligence",
  "worker",
  "service",
]);
export const AUTHORITY_LEVELS = Object.freeze([
  "none",
  "user_delegated",
  "governance_delegated",
  "founder_delegated",
]);
export const MESSAGE_TYPES = Object.freeze([
  "discovery",
  "request",
  "response",
  "proposal",
  "negotiation",
  "agreement",
  "task",
  "delegation",
  "proof_request",
  "proof_result",
  "execution_request",
  "execution_receipt",
  "settlement_request",
  "dispute",
  "cancellation",
  "compensation",
  "health",
  "status",
  "revocation",
]);
export const DATA_CLASSIFICATIONS = Object.freeze([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

export const IDENTITY_FIELDS = Object.freeze([
  "contract_version",
  "agent_id",
  "tenant_id",
  "agent_class",
  "owner_id",
  "creator_id",
  "version",
  "lineage",
  "purpose",
  "capabilities",
  "prohibited_capabilities",
  "permissions",
  "authority",
  "budget_refs",
  "lifecycle_state",
  "health",
  "evidence_refs",
  "memory_scope",
  "execution_scope",
  "provider_scope",
  "economic_mandate_ref",
  "replacement_agent_id",
  "created_at",
  "revoked_at",
]);
export const CAPABILITY_FIELDS = Object.freeze([
  "contract_version",
  "capability_id",
  "version",
  "owner_component",
  "action_type",
  "allowed_agent_classes",
  "required_authority",
  "risk_ceiling",
  "data_classifications",
  "execution_mode",
  "provider_contact",
  "memory_commit",
  "settlement",
  "compensation_required",
  "input_contract_ref",
  "output_contract_ref",
]);
export const AUTHORITY_GRANT_FIELDS = Object.freeze([
  "contract_version",
  "grant_id",
  "subject_agent_id",
  "issuer_component",
  "issuer_id",
  "authentication_ref",
  "authority_level",
  "capability_ids",
  "message_types",
  "permissions",
  "budget_refs",
  "parent_grant_ref",
  "issued_at",
  "expires_at",
  "status",
  "revoked_at",
]);
export const ENVELOPE_FIELDS = Object.freeze([
  "contract_version",
  "message_id",
  "message_type",
  "sender",
  "recipient",
  "authority_ref",
  "correlation_id",
  "causation_id",
  "nonce",
  "timestamp",
  "expires_at",
  "data_classification",
  "requested_capability",
  "budget_ref",
  "evidence_refs",
  "authentication_ref",
  "delegation_ref",
  "payload",
]);
export const PROTOCOL_RECEIPT_FIELDS = Object.freeze([
  "contract_version",
  "message_id",
  "correlation_id",
  "status",
  "accepted_at",
  "replay_consumed",
]);
export const REVOCATION_NOTICE_FIELDS = Object.freeze([
  "contract_version",
  "revocation_id",
  "target_type",
  "target_id",
  "reason_class",
  "effective_at",
  "authority_component",
  "cascade_dependents",
  "evidence_refs",
  "provider_contact_requested",
  "memory_mutation_requested",
  "tool_execution_requested",
  "settlement_requested",
  "external_effects",
]);
export const REVOCATION_RECEIPT_FIELDS = Object.freeze([
  "contract_version",
  "revocation_id",
  "message_id",
  "correlation_id",
  "target_type",
  "target_id",
  "reason_class",
  "status",
  "effective_at",
  "identity_state_changed",
  "grants_revoked",
  "replay_consumed",
  "history_preserved",
  "provider_contacted",
  "memory_mutated",
  "tool_executed",
  "settlement_executed",
  "external_effects",
  "evidence_refs",
  "recorded_at",
]);

const componentSet = new Set(RUNTIME_COMPONENTS);
const agentClassSet = new Set(AGENT_CLASSES);
const authoritySet = new Set(AUTHORITY_LEVELS);
const authorityOrder = new Map(
  AUTHORITY_LEVELS.map((authority, index) => [authority, index]),
);
const messageTypeSet = new Set(MESSAGE_TYPES);
const classificationSet = new Set(DATA_CLASSIFICATIONS);
const lifecycleSet = new Set([
  "registered",
  "active",
  "suspended",
  "revoked",
  "retired",
  "replaced",
]);
const healthSet = new Set(["healthy", "degraded", "unavailable", "unknown"]);
const actionTypeSet = new Set([
  "communication",
  "reasoning",
  "memory_proposal",
  "tool",
  "settlement",
]);
const riskSet = new Set(["low", "medium", "high", "critical"]);
const executionModeSet = new Set([
  "proposal_only",
  "governed_local_reversible",
  "governed_external",
]);
const grantStatusSet = new Set(["active", "suspended", "revoked"]);
const forbiddenPayloadKeys = new Set([
  "access_token",
  "authorization_code",
  "client_secret",
  "cookie",
  "password",
  "pkce_verifier",
  "private_key",
  "refresh_token",
  "seed_phrase",
]);
const agentIdPattern = /^kindred-agent-[A-Za-z0-9_-]{8,96}$/;
const tenantIdPattern = /^kindred-tenant-[A-Za-z0-9_-]{8,96}$/;
const grantIdPattern = /^kindred-grant-[A-Za-z0-9_-]{8,96}$/;
const capabilityIdPattern = /^kindred\.capability\.[a-z0-9_.-]{3,96}\.v[0-9]+$/;
const messageIdPattern = /^kindred-message-[A-Za-z0-9_-]{8,96}$/;
const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const noncePattern = /^[A-Za-z0-9_-]{16,128}$/;
const revocationIdPattern = /^kindred-revocation-[A-Za-z0-9_-]{8,96}$/;
const authenticationReferencePattern =
  /^kindred-authref-[A-Za-z0-9_-]{8,96}$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const revocationReasonSet = new Set([
  "owner_request",
  "governance_policy",
  "security_response",
  "replacement",
  "retirement",
]);
const capabilityMessageTypes = new Set(
  MESSAGE_TYPES.filter(
    (messageType) =>
      !["discovery", "health", "status", "revocation"].includes(messageType),
  ),
);
const directAgentExecutionTypes = new Set([
  "execution_request",
  "execution_receipt",
  "settlement_request",
]);
const MAX_ENVELOPE_TTL_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_PAYLOAD_DEPTH = 8;

export class AgentProtocolError extends Error {
  constructor(reasonClass, retryable = false) {
    super("Agent protocol request rejected.");
    this.name = "AgentProtocolError";
    this.code = "agent_protocol_rejected";
    this.reasonClass = reasonClass;
    this.retryable = retryable;
  }
}

function reject(reasonClass, retryable = false) {
  throw new AgentProtocolError(reasonClass, retryable);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, fields, reasonClass) {
  if (!isRecord(value)) reject(reasonClass);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    reject(reasonClass);
  }
  return value;
}

function boundedString(value, minimum, maximum) {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function timestamp(value, reasonClass) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    reject(reasonClass);
  }
  return Date.parse(value);
}

function uniqueStrings(value, maximum = 64, minimum = 0) {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    new Set(value).size === value.length &&
    value.every((item) => boundedString(item, 3, 128))
  );
}

function validateNullableReference(value, pattern = null) {
  return (
    value === null ||
    (boundedString(value, 3, 128) && (pattern === null || pattern.test(value)))
  );
}

function validatePayload(value, depth = 0) {
  if (depth > MAX_PAYLOAD_DEPTH) reject("payload_depth_exceeded");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("payload_invalid");
    return;
  }
  if (typeof value === "string") {
    if (!boundedString(value, 0, 4096)) reject("payload_invalid");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) reject("payload_capacity_exceeded");
    for (const item of value) validatePayload(item, depth + 1);
    return;
  }
  if (!isRecord(value) || Object.keys(value).length > 128) {
    reject("payload_invalid");
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      !boundedString(key, 1, 128) ||
      forbiddenPayloadKeys.has(key.toLowerCase())
    ) {
      reject("sensitive_payload_forbidden");
    }
    validatePayload(item, depth + 1);
  }
}

function validatePrincipal(value) {
  exactKeys(value, ["principal_type", "id"], "principal_invalid");
  if (!new Set(["agent", "runtime_component"]).has(value.principal_type)) {
    reject("principal_invalid");
  }
  if (value.principal_type === "agent" && !agentIdPattern.test(value.id)) {
    reject("principal_invalid");
  }
  if (
    value.principal_type === "runtime_component" &&
    !componentSet.has(value.id)
  ) {
    reject("runtime_component_unknown");
  }
  return structuredClone(value);
}

export function validateAgentIdentity(value) {
  const identity = exactKeys(value, IDENTITY_FIELDS, "identity_fields_invalid");
  if (
    identity.contract_version !== AGENT_IDENTITY_CONTRACT_VERSION ||
    !agentIdPattern.test(identity.agent_id) ||
    !tenantIdPattern.test(identity.tenant_id) ||
    !agentClassSet.has(identity.agent_class) ||
    !boundedString(identity.owner_id, 8, 128) ||
    !boundedString(identity.creator_id, 8, 128) ||
    !versionPattern.test(identity.version) ||
    !boundedString(identity.purpose, 1, 512) ||
    !uniqueStrings(identity.capabilities) ||
    !uniqueStrings(identity.prohibited_capabilities) ||
    !uniqueStrings(identity.permissions) ||
    !uniqueStrings(identity.budget_refs) ||
    !lifecycleSet.has(identity.lifecycle_state) ||
    !healthSet.has(identity.health) ||
    !uniqueStrings(identity.evidence_refs)
  ) {
    reject("identity_invalid");
  }
  if (
    identity.capabilities.some((capability) =>
      identity.prohibited_capabilities.includes(capability),
    )
  ) {
    reject("identity_capability_conflict");
  }
  exactKeys(
    identity.lineage,
    ["parent_agent_id", "replaces_agent_id"],
    "identity_lineage_invalid",
  );
  if (
    !validateNullableReference(identity.lineage.parent_agent_id, agentIdPattern) ||
    !validateNullableReference(identity.lineage.replaces_agent_id, agentIdPattern) ||
    identity.lineage.parent_agent_id === identity.agent_id ||
    identity.lineage.replaces_agent_id === identity.agent_id
  ) {
    reject("identity_lineage_invalid");
  }
  exactKeys(
    identity.authority,
    ["issuer_component", "grant_refs", "ceiling"],
    "identity_authority_invalid",
  );
  if (
    identity.authority.issuer_component !== "brainstem" ||
    !uniqueStrings(identity.authority.grant_refs) ||
    !authoritySet.has(identity.authority.ceiling)
  ) {
    reject("identity_authority_invalid");
  }
  exactKeys(
    identity.memory_scope,
    ["namespace_refs", "write_mode"],
    "identity_memory_scope_invalid",
  );
  if (
    !uniqueStrings(identity.memory_scope.namespace_refs) ||
    identity.memory_scope.write_mode !== "proposal_only"
  ) {
    reject("identity_memory_scope_invalid");
  }
  exactKeys(
    identity.execution_scope,
    ["mode", "allowed_capabilities"],
    "identity_execution_scope_invalid",
  );
  if (
    identity.execution_scope.mode !== "proposal_only" ||
    !uniqueStrings(identity.execution_scope.allowed_capabilities) ||
    identity.execution_scope.allowed_capabilities.some(
      (capability) => !identity.capabilities.includes(capability),
    )
  ) {
    reject("identity_execution_scope_invalid");
  }
  exactKeys(
    identity.provider_scope,
    ["mode", "provider_refs"],
    "identity_provider_scope_invalid",
  );
  if (
    identity.provider_scope.mode !== "mediated_only" ||
    !uniqueStrings(identity.provider_scope.provider_refs)
  ) {
    reject("identity_provider_scope_invalid");
  }
  if (
    !validateNullableReference(identity.economic_mandate_ref) ||
    !validateNullableReference(identity.replacement_agent_id, agentIdPattern)
  ) {
    reject("identity_reference_invalid");
  }
  timestamp(identity.created_at, "identity_timestamp_invalid");
  if (identity.revoked_at !== null) {
    timestamp(identity.revoked_at, "identity_timestamp_invalid");
  }
  if (
    identity.lifecycle_state === "revoked" !== (identity.revoked_at !== null) ||
    identity.lifecycle_state === "replaced" !==
      (identity.replacement_agent_id !== null)
  ) {
    reject("identity_lifecycle_invalid");
  }
  if (
    identity.agent_class === "living_companion" &&
    (identity.authority.ceiling === "founder_delegated" ||
      identity.permissions.includes("founder_authority") ||
      !identity.owner_id.startsWith("kindred-account-") ||
      !identity.agent_id.startsWith("kindred-agent-companion-"))
  ) {
    reject("companion_authority_boundary_violation");
  }
  return structuredClone(identity);
}

export function validateCapability(value) {
  const capability = exactKeys(
    value,
    CAPABILITY_FIELDS,
    "capability_fields_invalid",
  );
  if (
    capability.contract_version !== CAPABILITY_CONTRACT_VERSION ||
    !capabilityIdPattern.test(capability.capability_id) ||
    !versionPattern.test(capability.version) ||
    !componentSet.has(capability.owner_component) ||
    !actionTypeSet.has(capability.action_type) ||
    !Array.isArray(capability.allowed_agent_classes) ||
    capability.allowed_agent_classes.length === 0 ||
    capability.allowed_agent_classes.length > AGENT_CLASSES.length ||
    new Set(capability.allowed_agent_classes).size !==
      capability.allowed_agent_classes.length ||
    capability.allowed_agent_classes.some(
      (agentClass) => !agentClassSet.has(agentClass),
    ) ||
    !authoritySet.has(capability.required_authority) ||
    !riskSet.has(capability.risk_ceiling) ||
    !Array.isArray(capability.data_classifications) ||
    capability.data_classifications.length === 0 ||
    capability.data_classifications.length > DATA_CLASSIFICATIONS.length ||
    new Set(capability.data_classifications).size !==
      capability.data_classifications.length ||
    capability.data_classifications.some(
      (classification) => !classificationSet.has(classification),
    ) ||
    !executionModeSet.has(capability.execution_mode) ||
    capability.provider_contact !== "mediated_only" ||
    capability.memory_commit !== "brainstem_only" ||
    capability.settlement !== "retrobank_mandate_only" ||
    typeof capability.compensation_required !== "boolean" ||
    !boundedString(capability.input_contract_ref, 3, 256) ||
    !boundedString(capability.output_contract_ref, 3, 256)
  ) {
    reject("capability_invalid");
  }
  return structuredClone(capability);
}

export function validateAuthorityGrant(value) {
  const grant = exactKeys(
    value,
    AUTHORITY_GRANT_FIELDS,
    "authority_grant_fields_invalid",
  );
  if (
    grant.contract_version !== AUTHORITY_GRANT_CONTRACT_VERSION ||
    !grantIdPattern.test(grant.grant_id) ||
    !agentIdPattern.test(grant.subject_agent_id) ||
    grant.issuer_component !== "brainstem" ||
    !boundedString(grant.issuer_id, 8, 128) ||
    !authenticationReferencePattern.test(grant.authentication_ref) ||
    !authoritySet.has(grant.authority_level) ||
    !uniqueStrings(grant.capability_ids) ||
    !Array.isArray(grant.message_types) ||
    grant.message_types.length === 0 ||
    grant.message_types.length > MESSAGE_TYPES.length ||
    new Set(grant.message_types).size !== grant.message_types.length ||
    grant.message_types.some((messageType) => !messageTypeSet.has(messageType)) ||
    !uniqueStrings(grant.permissions) ||
    !uniqueStrings(grant.budget_refs) ||
    !validateNullableReference(grant.parent_grant_ref, grantIdPattern) ||
    !grantStatusSet.has(grant.status)
  ) {
    reject("authority_grant_invalid");
  }
  const issuedAt = timestamp(grant.issued_at, "authority_grant_timestamp_invalid");
  const expiresAt = timestamp(
    grant.expires_at,
    "authority_grant_timestamp_invalid",
  );
  if (expiresAt <= issuedAt) reject("authority_grant_timestamp_invalid");
  if (grant.revoked_at !== null) {
    timestamp(grant.revoked_at, "authority_grant_timestamp_invalid");
  }
  if (grant.status === "revoked" !== (grant.revoked_at !== null)) {
    reject("authority_grant_status_invalid");
  }
  return structuredClone(grant);
}

export function validateEnvelope(value) {
  const envelope = exactKeys(value, ENVELOPE_FIELDS, "envelope_fields_invalid");
  if (
    envelope.contract_version !== MESSAGE_ENVELOPE_CONTRACT_VERSION ||
    !messageIdPattern.test(envelope.message_id) ||
    !messageTypeSet.has(envelope.message_type) ||
    !validateNullableReference(envelope.authority_ref, grantIdPattern) ||
    !opaqueReferencePattern.test(envelope.correlation_id) ||
    !validateNullableReference(envelope.causation_id, opaqueReferencePattern) ||
    !noncePattern.test(envelope.nonce) ||
    !classificationSet.has(envelope.data_classification) ||
    !validateNullableReference(
      envelope.requested_capability,
      capabilityIdPattern,
    ) ||
    !validateNullableReference(envelope.budget_ref) ||
    !uniqueStrings(envelope.evidence_refs) ||
    !validateNullableReference(
      envelope.authentication_ref,
      authenticationReferencePattern,
    ) ||
    !validateNullableReference(envelope.delegation_ref, grantIdPattern)
  ) {
    reject("envelope_invalid");
  }
  validatePrincipal(envelope.sender);
  validatePrincipal(envelope.recipient);
  const sentAt = timestamp(envelope.timestamp, "envelope_timestamp_invalid");
  const expiresAt = timestamp(
    envelope.expires_at,
    "envelope_timestamp_invalid",
  );
  if (expiresAt <= sentAt || expiresAt - sentAt > MAX_ENVELOPE_TTL_MS) {
    reject("envelope_expiration_invalid");
  }
  if (!isRecord(envelope.payload)) reject("payload_invalid");
  validatePayload(envelope.payload);
  let payloadBytes;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(envelope.payload), "utf8");
  } catch {
    reject("payload_invalid");
  }
  if (payloadBytes > MAX_PAYLOAD_BYTES) reject("payload_capacity_exceeded");
  return structuredClone(envelope);
}

export function validateProtocolReceipt(value) {
  const receipt = exactKeys(
    value,
    PROTOCOL_RECEIPT_FIELDS,
    "protocol_receipt_fields_invalid",
  );
  if (
    receipt.contract_version !== PROTOCOL_RECEIPT_CONTRACT_VERSION ||
    !messageIdPattern.test(receipt.message_id) ||
    !opaqueReferencePattern.test(receipt.correlation_id) ||
    receipt.status !== "accepted" ||
    receipt.replay_consumed !== true
  ) {
    reject("protocol_receipt_invalid");
  }
  timestamp(receipt.accepted_at, "protocol_receipt_timestamp_invalid");
  return structuredClone(receipt);
}

export function validateRevocationNotice(value) {
  const notice = exactKeys(
    value,
    REVOCATION_NOTICE_FIELDS,
    "revocation_notice_fields_invalid",
  );
  const targetValid =
    (notice.target_type === "agent" && agentIdPattern.test(notice.target_id)) ||
    (notice.target_type === "authority_grant" &&
      grantIdPattern.test(notice.target_id));
  if (
    notice.contract_version !== REVOCATION_NOTICE_CONTRACT_VERSION ||
    !revocationIdPattern.test(notice.revocation_id) ||
    !targetValid ||
    !revocationReasonSet.has(notice.reason_class) ||
    notice.authority_component !== "brainstem" ||
    notice.cascade_dependents !== true ||
    !uniqueStrings(notice.evidence_refs, 16, 1) ||
    notice.provider_contact_requested !== false ||
    notice.memory_mutation_requested !== false ||
    notice.tool_execution_requested !== false ||
    notice.settlement_requested !== false ||
    notice.external_effects !== false
  ) {
    reject("revocation_notice_invalid");
  }
  timestamp(notice.effective_at, "revocation_notice_timestamp_invalid");
  return structuredClone(notice);
}

export function validateRevocationReceipt(value) {
  const receipt = exactKeys(
    value,
    REVOCATION_RECEIPT_FIELDS,
    "revocation_receipt_fields_invalid",
  );
  const targetValid =
    (receipt.target_type === "agent" && agentIdPattern.test(receipt.target_id)) ||
    (receipt.target_type === "authority_grant" &&
      grantIdPattern.test(receipt.target_id));
  const effectiveAt = timestamp(
    receipt.effective_at,
    "revocation_receipt_timestamp_invalid",
  );
  const recordedAt = timestamp(
    receipt.recorded_at,
    "revocation_receipt_timestamp_invalid",
  );
  if (
    receipt.contract_version !== REVOCATION_RECEIPT_CONTRACT_VERSION ||
    !revocationIdPattern.test(receipt.revocation_id) ||
    !messageIdPattern.test(receipt.message_id) ||
    !opaqueReferencePattern.test(receipt.correlation_id) ||
    !targetValid ||
    !revocationReasonSet.has(receipt.reason_class) ||
    receipt.status !== "applied" ||
    typeof receipt.identity_state_changed !== "boolean" ||
    !Number.isSafeInteger(receipt.grants_revoked) ||
    receipt.grants_revoked < 0 ||
    receipt.grants_revoked > 4096 ||
    receipt.replay_consumed !== true ||
    receipt.history_preserved !== true ||
    receipt.provider_contacted !== false ||
    receipt.memory_mutated !== false ||
    receipt.tool_executed !== false ||
    receipt.settlement_executed !== false ||
    receipt.external_effects !== false ||
    !uniqueStrings(receipt.evidence_refs, 16, 1) ||
    effectiveAt > recordedAt ||
    (receipt.target_type === "agent") !== receipt.identity_state_changed ||
    (receipt.target_type === "authority_grant" && receipt.grants_revoked < 1)
  ) {
    reject("revocation_receipt_invalid");
  }
  return structuredClone(receipt);
}

export class ReplayGuard {
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 4096;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new TypeError("maxEntries must be a positive safe integer");
    }
    this.entries = new Map();
  }

  prune(now = this.now()) {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }

  has(senderKey, nonce, now = this.now()) {
    this.prune(now);
    return this.entries.has(senderKey + ":" + nonce);
  }

  consume(senderKey, nonce, expiresAt) {
    const now = this.now();
    this.prune(now);
    const key = senderKey + ":" + nonce;
    if (this.entries.has(key)) reject("envelope_replay");
    if (this.entries.size >= this.maxEntries) {
      reject("replay_capacity_reached", true);
    }
    this.entries.set(key, expiresAt);
  }
}

export class AgentProtocolGateway {
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.identities = new Map();
    this.capabilities = new Map();
    this.grants = new Map();
    this.revocations = new Map();
    this.componentAuthenticationRefs = new Map();
    for (const [componentId, references] of Object.entries(
      options.componentAuthenticationRefs ?? {},
    )) {
      if (
        !componentSet.has(componentId) ||
        !Array.isArray(references) ||
        references.length === 0 ||
        new Set(references).size !== references.length ||
        references.some(
          (reference) => !authenticationReferencePattern.test(reference),
        )
      ) {
        throw new TypeError("component authentication references are invalid");
      }
      this.componentAuthenticationRefs.set(componentId, new Set(references));
    }
    this.replayGuard =
      options.replayGuard ??
      new ReplayGuard({ now: this.now, maxEntries: options.maxReplayEntries });
  }

  registerIdentity(value) {
    const identity = validateAgentIdentity(value);
    const existing = this.identities.get(identity.agent_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(identity)) {
      reject("identity_conflict");
    }
    this.identities.set(identity.agent_id, identity);
    return structuredClone(identity);
  }

  registerCapability(value) {
    const capability = validateCapability(value);
    const existing = this.capabilities.get(capability.capability_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(capability)) {
      reject("capability_conflict");
    }
    this.capabilities.set(capability.capability_id, capability);
    return structuredClone(capability);
  }

  registerAuthorityGrant(value) {
    const grant = validateAuthorityGrant(value);
    const identity = this.identities.get(grant.subject_agent_id);
    if (!identity) reject("grant_subject_unknown");
    if (!identity.authority.grant_refs.includes(grant.grant_id)) {
      reject("grant_not_declared_by_identity");
    }
    if (
      authorityOrder.get(grant.authority_level) >
      authorityOrder.get(identity.authority.ceiling)
    ) {
      reject("authority_escalation_forbidden");
    }
    for (const capabilityId of grant.capability_ids) {
      if (
        !identity.capabilities.includes(capabilityId) ||
        identity.prohibited_capabilities.includes(capabilityId) ||
        !this.capabilities.has(capabilityId)
      ) {
        reject("grant_capability_out_of_scope");
      }
    }
    if (grant.parent_grant_ref !== null) {
      const parent = this.grants.get(grant.parent_grant_ref);
      if (!parent || parent.status !== "active") {
        reject("parent_grant_inactive");
      }
      if (
        authorityOrder.get(grant.authority_level) >
          authorityOrder.get(parent.authority_level) ||
        grant.capability_ids.some(
          (capabilityId) => !parent.capability_ids.includes(capabilityId),
        ) ||
        grant.message_types.some(
          (messageType) => !parent.message_types.includes(messageType),
        ) ||
        grant.budget_refs.some(
          (budgetRef) => !parent.budget_refs.includes(budgetRef),
        )
      ) {
        reject("delegation_scope_escalation");
      }
    }
    const existing = this.grants.get(grant.grant_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(grant)) {
      reject("authority_grant_conflict");
    }
    this.grants.set(grant.grant_id, grant);
    return structuredClone(grant);
  }

  requireActiveAgent(agentId) {
    const identity = this.identities.get(agentId);
    if (!identity) reject("agent_unknown");
    if (identity.lifecycle_state !== "active") {
      reject("agent_inactive");
    }
    return identity;
  }

  authorizeAgentEnvelope(envelope, now) {
    const identity = this.requireActiveAgent(envelope.sender.id);
    if (directAgentExecutionTypes.has(envelope.message_type)) {
      reject("direct_agent_execution_forbidden");
    }
    if (envelope.authentication_ref === null) {
      reject("authentication_reference_required");
    }
    if (envelope.message_type === "discovery") {
      if (
        envelope.recipient.principal_type !== "runtime_component" ||
        envelope.recipient.id !== "brainstem" ||
        envelope.authority_ref === null ||
        envelope.requested_capability !== null ||
        envelope.budget_ref !== null ||
        envelope.delegation_ref !== null ||
        envelope.data_classification !== "internal"
      ) {
        reject("discovery_route_forbidden");
      }
      const grant = this.grants.get(envelope.authority_ref);
      if (!grant || grant.subject_agent_id !== identity.agent_id) {
        reject("authority_grant_unknown");
      }
      if (envelope.authentication_ref !== grant.authentication_ref) {
        reject("authentication_reference_mismatch");
      }
      if (
        grant.status !== "active" ||
        Date.parse(grant.issued_at) > now ||
        Date.parse(grant.expires_at) <= now ||
        !grant.message_types.includes("discovery") ||
        !grant.permissions.includes("capability.discover") ||
        grant.capability_ids.length !== 0 ||
        grant.budget_refs.length !== 0 ||
        grant.parent_grant_ref !== null
      ) {
        reject("discovery_grant_out_of_scope");
      }
      return;
    }
    if (
      capabilityMessageTypes.has(envelope.message_type) &&
      envelope.requested_capability === null
    ) {
      reject("requested_capability_required");
    }
    if (envelope.requested_capability !== null) {
      const capability = this.capabilities.get(envelope.requested_capability);
      if (!capability) reject("capability_unknown");
      if (
        !identity.capabilities.includes(capability.capability_id) ||
        identity.prohibited_capabilities.includes(capability.capability_id) ||
        !identity.execution_scope.allowed_capabilities.includes(
          capability.capability_id,
        ) ||
        !capability.allowed_agent_classes.includes(identity.agent_class) ||
        !capability.data_classifications.includes(
          envelope.data_classification,
        )
      ) {
        reject("capability_out_of_scope");
      }
      if (envelope.authority_ref === null) {
        reject("authority_reference_required");
      }
      const grant = this.grants.get(envelope.authority_ref);
      if (!grant || grant.subject_agent_id !== identity.agent_id) {
        reject("authority_grant_unknown");
      }
      if (envelope.authentication_ref !== grant.authentication_ref) {
        reject("authentication_reference_mismatch");
      }
      if (
        grant.status !== "active" ||
        Date.parse(grant.issued_at) > now ||
        Date.parse(grant.expires_at) <= now ||
        Date.parse(grant.issued_at) > Date.parse(envelope.timestamp)
      ) {
        reject("authority_grant_inactive");
      }
      if (
        !grant.capability_ids.includes(capability.capability_id) ||
        !grant.message_types.includes(envelope.message_type) ||
        authorityOrder.get(grant.authority_level) <
          authorityOrder.get(capability.required_authority)
      ) {
        reject("authority_grant_out_of_scope");
      }
      if (envelope.delegation_ref !== grant.parent_grant_ref) {
        reject("delegation_reference_mismatch");
      }
      if (grant.parent_grant_ref !== null) {
        const parent = this.grants.get(grant.parent_grant_ref);
        if (
          !parent ||
          parent.status !== "active" ||
          Date.parse(parent.expires_at) <= now
        ) {
          reject("parent_grant_inactive");
        }
      }
      if (
        envelope.budget_ref !== null &&
        (!identity.budget_refs.includes(envelope.budget_ref) ||
          !grant.budget_refs.includes(envelope.budget_ref))
      ) {
        reject("budget_out_of_scope");
      }
    }
  }

  authorizeComponentEnvelope(envelope) {
    const sender = envelope.sender.id;
    const recipient = envelope.recipient;
    if (
      envelope.authentication_ref === null ||
      !this.componentAuthenticationRefs
        .get(sender)
        ?.has(envelope.authentication_ref)
    ) {
      reject("component_authentication_invalid");
    }
    const capability =
      envelope.requested_capability === null
        ? null
        : this.capabilities.get(envelope.requested_capability);
    if (envelope.requested_capability !== null && !capability) {
      reject("capability_unknown");
    }
    if (
      capability &&
      !capability.data_classifications.includes(envelope.data_classification)
    ) {
      reject("capability_out_of_scope");
    }
    if (envelope.message_type === "execution_request") {
      if (
        sender !== "brainstem" ||
        recipient.principal_type !== "runtime_component" ||
        recipient.id !== "kindred_cloud" ||
        envelope.authority_ref === null ||
        envelope.authentication_ref === null ||
        envelope.requested_capability === null ||
        capability.owner_component !== "kindred_cloud" ||
        capability.action_type !== "tool" ||
        capability.execution_mode === "proposal_only"
      ) {
        reject("execution_route_forbidden");
      }
    }
    if (envelope.message_type === "execution_receipt") {
      if (
        sender !== "kindred_cloud" ||
        recipient.principal_type !== "runtime_component" ||
        recipient.id !== "brainstem" ||
        envelope.evidence_refs.length === 0
      ) {
        reject("execution_receipt_route_forbidden");
      }
    }
    if (envelope.message_type === "settlement_request") {
      if (
        sender !== "brainstem" ||
        recipient.principal_type !== "runtime_component" ||
        recipient.id !== "retrobank" ||
        envelope.authority_ref === null ||
        envelope.authentication_ref === null ||
        envelope.budget_ref === null ||
        envelope.requested_capability === null ||
        capability.owner_component !== "retrobank" ||
        capability.action_type !== "settlement" ||
        capability.execution_mode !== "governed_local_reversible"
      ) {
        reject("settlement_route_forbidden");
      }
    }
    if (envelope.message_type === "revocation") {
      if (
        sender !== "brainstem" ||
        recipient.principal_type !== "runtime_component" ||
        recipient.id !== "brainstem" ||
        envelope.authority_ref !== null ||
        envelope.requested_capability !== null ||
        envelope.budget_ref !== null ||
        envelope.delegation_ref !== null ||
        envelope.data_classification !== "restricted"
      ) {
        reject("revocation_route_forbidden");
      }
    }
  }

  #authorizeValidatedEnvelope(envelope, now) {
    const sentAt = Date.parse(envelope.timestamp);
    const expiresAt = Date.parse(envelope.expires_at);
    if (sentAt > now + MAX_FUTURE_SKEW_MS) reject("envelope_from_future");
    if (expiresAt <= now) reject("envelope_expired");
    if (envelope.sender.principal_type === "agent") {
      this.authorizeAgentEnvelope(envelope, now);
    } else {
      this.authorizeComponentEnvelope(envelope);
    }
    if (envelope.recipient.principal_type === "agent") {
      this.requireActiveAgent(envelope.recipient.id);
    }
  }

  #acceptValidatedEnvelope(envelope, now) {
    this.#authorizeValidatedEnvelope(envelope, now);
    const expiresAt = Date.parse(envelope.expires_at);
    this.replayGuard.consume(
      envelope.sender.principal_type + ":" + envelope.sender.id,
      envelope.nonce,
      expiresAt,
    );
    return validateProtocolReceipt({
      contract_version: PROTOCOL_RECEIPT_CONTRACT_VERSION,
      message_id: envelope.message_id,
      correlation_id: envelope.correlation_id,
      status: "accepted",
      accepted_at: new Date(now).toISOString(),
      replay_consumed: true,
    });
  }

  acceptEnvelope(value) {
    const envelope = validateEnvelope(value);
    if (envelope.message_type === "revocation") {
      reject("revocation_requires_atomic_apply");
    }
    return this.#acceptValidatedEnvelope(envelope, this.now());
  }

  applyRevocation(value) {
    const envelope = validateEnvelope(value);
    const now = this.now();
    if (envelope.message_type !== "revocation") {
      reject("revocation_message_required");
    }
    if (
      envelope.sender.principal_type !== "runtime_component" ||
      envelope.sender.id !== "brainstem"
    ) {
      reject("revocation_route_forbidden");
    }
    this.#authorizeValidatedEnvelope(envelope, now);
    const notice = validateRevocationNotice(envelope.payload);
    if (
      notice.effective_at !== envelope.timestamp ||
      Date.parse(notice.effective_at) > now ||
      JSON.stringify(notice.evidence_refs) !== JSON.stringify(envelope.evidence_refs)
    ) {
      reject("revocation_evidence_invalid");
    }
    if (
      this.replayGuard.has(
        envelope.sender.principal_type + ":" + envelope.sender.id,
        envelope.nonce,
        now,
      )
    ) {
      reject("envelope_replay");
    }
    if (this.revocations.has(notice.revocation_id)) {
      reject("revocation_replay");
    }
    if (this.revocations.size >= 4096) {
      reject("revocation_capacity_reached", true);
    }

    let identityUpdate = null;
    const affectedGrantIds = new Set();
    if (notice.target_type === "agent") {
      const identity = this.identities.get(notice.target_id);
      if (!identity) reject("revocation_target_unknown");
      if (["revoked", "retired", "replaced"].includes(identity.lifecycle_state)) {
        reject("revocation_target_terminal");
      }
      identityUpdate = validateAgentIdentity({
        ...identity,
        lifecycle_state: "revoked",
        health: "unavailable",
        revoked_at: notice.effective_at,
      });
      for (const grant of this.grants.values()) {
        if (grant.subject_agent_id === identity.agent_id && grant.status !== "revoked") {
          affectedGrantIds.add(grant.grant_id);
        }
      }
    } else {
      const grant = this.grants.get(notice.target_id);
      if (!grant) reject("revocation_target_unknown");
      if (grant.status === "revoked") reject("revocation_target_terminal");
      affectedGrantIds.add(grant.grant_id);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const grant of this.grants.values()) {
        if (
          grant.status !== "revoked" &&
          grant.parent_grant_ref !== null &&
          affectedGrantIds.has(grant.parent_grant_ref) &&
          !affectedGrantIds.has(grant.grant_id)
        ) {
          affectedGrantIds.add(grant.grant_id);
          changed = true;
          if (affectedGrantIds.size > 4096) {
            reject("revocation_cascade_capacity_reached", true);
          }
        }
      }
    }
    const grantUpdates = [...affectedGrantIds].map((grantId) =>
      validateAuthorityGrant({
        ...this.grants.get(grantId),
        status: "revoked",
        revoked_at: notice.effective_at,
      }),
    );
    const revocationReceipt = validateRevocationReceipt({
      contract_version: REVOCATION_RECEIPT_CONTRACT_VERSION,
      revocation_id: notice.revocation_id,
      message_id: envelope.message_id,
      correlation_id: envelope.correlation_id,
      target_type: notice.target_type,
      target_id: notice.target_id,
      reason_class: notice.reason_class,
      status: "applied",
      effective_at: notice.effective_at,
      identity_state_changed: identityUpdate !== null,
      grants_revoked: grantUpdates.length,
      replay_consumed: true,
      history_preserved: true,
      provider_contacted: false,
      memory_mutated: false,
      tool_executed: false,
      settlement_executed: false,
      external_effects: false,
      evidence_refs: notice.evidence_refs,
      recorded_at: new Date(now).toISOString(),
    });

    this.#acceptValidatedEnvelope(envelope, now);
    if (identityUpdate !== null) {
      this.identities.set(identityUpdate.agent_id, identityUpdate);
    }
    for (const grant of grantUpdates) this.grants.set(grant.grant_id, grant);
    this.revocations.set(notice.revocation_id, revocationReceipt);
    return revocationReceipt;
  }
}

export function createLivingCompanionIdentity(options) {
  const companion = options?.companion;
  const accountId = options?.accountId;
  const tenantId = options?.tenantId;
  if (
    !isRecord(companion) ||
    companion.contract_version !== "kindred.companion.aggregate.v1" ||
    !boundedString(companion.id, 12, 96) ||
    companion.owner_account_id !== accountId ||
    companion.permissions?.owner_account_only !== true ||
    companion.permissions?.provider_access !== false ||
    !["companion_active", "companion_offline"].includes(
      companion.lifecycle_state,
    ) ||
    companion.provenance?.historical_data_status !==
      "unavailable_not_fabricated" ||
    !tenantIdPattern.test(tenantId)
  ) {
    reject("companion_aggregate_invalid");
  }
  const capabilities = options.capabilities ?? [];
  const grantRefs = options.grantRefs ?? [];
  const budgetRefs = options.budgetRefs ?? [];
  const suffix = companion.id.replace(/^local-companion-/, "");
  return validateAgentIdentity({
    contract_version: AGENT_IDENTITY_CONTRACT_VERSION,
    agent_id: "kindred-agent-companion-" + suffix,
    tenant_id: tenantId,
    agent_class: "living_companion",
    owner_id: accountId,
    creator_id: "kindred-component-brainstem",
    version: "1.0.0",
    lineage: { parent_agent_id: null, replaces_agent_id: null },
    purpose: "Maintain an owner-bound living companion presence without sovereign authority.",
    capabilities: [...capabilities],
    prohibited_capabilities: [
      "direct_memory_commit",
      "direct_tool_execution",
      "direct_value_movement",
      "founder_authority",
    ],
    permissions: ["companion.communicate", "companion.memory.propose"],
    authority: {
      issuer_component: "brainstem",
      grant_refs: [...grantRefs],
      ceiling: "user_delegated",
    },
    budget_refs: [...budgetRefs],
    lifecycle_state: "active",
    health:
      companion.lifecycle_state === "companion_active" ? "healthy" : "degraded",
    evidence_refs: [],
    memory_scope: {
      namespace_refs: ["companion:" + companion.id],
      write_mode: "proposal_only",
    },
    execution_scope: {
      mode: "proposal_only",
      allowed_capabilities: [...capabilities],
    },
    provider_scope: { mode: "mediated_only", provider_refs: [] },
    economic_mandate_ref: options.economicMandateRef ?? null,
    replacement_agent_id: null,
    created_at: companion.adopted_at,
    revoked_at: null,
  });
}
