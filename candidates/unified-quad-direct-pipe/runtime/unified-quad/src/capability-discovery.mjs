import { createHash } from "node:crypto";
import {
  AUTHORITY_GRANT_CONTRACT_VERSION,
  MESSAGE_ENVELOPE_CONTRACT_VERSION,
  AgentProtocolGateway,
  validateAgentIdentity,
  validateAuthorityGrant,
  validateCapability,
  validateEnvelope,
  validateProtocolReceipt,
} from "./agent-protocol.mjs";

export const CAPABILITY_DISCOVERY_QUERY_CONTRACT_VERSION =
  "kindred.agent.capability-discovery-query.v1";
export const CAPABILITY_DISCOVERY_RESULT_CONTRACT_VERSION =
  "kindred.agent.capability-discovery-result.v1";
export const CAPABILITY_DISCOVERY_QUERY_FIELDS = Object.freeze([
  "contract_version",
  "requester_agent_id",
  "action_types",
  "data_classification",
  "risk_ceiling",
  "result_limit",
  "include_unavailable",
  "authority_requested",
  "provider_contact_requested",
  "memory_write_requested",
  "tool_execution_requested",
  "settlement_requested",
  "external_effects",
]);
export const CAPABILITY_DISCOVERY_RESULT_FIELDS = Object.freeze([
  "contract_version",
  "query_message_id",
  "correlation_id",
  "catalog_component",
  "result_count",
  "truncated",
  "capabilities",
  "authority_granted",
  "execution_authorized",
  "provider_contact_authorized",
  "memory_write_authorized",
  "settlement_authorized",
  "external_effects_authorized",
  "evidence_refs",
  "generated_at",
]);
export const CAPABILITY_DISCOVERY_PROJECTION_FIELDS = Object.freeze([
  "capability_id",
  "version",
  "owner_component",
  "action_type",
  "required_authority",
  "risk_ceiling",
  "data_classifications",
  "execution_mode",
  "available",
  "input_contract_ref",
  "output_contract_ref",
]);

