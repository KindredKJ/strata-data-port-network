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

export const COMPANION_COMMUNICATION_PROPOSAL_CONTRACT_VERSION =
  "kindred.agent.companion-communication-proposal.v1";
export const COMPANION_COMMUNICATION_CAPABILITY_ID =
  "kindred.capability.companion.communication-proposal.v1";

export const COMPANION_COMMUNICATION_PROPOSAL_FIELDS = Object.freeze([
  "contract_version",
  "purpose",
  "consent_receipt_ref",
  "companion_principal_id",
  "user_message_id",
  "client_message_id",
  "content",
  "response_mode",
  "provider_contact_requested",
  "memory_write_requested",
  "tool_execution_requested",
  "settlement_requested",
  "external_effects",
]);

const consentReceiptPattern = /^consent-receipt-[A-Za-z0-9_-]{20,48}$/;
const companionPrincipalPattern = /^kindred-agent-companion-[A-Za-z0-9_-]{8,96}$/;
const userMessagePattern = /^chat-message-[A-Za-z0-9_-]{8,96}$/;
const clientMessagePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const unsafeContentPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PROPOSAL_TTL_MS = 2 * 60 * 1000;

function reject(reasonClass) {
  const error = new Error("Companion communication proposal rejected.");
  error.name = "CompanionCommunicationError";
  error.code = "companion_communication_rejected";
  error.reasonClass = reasonClass;
  error.retryable = false;
  throw error;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("proposal_fields_invalid");
  }
  const actual = Object.keys(value).sort();
  const orderedExpected = [...expected].sort();
  if (
    actual.length !== orderedExpected.length ||
    actual.some((key, index) => key !== orderedExpected[index])
  ) {
    reject("proposal_fields_invalid");
  }
}

function digest(label, ...values) {
  return createHash("sha256")
    .update(label + ":" + values.join(":"))
    .digest("base64url")
    .slice(0, 32);
}

function communicationCapability() {
  return validateCapability({
    contract_version: CAPABILITY_CONTRACT_VERSION,
    capability_id: COMPANION_COMMUNICATION_CAPABILITY_ID,
    version: "1.0.0",
    owner_component: "emit_core",
    action_type: "communication",
    allowed_agent_classes: ["living_companion"],
    required_authority: "user_delegated",
    risk_ceiling: "low",
    data_classifications: ["confidential"],
    execution_mode: "proposal_only",
    provider_contact: "mediated_only",
    memory_commit: "brainstem_only",
    settlement: "retrobank_mandate_only",
    compensation_required: false,
    input_contract_ref:
      "contracts/agent/v1/companion-communication-proposal.schema.json",
    output_contract_ref: "contracts/agent/v1/protocol-receipt.schema.json",
  });
}

export function validateCompanionCommunicationProposal(value) {
  exactKeys(value, COMPANION_COMMUNICATION_PROPOSAL_FIELDS);
  if (
    value.contract_version !==
      COMPANION_COMMUNICATION_PROPOSAL_CONTRACT_VERSION ||
    value.purpose !== "companion_chat" ||
    !consentReceiptPattern.test(value.consent_receipt_ref) ||
    !companionPrincipalPattern.test(value.companion_principal_id) ||
    !userMessagePattern.test(value.user_message_id) ||
    !clientMessagePattern.test(value.client_message_id) ||
    typeof value.content !== "string" ||
    value.content.length === 0 ||
    value.content.length > 4096 ||
    value.content !== value.content.normalize("NFKC").trim() ||
    unsafeContentPattern.test(value.content) ||
    value.response_mode !== "brainstem_decision_required" ||
    value.provider_contact_requested !== false ||
    value.memory_write_requested !== false ||
    value.tool_execution_requested !== false ||
    value.settlement_requested !== false ||
    value.external_effects !== false
  ) {
    reject("proposal_invalid");
  }
  return structuredClone(value);
}

export function createCompanionCommunicationArtifacts(input = {}) {
  const identity = validateAgentIdentity(input.identity);
  if (
    identity.agent_class !== "living_companion" ||
    identity.capabilities.length !== 0 ||
    identity.authority.grant_refs.length !== 0 ||
    identity.budget_refs.length !== 0 ||
    identity.execution_scope.allowed_capabilities.length !== 0 ||
    identity.provider_scope.provider_refs.length !== 0 ||
    identity.economic_mandate_ref !== null
  ) {
    reject("companion_scope_not_empty");
  }
  const proposal = validateCompanionCommunicationProposal({
    contract_version: COMPANION_COMMUNICATION_PROPOSAL_CONTRACT_VERSION,
    purpose: "companion_chat",
    consent_receipt_ref: input.consentReceiptRef,
    companion_principal_id: identity.agent_id,
    user_message_id: input.userMessageId,
    client_message_id: input.clientMessageId,
    content: input.content,
    response_mode: "brainstem_decision_required",
    provider_contact_requested: false,
    memory_write_requested: false,
    tool_execution_requested: false,
    settlement_requested: false,
    external_effects: false,
  });
  const now = Number(input.now);
  if (!Number.isFinite(now)) reject("proposal_timestamp_invalid");
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + PROPOSAL_TTL_MS).toISOString();
  const seed = digest(
    "companion-communication",
    identity.agent_id,
    proposal.consent_receipt_ref,
    proposal.client_message_id,
  );
  const capability = communicationCapability();
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
    permissions: ["companion.communicate"],
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
    correlation_id: proposal.client_message_id,
    causation_id: proposal.user_message_id,
    nonce: digest("nonce", seed),
    timestamp: issuedAt,
    expires_at: expiresAt,
    data_classification: "confidential",
    requested_capability: capability.capability_id,
    budget_ref: null,
    evidence_refs: [proposal.consent_receipt_ref],
    authentication_ref: grant.authentication_ref,
    delegation_ref: null,
    payload: proposal,
  });
  return { capability, grant, identity: scopedIdentity, envelope };
}
