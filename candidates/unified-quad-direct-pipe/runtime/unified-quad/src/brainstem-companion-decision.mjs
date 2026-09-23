import { createHash } from "node:crypto";
import {
  validateAgentIdentity,
  validateEnvelope,
  validateProtocolReceipt,
} from "./agent-protocol.mjs";
import {
  COMPANION_COMMUNICATION_CAPABILITY_ID,
  validateCompanionCommunicationProposal,
} from "./companion-communication.mjs";

export const BRAINSTEM_COMPANION_DECISION_CONTRACT_VERSION =
  "kindred.brainstem.companion-communication-decision.v1";
export const BRAINSTEM_COMPANION_DECISION_FIELDS = Object.freeze([
  "contract_version",
  "decision_id",
  "proposal_message_id",
  "correlation_id",
  "decision",
  "reason_class",
  "authority_component",
  "response_policy",
  "local_response_authorized",
  "provider_contact_authorized",
  "memory_write_authorized",
  "tool_execution_authorized",
  "settlement_authorized",
  "external_effects_authorized",
  "evidence_refs",
  "decided_at",
]);

const decisionIdPattern = /^brainstem-decision-[A-Za-z0-9_-]{20,48}$/;
const messageIdPattern = /^kindred-message-[A-Za-z0-9_-]{8,96}$/;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const denialReasons = new Set([
  "proposal_contract_invalid",
  "admission_receipt_invalid",
  "route_invalid",
  "authority_scope_invalid",
  "principal_inactive",
  "policy_denied",
]);

