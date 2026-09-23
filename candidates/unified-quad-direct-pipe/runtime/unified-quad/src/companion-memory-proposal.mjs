import { createHash } from "node:crypto";
import {
  AGENT_IDENTITY_CONTRACT_VERSION,
  AUTHORITY_GRANT_CONTRACT_VERSION,
  CAPABILITY_CONTRACT_VERSION,
  MESSAGE_ENVELOPE_CONTRACT_VERSION,
  validateAgentIdentity,
  validateAuthorityGrant,
  validateCapability,
  validateEnvelope,
} from "./agent-protocol.mjs";

export const COMPANION_MEMORY_PROPOSAL_CONTRACT_VERSION =
  "kindred.agent.companion-memory-proposal.v1";
export const COMPANION_MEMORY_PROPOSAL_CAPABILITY_ID =
  "kindred.capability.companion.memory-proposal.v1";
export const COMPANION_MEMORY_PROPOSAL_FIELDS = Object.freeze([
  "contract_version",
  "purpose",
  "consent_receipt_ref",
  "companion_principal_id",
  "client_request_id",
  "target_namespace_ref",
  "expected_memory_version",
  "mutation",
  "category",
  "content",
  "source_kind",
  "source_reference",
  "retention",
  "companion_access",
  "verification",
  "commit_policy",
  "memory_mutated",
  "provider_contact_requested",
  "tool_execution_requested",
  "settlement_requested",
  "external_effects",
]);

const categories = new Set([
  "working",
  "episodic",
  "semantic",
  "relationship",
  "preference",
  "procedural",
  "safety_governance",
  "provenance",
]);
const retentions = new Set(["session", "until_revoked", "user_managed"]);
const consentReceiptPattern = /^consent-receipt-[A-Za-z0-9_-]{20,48}$/;
const companionPrincipalPattern = /^kindred-agent-companion-[A-Za-z0-9_-]{8,96}$/;
const clientRequestPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const namespacePattern = /^companion:local-companion-[A-Za-z0-9_-]{8,96}$/;
const unsafeContentPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PROPOSAL_TTL_MS = 2 * 60 * 1000;

function reject(reasonClass) {
  const error = new Error("Companion memory proposal rejected.");
  error.name = "CompanionMemoryProposalError";
  error.code = "companion_memory_proposal_rejected";
  error.reasonClass = reasonClass;
  error.retryable = false;
  throw error;
}

function exactKeys(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("memory_proposal_fields_invalid");
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    reject("memory_proposal_fields_invalid");
  }
}

function digest(label, ...values) {
  return createHash("sha256")
    .update(label + ":" + values.join(":"))
    .digest("base64url")
    .slice(0, 32);
}

function memoryProposalCapability() {
  return validateCapability({
    contract_version: CAPABILITY_CONTRACT_VERSION,
    capability_id: COMPANION_MEMORY_PROPOSAL_CAPABILITY_ID,
    version: "1.0.0",
    owner_component: "brainstem",
    action_type: "memory_proposal",
    allowed_agent_classes: ["living_companion"],
    required_authority: "user_delegated",
    risk_ceiling: "medium",
    data_classifications: ["confidential"],
    execution_mode: "proposal_only",
    provider_contact: "mediated_only",
    memory_commit: "brainstem_only",
    settlement: "retrobank_mandate_only",
    compensation_required: false,
    input_contract_ref:
      "contracts/agent/v1/companion-memory-proposal.schema.json",
    output_contract_ref: "contracts/agent/v1/protocol-receipt.schema.json",
  });
}

export function validateCompanionMemoryProposal(value) {
  exactKeys(value, COMPANION_MEMORY_PROPOSAL_FIELDS);
  if (
    value.contract_version !== COMPANION_MEMORY_PROPOSAL_CONTRACT_VERSION ||
    value.purpose !== "companion_memory" ||
    !consentReceiptPattern.test(value.consent_receipt_ref) ||
    !companionPrincipalPattern.test(value.companion_principal_id) ||
    !clientRequestPattern.test(value.client_request_id) ||
    !namespacePattern.test(value.target_namespace_ref) ||
    !Number.isSafeInteger(value.expected_memory_version) ||
    value.expected_memory_version < 1 ||
    value.mutation !== "append_unverified" ||
    !categories.has(value.category) ||
    typeof value.content !== "string" ||
    value.content.length === 0 ||
    value.content.length > 4096 ||
    value.content !== value.content.normalize("NFKC").trim() ||
    unsafeContentPattern.test(value.content) ||
    value.source_kind !== "user_provided" ||
    value.source_reference !== null ||
    !retentions.has(value.retention) ||
    typeof value.companion_access !== "boolean" ||
    value.verification !== "unverified" ||
    value.commit_policy !== "brainstem_decision_required" ||
    value.memory_mutated !== false ||
    value.provider_contact_requested !== false ||
    value.tool_execution_requested !== false ||
    value.settlement_requested !== false ||
    value.external_effects !== false
  ) {
    reject("memory_proposal_invalid");
  }
  const suffix = value.companion_principal_id.replace(
    /^kindred-agent-companion-/,
    "",
  );
  if (value.target_namespace_ref !== "companion:local-companion-" + suffix) {
    reject("memory_proposal_target_invalid");
  }
  return structuredClone(value);
}