const actionTypes = Object.freeze([
  "communication",
  "reasoning",
  "memory_proposal",
  "tool",
  "settlement",
]);
const classifications = Object.freeze([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const riskLevels = Object.freeze(["low", "medium", "high", "critical"]);
const riskOrder = new Map(riskLevels.map((risk, index) => [risk, index]));
const agentIdPattern = /^kindred-agent-[A-Za-z0-9_-]{8,96}$/;
const messageIdPattern = /^kindred-message-[A-Za-z0-9_-]{8,96}$/;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const capabilityIdPattern = /^kindred\.capability\.[a-z0-9_.-]{3,96}\.v[0-9]+$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const DISCOVERY_TTL_MS = 2 * 60 * 1000;

export class CapabilityDiscoveryError extends Error {
  constructor(reasonClass) {
    super("Capability discovery request rejected.");
    this.name = "CapabilityDiscoveryError";
    this.code = "capability_discovery_rejected";
    this.reasonClass = reasonClass;
    this.retryable = false;
  }
}

function reject(reasonClass) {
  throw new CapabilityDiscoveryError(reasonClass);
}

function exactKeys(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function uniqueEnum(value, allowed, maximum) {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    new Set(value).size === value.length &&
    value.every((item) => allowed.includes(item))
  );
}

function digest(label, ...values) {
  return createHash("sha256")
    .update(label + ":" + values.join(":"))
    .digest("base64url")
    .slice(0, 32);
}

export function validateCapabilityDiscoveryQuery(value) {
  if (
    !exactKeys(value, CAPABILITY_DISCOVERY_QUERY_FIELDS) ||
    value.contract_version !== CAPABILITY_DISCOVERY_QUERY_CONTRACT_VERSION ||
    !agentIdPattern.test(value.requester_agent_id) ||
    !uniqueEnum(value.action_types, actionTypes, actionTypes.length) ||
    !classifications.includes(value.data_classification) ||
    !riskLevels.includes(value.risk_ceiling) ||
    !Number.isSafeInteger(value.result_limit) ||
    value.result_limit < 1 ||
    value.result_limit > 64 ||
    value.include_unavailable !== false ||
    value.authority_requested !== false ||
    value.provider_contact_requested !== false ||
    value.memory_write_requested !== false ||
    value.tool_execution_requested !== false ||
    value.settlement_requested !== false ||
    value.external_effects !== false
  ) {
    reject("discovery_query_invalid");
  }
  return structuredClone(value);
}

function validateProjection(value) {
  if (
    !exactKeys(value, CAPABILITY_DISCOVERY_PROJECTION_FIELDS) ||
    !capabilityIdPattern.test(value.capability_id) ||
    !versionPattern.test(value.version) ||
    !["brainstem", "kindred_cloud", "emit_core", "retrobank"].includes(
      value.owner_component,
    ) ||
    !actionTypes.includes(value.action_type) ||
    !["none", "user_delegated", "governance_delegated", "founder_delegated"].includes(
      value.required_authority,
    ) ||
    !riskLevels.includes(value.risk_ceiling) ||
    !uniqueEnum(value.data_classifications, classifications, classifications.length) ||
    !["proposal_only", "governed_local_reversible", "governed_external"].includes(
      value.execution_mode,
    ) ||
    typeof value.available !== "boolean" ||
    typeof value.input_contract_ref !== "string" ||
    value.input_contract_ref.length < 3 ||
    value.input_contract_ref.length > 256 ||
    typeof value.output_contract_ref !== "string" ||
    value.output_contract_ref.length < 3 ||
    value.output_contract_ref.length > 256
  ) {
    reject("discovery_projection_invalid");
  }
  return structuredClone(value);
}

export function validateCapabilityDiscoveryResult(value) {
  if (
    !exactKeys(value, CAPABILITY_DISCOVERY_RESULT_FIELDS) ||
    value.contract_version !== CAPABILITY_DISCOVERY_RESULT_CONTRACT_VERSION ||
    !messageIdPattern.test(value.query_message_id) ||
    !referencePattern.test(value.correlation_id) ||
    value.catalog_component !== "brainstem" ||
    !Number.isSafeInteger(value.result_count) ||
    value.result_count < 0 ||
    value.result_count > 64 ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length !== value.result_count ||
    value.authority_granted !== false ||
    value.execution_authorized !== false ||
    value.provider_contact_authorized !== false ||
    value.memory_write_authorized !== false ||
    value.settlement_authorized !== false ||
    value.external_effects_authorized !== false ||
    !Array.isArray(value.evidence_refs) ||
    value.evidence_refs.length < 1 ||
    value.evidence_refs.length > 4 ||
    new Set(value.evidence_refs).size !== value.evidence_refs.length ||
    value.evidence_refs.some((reference) => !referencePattern.test(reference)) ||
    typeof value.generated_at !== "string" ||
    !Number.isFinite(Date.parse(value.generated_at))
  ) {
    reject("discovery_result_invalid");
  }
  const projections = value.capabilities.map(validateProjection);
  if (
    new Set(projections.map((capability) => capability.capability_id)).size !==
    projections.length
  ) {
    reject("discovery_result_duplicate");
  }
  return structuredClone({ ...value, capabilities: projections });
}

export function createCapabilityDiscoveryArtifacts(input = {}) {
  const identity = validateAgentIdentity(input.identity);
  if (identity.lifecycle_state !== "active") reject("discovery_principal_inactive");
  if (
    !["user_delegated", "governance_delegated", "founder_delegated"].includes(
      identity.authority.ceiling,
    )
  ) {
    reject("discovery_authority_ceiling_invalid");
  }
  const now = Number(input.now);
  if (!Number.isFinite(now)) reject("discovery_timestamp_invalid");
  if (!referencePattern.test(input.correlationId ?? "")) {
    reject("discovery_correlation_invalid");
  }
  const query = validateCapabilityDiscoveryQuery({
    contract_version: CAPABILITY_DISCOVERY_QUERY_CONTRACT_VERSION,
    requester_agent_id: identity.agent_id,
    action_types: input.actionTypes ?? [],
    data_classification: input.dataClassification ?? "internal",
    risk_ceiling: input.riskCeiling ?? "low",
    result_limit: input.resultLimit ?? 16,
    include_unavailable: false,
    authority_requested: false,
    provider_contact_requested: false,
    memory_write_requested: false,
    tool_execution_requested: false,
    settlement_requested: false,
    external_effects: false,
  });
  const seed = digest("capability-discovery", identity.agent_id, input.correlationId);
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + DISCOVERY_TTL_MS).toISOString();
  const grant = validateAuthorityGrant({
    contract_version: AUTHORITY_GRANT_CONTRACT_VERSION,
    grant_id: "kindred-grant-" + digest("discovery-grant", seed),
    subject_agent_id: identity.agent_id,
    issuer_component: "brainstem",
    issuer_id: "kindred-component-brainstem",
    authentication_ref: "kindred-authref-" + digest("discovery-authref", seed),
    authority_level: "user_delegated",
    capability_ids: [],
    message_types: ["discovery"],
    permissions: ["capability.discover"],
    budget_refs: [],
    parent_grant_ref: null,
    issued_at: issuedAt,
    expires_at: expiresAt,
    status: "active",
    revoked_at: null,
  });
  const scopedIdentity = validateAgentIdentity({
    ...identity,
    authority: {
      ...identity.authority,
      grant_refs: [...identity.authority.grant_refs, grant.grant_id],
    },
  });
  const envelope = validateEnvelope({
    contract_version: MESSAGE_ENVELOPE_CONTRACT_VERSION,
    message_id: "kindred-message-" + digest("discovery-message", seed),
    message_type: "discovery",
    sender: { principal_type: "agent", id: identity.agent_id },
    recipient: { principal_type: "runtime_component", id: "brainstem" },
    authority_ref: grant.grant_id,
    correlation_id: input.correlationId,
    causation_id: null,
    nonce: digest("discovery-nonce", seed),
    timestamp: issuedAt,
    expires_at: expiresAt,
    data_classification: "internal",
    requested_capability: null,
    budget_ref: null,
    evidence_refs: [],
    authentication_ref: grant.authentication_ref,
    delegation_ref: null,
    payload: query,
  });
  return { grant, identity: scopedIdentity, envelope };
}

export function executeCapabilityDiscovery(input = {}) {
  if (
    !input.replayGuard ||
    typeof input.replayGuard.consume !== "function" ||
    typeof input.replayGuard.prune !== "function"
  ) {
    reject("discovery_replay_guard_required");
  }
  if (!(input.catalog instanceof CapabilityDiscoveryCatalog)) {
    reject("discovery_catalog_required");
  }
  const artifacts = createCapabilityDiscoveryArtifacts(input);
  const gateway = new AgentProtocolGateway({
    now: () => Number(input.now),
    replayGuard: input.replayGuard,
  });
  gateway.registerIdentity(artifacts.identity);
  gateway.registerAuthorityGrant(artifacts.grant);
  const admissionReceipt = gateway.acceptEnvelope(artifacts.envelope);
  const result = input.catalog.discover({
    envelope: artifacts.envelope,
    protocolReceipt: admissionReceipt,
    identity: artifacts.identity,
    now: input.now,
  });
  return {
    admission_receipt: admissionReceipt,
    result,
  };
}

export class CapabilityDiscoveryCatalog {
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.maxCapabilities = options.maxCapabilities ?? 1024;
    if (
      !Number.isSafeInteger(this.maxCapabilities) ||
      this.maxCapabilities < 1 ||
      this.maxCapabilities > 4096
    ) {
      throw new TypeError("maxCapabilities must be between 1 and 4096");
    }
    this.entries = new Map();
  }

  registerCapability(value, options = {}) {
    const capability = validateCapability(value);
    const available = options.available ?? true;
    if (typeof available !== "boolean") reject("discovery_availability_invalid");
    const existing = this.entries.get(capability.capability_id);
    if (existing && JSON.stringify(existing.capability) !== JSON.stringify(capability)) {
      reject("discovery_capability_conflict");
    }
    if (!existing && this.entries.size >= this.maxCapabilities) {
      reject("discovery_catalog_capacity_reached");
    }
    this.entries.set(capability.capability_id, { capability, available });
    return structuredClone(capability);
  }

  setAvailability(capabilityId, available) {
    const entry = this.entries.get(capabilityId);
    if (!entry) reject("discovery_capability_unknown");
    if (typeof available !== "boolean") reject("discovery_availability_invalid");
    entry.available = available;
  }

  discover(input = {}) {
    const now = Number(input.now ?? this.now());
    if (!Number.isFinite(now)) reject("discovery_timestamp_invalid");
    let envelope;
    let receipt;
    let identity;
    let query;
    try {
      envelope = validateEnvelope(input.envelope);
      receipt = validateProtocolReceipt(input.protocolReceipt);
      identity = validateAgentIdentity(input.identity);
      query = validateCapabilityDiscoveryQuery(envelope.payload);
    } catch {
      reject("discovery_evidence_invalid");
    }
    if (
      envelope.message_type !== "discovery" ||
      envelope.sender.principal_type !== "agent" ||
      envelope.recipient.principal_type !== "runtime_component" ||
      envelope.recipient.id !== "brainstem" ||
      envelope.requested_capability !== null ||
      envelope.budget_ref !== null ||
      envelope.data_classification !== "internal" ||
      envelope.sender.id !== identity.agent_id ||
      query.requester_agent_id !== identity.agent_id
    ) {
      reject("discovery_route_invalid");
    }
    if (identity.lifecycle_state !== "active") reject("discovery_principal_inactive");
    if (
      receipt.message_id !== envelope.message_id ||
      receipt.correlation_id !== envelope.correlation_id ||
      Date.parse(receipt.accepted_at) < Date.parse(envelope.timestamp) ||
      Date.parse(receipt.accepted_at) >= Date.parse(envelope.expires_at) ||
      Date.parse(receipt.accepted_at) > now
    ) {
      reject("discovery_receipt_invalid");
    }
    const eligible = [...this.entries.values()]
      .filter(({ capability, available }) =>
        available &&
        capability.allowed_agent_classes.includes(identity.agent_class) &&
        capability.data_classifications.includes(query.data_classification) &&
        riskOrder.get(capability.risk_ceiling) <= riskOrder.get(query.risk_ceiling) &&
        (query.action_types.length === 0 ||
          query.action_types.includes(capability.action_type)),
      )
      .sort((left, right) =>
        left.capability.capability_id.localeCompare(right.capability.capability_id),
      );
    const capabilities = eligible.slice(0, query.result_limit).map(({ capability }) =>
      validateProjection({
        capability_id: capability.capability_id,
        version: capability.version,
        owner_component: capability.owner_component,
        action_type: capability.action_type,
        required_authority: capability.required_authority,
        risk_ceiling: capability.risk_ceiling,
        data_classifications: capability.data_classifications,
        execution_mode: capability.execution_mode,
        available: true,
        input_contract_ref: capability.input_contract_ref,
        output_contract_ref: capability.output_contract_ref,
      }),
    );
    return validateCapabilityDiscoveryResult({
      contract_version: CAPABILITY_DISCOVERY_RESULT_CONTRACT_VERSION,
      query_message_id: envelope.message_id,
      correlation_id: envelope.correlation_id,
      catalog_component: "brainstem",
      result_count: capabilities.length,
      truncated: eligible.length > capabilities.length,
      capabilities,
      authority_granted: false,
      execution_authorized: false,
      provider_contact_authorized: false,
      memory_write_authorized: false,
      settlement_authorized: false,
      external_effects_authorized: false,
      evidence_refs: [receipt.message_id],
      generated_at: new Date(now).toISOString(),
    });
  }
}
