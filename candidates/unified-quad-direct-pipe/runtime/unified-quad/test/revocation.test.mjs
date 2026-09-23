import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUTHORITY_GRANT_CONTRACT_VERSION,
  CAPABILITY_CONTRACT_VERSION,
  MESSAGE_ENVELOPE_CONTRACT_VERSION,
  REVOCATION_NOTICE_CONTRACT_VERSION,
  REVOCATION_NOTICE_FIELDS,
  REVOCATION_RECEIPT_CONTRACT_VERSION,
  REVOCATION_RECEIPT_FIELDS,
  AgentProtocolError,
  AgentProtocolGateway,
  createLivingCompanionIdentity,
  validateRevocationNotice,
  validateRevocationReceipt,
} from "../src/agent-protocol.mjs";

const fixedNow = Date.parse("2026-07-21T22:00:00.000Z");
const capabilityId = "kindred.capability.companion.revocation-fixture.v1";
const parentGrantId = "kindred-grant-revocation-parent-0001";
const childGrantId = "kindred-grant-revocation-child-0001";
const componentAuth = "kindred-authref-brainstem-revocation-0001";

function companion() {
  return {
    contract_version: "kindred.companion.aggregate.v1",
    id: "local-companion-RevocationFixture0001",
    owner_account_id: "kindred-account-revocation-0001",
    adopted_at: "2026-07-21T20:00:00.000Z",
    lifecycle_state: "companion_active",
    permissions: { owner_account_only: true, provider_access: false },
    provenance: {
      origin: "local_simulation",
      historical_data_status: "unavailable_not_fabricated",
    },
  };
}

function identity() {
  return createLivingCompanionIdentity({
    companion: companion(),
    accountId: companion().owner_account_id,
    tenantId: "kindred-tenant-revocation-0001",
    capabilities: [capabilityId],
    grantRefs: [parentGrantId, childGrantId],
  });
}

function capability() {
  return {
    contract_version: CAPABILITY_CONTRACT_VERSION,
    capability_id: capabilityId,
    version: "1.0.0",
    owner_component: "brainstem",
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
    input_contract_ref: "contracts/agent/v1/message-envelope.schema.json",
    output_contract_ref: "contracts/agent/v1/protocol-receipt.schema.json",
  };
}

function grant(grantId, parentGrantRef = null) {
  return {
    contract_version: AUTHORITY_GRANT_CONTRACT_VERSION,
    grant_id: grantId,
    subject_agent_id: identity().agent_id,
    issuer_component: "brainstem",
    issuer_id: "kindred-component-brainstem",
    authentication_ref: "kindred-authref-companion-revocation-0001",
    authority_level: "user_delegated",
    capability_ids: [capabilityId],
    message_types: ["proposal"],
    permissions: ["companion.communicate"],
    budget_refs: [],
    parent_grant_ref: parentGrantRef,
    issued_at: "2026-07-21T21:00:00.000Z",
    expires_at: "2026-07-21T23:00:00.000Z",
    status: "active",
    revoked_at: null,
  };
}

function proposal() {
  return {
    contract_version: MESSAGE_ENVELOPE_CONTRACT_VERSION,
    message_id: "kindred-message-revocation-proposal-0001",
    message_type: "proposal",
    sender: { principal_type: "agent", id: identity().agent_id },
    recipient: { principal_type: "runtime_component", id: "brainstem" },
    authority_ref: childGrantId,
    correlation_id: "revocation-proposal-correlation-0001",
    causation_id: null,
    nonce: "revocation-proposal-nonce-0001",
    timestamp: "2026-07-21T22:00:00.000Z",
    expires_at: "2026-07-21T22:05:00.000Z",
    data_classification: "confidential",
    requested_capability: capabilityId,
    budget_ref: null,
    evidence_refs: [],
    authentication_ref: "kindred-authref-companion-revocation-0001",
    delegation_ref: parentGrantId,
    payload: { fixture: "proposal-with-no-execution" },
  };
}

function notice(targetType = "authority_grant", targetId = parentGrantId) {
  return {
    contract_version: REVOCATION_NOTICE_CONTRACT_VERSION,
    revocation_id: "kindred-revocation-fixture-0001",
    target_type: targetType,
    target_id: targetId,
    reason_class: "security_response",
    effective_at: "2026-07-21T22:00:00.000Z",
    authority_component: "brainstem",
    cascade_dependents: true,
    evidence_refs: ["evidence-local-revocation-fixture-0001"],
    provider_contact_requested: false,
    memory_mutation_requested: false,
    tool_execution_requested: false,
    settlement_requested: false,
    external_effects: false,
  };
}

function revocationEnvelope(overrides = {}) {
  const payload = overrides.payload ?? notice();
  return {
    contract_version: MESSAGE_ENVELOPE_CONTRACT_VERSION,
    message_id: "kindred-message-revocation-command-0001",
    message_type: "revocation",
    sender: { principal_type: "runtime_component", id: "brainstem" },
    recipient: { principal_type: "runtime_component", id: "brainstem" },
    authority_ref: null,
    correlation_id: "revocation-correlation-0001",
    causation_id: null,
    nonce: "revocation-command-nonce-0001",
    timestamp: payload.effective_at,
    expires_at: "2026-07-21T22:05:00.000Z",
    data_classification: "restricted",
    requested_capability: null,
    budget_ref: null,
    evidence_refs: payload.evidence_refs,
    authentication_ref: componentAuth,
    delegation_ref: null,
    payload,
    ...overrides,
  };
}