export function createCompanionMemoryProposalArtifacts(input = {}) {
  const identity = validateAgentIdentity(input.identity);
  if (
    identity.agent_class !== "living_companion" ||
    identity.lifecycle_state !== "active" ||
    identity.capabilities.length !== 0 ||
    identity.authority.grant_refs.length !== 0 ||
    identity.budget_refs.length !== 0 ||
    identity.execution_scope.allowed_capabilities.length !== 0 ||
    identity.provider_scope.provider_refs.length !== 0 ||
    identity.economic_mandate_ref !== null ||
    identity.memory_scope.namespace_refs.length !== 1 ||
    identity.memory_scope.namespace_refs[0] !== input.targetNamespaceRef ||
    !identity.permissions.includes("companion.memory.propose")
  ) {
    reject("companion_memory_scope_invalid");
  }
  const proposal = validateCompanionMemoryProposal({
    contract_version: COMPANION_MEMORY_PROPOSAL_CONTRACT_VERSION,
    purpose: "companion_memory",
    consent_receipt_ref: input.consentReceiptRef,
    companion_principal_id: identity.agent_id,
    client_request_id: input.clientRequestId,
    target_namespace_ref: input.targetNamespaceRef,
    expected_memory_version: input.expectedMemoryVersion,
    mutation: "append_unverified",
    category: input.memory?.category,
    content: input.memory?.content,
    source_kind: input.memory?.source?.kind,
    source_reference: input.memory?.source?.reference ?? null,
    retention: input.memory?.retention,
    companion_access: input.memory?.companion_access,
    verification: "unverified",
    commit_policy: "brainstem_decision_required",
    memory_mutated: false,
    provider_contact_requested: false,
    tool_execution_requested: false,
    settlement_requested: false,
    external_effects: false,
  });
  const now = Number(input.now);
  if (!Number.isFinite(now)) reject("memory_proposal_timestamp_invalid");
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + PROPOSAL_TTL_MS).toISOString();
  const seed = digest(
    "companion-memory-proposal",
    identity.agent_id,
    proposal.consent_receipt_ref,
    proposal.client_request_id,
    String(proposal.expected_memory_version),
    proposal.content,
  );
  const capability = memoryProposalCapability();
  const grant = validateAuthorityGrant({
    contract_version: AUTHORITY_GRANT_CONTRACT_VERSION,
    grant_id: "kindred-grant-" + digest("grant", seed),
    subject_agent_id: identity.agent_id,
    issuer_component: "brainstem",
    issuer_id: "kindred-component-brainstem",
    authentication_ref: "kindred-authref-" + digest("authref", seed),
    authority_level: "user_delegated",
    capability_ids: [capability.capability_id],
    message_types: ["proposal"],
    permissions: ["companion.memory.propose"],
    budget_refs: [],
    parent_grant_ref: null,
    issued_at: issuedAt,
    expires_at: expiresAt,
    status: "active",
    revoked_at: null,
  });
  const scopedIdentity = validateAgentIdentity({
    ...structuredClone(identity),
    contract_version: AGENT_IDENTITY_CONTRACT_VERSION,
    capabilities: [capability.capability_id],
    authority: {
      ...structuredClone(identity.authority),
      grant_refs: [grant.grant_id],
    },
    execution_scope: {
      ...structuredClone(identity.execution_scope),
      allowed_capabilities: [capability.capability_id],
    },
  });
  const envelope = validateEnvelope({
    contract_version: MESSAGE_ENVELOPE_CONTRACT_VERSION,
    message_id: "kindred-message-" + digest("message", seed),
    message_type: "proposal",
    sender: { principal_type: "agent", id: identity.agent_id },
    recipient: { principal_type: "runtime_component", id: "brainstem" },
    authority_ref: grant.grant_id,
    correlation_id: proposal.client_request_id,
    causation_id: "memory-version:" + proposal.expected_memory_version,
    nonce: digest("nonce", seed),
    timestamp: issuedAt,
    expires_at: expiresAt,
    data_classification: "confidential",
    requested_capability: capability.capability_id,
    budget_ref: null,
    evidence_refs: [proposal.consent_receipt_ref, proposal.target_namespace_ref],
    authentication_ref: grant.authentication_ref,
    delegation_ref: null,
    payload: proposal,
  });
  return { capability, grant, identity: scopedIdentity, envelope };
}