function exactKeys(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function digest(label, ...values) {
  return createHash("sha256")
    .update(label + ":" + values.join(":"))
    .digest("base64url")
    .slice(0, 32);
}

function reject(reasonClass = "decision_invalid") {
  const error = new Error("Brainstem companion decision rejected.");
  error.name = "BrainstemDecisionError";
  error.code = "brainstem_decision_rejected";
  error.reasonClass = reasonClass;
  error.retryable = false;
  throw error;
}

function validateAdmissionReceipt(value, envelope, now) {
  let receipt;
  try {
    receipt = validateProtocolReceipt(value);
  } catch {
    return false;
  }
  if (
    receipt.message_id !== envelope.message_id ||
    receipt.correlation_id !== envelope.correlation_id ||
    Date.parse(receipt.accepted_at) < Date.parse(envelope.timestamp) ||
    Date.parse(receipt.accepted_at) >= Date.parse(envelope.expires_at) ||
    Date.parse(receipt.accepted_at) > now
  ) {
    return false;
  }
  return true;
}

function fallbackReferences(input = {}) {
  const message = messageIdPattern.test(input?.envelope?.message_id ?? "")
    ? input.envelope.message_id
    : "kindred-message-BrainstemDenied00000001";
  const correlation = referencePattern.test(input?.envelope?.correlation_id ?? "")
    ? input.envelope.correlation_id
    : "brainstem-denied-correlation";
  return { message, correlation };
}

function inspect(input, now) {
  let envelope;
  try {
    envelope = validateEnvelope(input?.envelope);
    validateCompanionCommunicationProposal(envelope.payload);
  } catch {
    return { reason: "proposal_contract_invalid" };
  }
  if (
    envelope.message_type !== "proposal" ||
    envelope.sender.principal_type !== "agent" ||
    envelope.recipient.principal_type !== "runtime_component" ||
    envelope.recipient.id !== "brainstem" ||
    envelope.requested_capability !== COMPANION_COMMUNICATION_CAPABILITY_ID ||
    envelope.data_classification !== "confidential" ||
    envelope.correlation_id !== envelope.payload.client_message_id ||
    envelope.causation_id !== envelope.payload.user_message_id ||
    !envelope.evidence_refs.includes(envelope.payload.consent_receipt_ref)
  ) {
    return { envelope, reason: "route_invalid" };
  }
  if (!validateAdmissionReceipt(input?.protocolReceipt, envelope, now)) {
    return { envelope, reason: "admission_receipt_invalid" };
  }
  let identity;
  try {
    identity = validateAgentIdentity(input?.identity);
  } catch {
    return { envelope, reason: "authority_scope_invalid" };
  }
  if (identity.lifecycle_state !== "active") {
    return { envelope, reason: "principal_inactive" };
  }
  if (
    identity.agent_class !== "living_companion" ||
    identity.agent_id !== envelope.sender.id ||
    identity.agent_id !== envelope.payload.companion_principal_id ||
    identity.authority.ceiling !== "user_delegated" ||
    identity.authority.grant_refs.length !== 1 ||
    identity.authority.grant_refs[0] !== envelope.authority_ref ||
    !identity.permissions.includes("companion.communicate") ||
    identity.capabilities.length !== 1 ||
    identity.capabilities[0] !== COMPANION_COMMUNICATION_CAPABILITY_ID ||
    identity.execution_scope.allowed_capabilities.length !== 1 ||
    identity.execution_scope.allowed_capabilities[0] !==
      COMPANION_COMMUNICATION_CAPABILITY_ID ||
    identity.budget_refs.length !== 0 ||
    identity.provider_scope.provider_refs.length !== 0 ||
    identity.economic_mandate_ref !== null
  ) {
    return { envelope, reason: "authority_scope_invalid" };
  }
  return { envelope, reason: "local_acknowledgement_allowed" };
}

export function validateBrainstemCompanionDecision(value) {
  if (
    !exactKeys(value, BRAINSTEM_COMPANION_DECISION_FIELDS) ||
    value.contract_version !== BRAINSTEM_COMPANION_DECISION_CONTRACT_VERSION ||
    !decisionIdPattern.test(value.decision_id) ||
    !messageIdPattern.test(value.proposal_message_id) ||
    !referencePattern.test(value.correlation_id) ||
    !["approved", "denied"].includes(value.decision) ||
    value.authority_component !== "brainstem" ||
    value.provider_contact_authorized !== false ||
    value.memory_write_authorized !== false ||
    value.tool_execution_authorized !== false ||
    value.settlement_authorized !== false ||
    value.external_effects_authorized !== false ||
    !Array.isArray(value.evidence_refs) ||
    value.evidence_refs.length < 1 ||
    value.evidence_refs.length > 4 ||
    new Set(value.evidence_refs).size !== value.evidence_refs.length ||
    value.evidence_refs.some((reference) => !referencePattern.test(reference)) ||
    typeof value.decided_at !== "string" ||
    !Number.isFinite(Date.parse(value.decided_at))
  ) {
    reject();
  }
  const approved = value.decision === "approved";
  if (
    (approved &&
      (value.reason_class !== "local_acknowledgement_allowed" ||
        value.response_policy !== "deterministic_local_acknowledgement_only" ||
        value.local_response_authorized !== true)) ||
    (!approved &&
      (!denialReasons.has(value.reason_class) ||
        value.response_policy !== null ||
        value.local_response_authorized !== false))
  ) {
    reject("decision_policy_invalid");
  }
  return structuredClone(value);
}

export function decideCompanionCommunication(input = {}) {
  const now = Number(input.now);
  if (!Number.isFinite(now)) reject("decision_timestamp_invalid");
  const inspected = inspect(input, now);
  const fallback = fallbackReferences(input);
  const envelope = inspected.envelope;
  const approved = inspected.reason === "local_acknowledgement_allowed";
  const proposalMessageId = envelope?.message_id ?? fallback.message;
  const correlationId = envelope?.correlation_id ?? fallback.correlation;
  const evidenceRefs = approved
    ? [proposalMessageId, envelope.payload.consent_receipt_ref]
    : [proposalMessageId, "brainstem-reason:" + inspected.reason];
  return validateBrainstemCompanionDecision({
    contract_version: BRAINSTEM_COMPANION_DECISION_CONTRACT_VERSION,
    decision_id:
      "brainstem-decision-" +
      digest("brainstem-companion-decision", proposalMessageId, correlationId, inspected.reason),
    proposal_message_id: proposalMessageId,
    correlation_id: correlationId,
    decision: approved ? "approved" : "denied",
    reason_class: inspected.reason,
    authority_component: "brainstem",
    response_policy: approved
      ? "deterministic_local_acknowledgement_only"
      : null,
    local_response_authorized: approved,
    provider_contact_authorized: false,
    memory_write_authorized: false,
    tool_execution_authorized: false,
    settlement_authorized: false,
    external_effects_authorized: false,
    evidence_refs: evidenceRefs,
    decided_at: new Date(now).toISOString(),
  });
}