function gateway() {
  const protocol = new AgentProtocolGateway({
    now: () => fixedNow,
    componentAuthenticationRefs: { brainstem: [componentAuth] },
  });
  protocol.registerCapability(capability());
  protocol.registerIdentity(identity());
  protocol.registerAuthorityGrant(grant(parentGrantId));
  protocol.registerAuthorityGrant(grant(childGrantId, parentGrantId));
  return protocol;
}

function assertReason(reasonClass, operation) {
  assert.throws(
    operation,
    (error) =>
      error instanceof AgentProtocolError && error.reasonClass === reasonClass,
  );
}

test("grant revocation cascades, preserves records, and blocks admission", () => {
  const protocol = gateway();
  const receipt = protocol.applyRevocation(revocationEnvelope());
  assert.equal(receipt.contract_version, REVOCATION_RECEIPT_CONTRACT_VERSION);
  assert.equal(receipt.identity_state_changed, false);
  assert.equal(receipt.grants_revoked, 2);
  assert.equal(receipt.history_preserved, true);
  assert.equal(protocol.grants.size, 2);
  assert.equal(protocol.grants.get(parentGrantId).status, "revoked");
  assert.equal(protocol.grants.get(childGrantId).status, "revoked");
  assert.equal(protocol.identities.get(identity().agent_id).lifecycle_state, "active");
  assertReason("authority_grant_inactive", () => protocol.acceptEnvelope(proposal()));
});

test("agent revocation changes only runtime authority state and preserves history", () => {
  const protocol = gateway();
  const payload = {
    ...notice("agent", identity().agent_id),
    revocation_id: "kindred-revocation-agent-fixture-0001",
    reason_class: "owner_request",
  };
  const receipt = protocol.applyRevocation(
    revocationEnvelope({
      message_id: "kindred-message-revocation-agent-0001",
      nonce: "revocation-agent-nonce-0001",
      payload,
    }),
  );
  const revoked = protocol.identities.get(identity().agent_id);
  assert.equal(receipt.identity_state_changed, true);
  assert.equal(receipt.reason_class, "owner_request");
  assert.equal(receipt.grants_revoked, 2);
  assert.equal(revoked.lifecycle_state, "revoked");
  assert.equal(revoked.health, "unavailable");
  assert.equal(revoked.revoked_at, payload.effective_at);
  assert.equal(protocol.identities.size, 1);
  assert.equal(protocol.grants.size, 2);
  assert.equal(receipt.provider_contacted, false);
  assert.equal(receipt.memory_mutated, false);
  assert.equal(receipt.tool_executed, false);
  assert.equal(receipt.settlement_executed, false);
  assertReason("agent_inactive", () => protocol.acceptEnvelope(proposal()));
});

test("revocation fails closed before mutation and requires atomic Brainstem apply", () => {
  const protocol = gateway();
  const command = revocationEnvelope();
  assertReason("revocation_requires_atomic_apply", () =>
    protocol.acceptEnvelope(command),
  );
  assertReason("revocation_route_forbidden", () =>
    protocol.applyRevocation({
      ...command,
      sender: { principal_type: "agent", id: identity().agent_id },
    }),
  );
  assertReason("component_authentication_invalid", () =>
    protocol.applyRevocation({
      ...command,
      authentication_ref: "kindred-authref-brainstem-unbound-0001",
    }),
  );
  assertReason("revocation_notice_invalid", () =>
    protocol.applyRevocation({
      ...command,
      payload: { ...command.payload, provider_contact_requested: true },
    }),
  );
  assertReason("revocation_evidence_invalid", () =>
    protocol.applyRevocation({
      ...command,
      evidence_refs: ["evidence-mismatched-revocation-0001"],
    }),
  );
  assertReason("revocation_target_unknown", () =>
    protocol.applyRevocation(
      revocationEnvelope({
        payload: notice(
          "authority_grant",
          "kindred-grant-revocation-unknown-0001",
        ),
      }),
    ),
  );
  assert.equal(protocol.replayGuard.entries.size, 0);
  assert.equal(protocol.revocations.size, 0);
  assert.equal(protocol.grants.get(parentGrantId).status, "active");
  assert.equal(protocol.applyRevocation(command).status, "applied");
});

test("revocation contracts are exact, replay-safe, and schema synchronized", async () => {
  const root = new URL("../../../", import.meta.url);
  const [noticeSchema, receiptSchema] = await Promise.all(
    [
      "contracts/agent/v1/revocation-notice.schema.json",
      "contracts/agent/v1/revocation-receipt.schema.json",
    ].map(async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"))),
  );
  assert.deepEqual(noticeSchema.required, REVOCATION_NOTICE_FIELDS);
  assert.deepEqual(receiptSchema.required, REVOCATION_RECEIPT_FIELDS);
  assert.equal(
    noticeSchema.properties.contract_version.const,
    REVOCATION_NOTICE_CONTRACT_VERSION,
  );
  assert.equal(
    receiptSchema.properties.contract_version.const,
    REVOCATION_RECEIPT_CONTRACT_VERSION,
  );
  assert.deepEqual(validateRevocationNotice(notice()), notice());
  const protocol = gateway();
  const command = revocationEnvelope();
  const receipt = protocol.applyRevocation(command);
  assert.deepEqual(validateRevocationReceipt(receipt), receipt);
  assertReason("envelope_replay", () => protocol.applyRevocation(command));
  const secondNotice = {
    ...notice(),
    revocation_id: "kindred-revocation-fixture-0002",
  };
  assertReason("revocation_target_terminal", () =>
    protocol.applyRevocation(
      revocationEnvelope({
        message_id: "kindred-message-revocation-command-0002",
        nonce: "revocation-command-nonce-0002",
        payload: secondNotice,
      }),
    ),
  );
  assertReason("revocation_receipt_fields_invalid", () =>
    validateRevocationReceipt({ ...receipt, unexpected: true }),
  );
});
