import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AGENT_IDENTITY_CONTRACT_VERSION,
  AUTHORITY_GRANT_CONTRACT_VERSION,
  AUTHORITY_GRANT_FIELDS,
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_FIELDS,
  ENVELOPE_FIELDS,
  IDENTITY_FIELDS,
  MESSAGE_ENVELOPE_CONTRACT_VERSION,
  MESSAGE_TYPES,
  PROTOCOL_RECEIPT_FIELDS,
  PROTOCOL_RECEIPT_CONTRACT_VERSION,
  RUNTIME_COMPONENTS,
  AgentProtocolError,
  AgentProtocolGateway,
  ReplayGuard,
  createLivingCompanionIdentity,
  validateAgentIdentity,
  validateAuthorityGrant,
  validateCapability,
  validateEnvelope,
  validateProtocolReceipt,
} from "../src/agent-protocol.mjs";

const fixedNow = Date.parse("2026-07-21T16:00:00.000Z");
const capabilityId = "kindred.capability.companion.communicate.v1";
const grantId = "kindred-grant-companion-0001";
const componentAuth = "kindred-authref-brainstem-0001";

function companion() {
  return {
    contract_version: "kindred.companion.aggregate.v1",
    id: "local-companion-AbCdEfGhIjKlMnOpQrSt",
    owner_account_id: "kindred-account-owner-0001",
    adopted_at: "2026-07-21T15:00:00.000Z",
    lifecycle_state: "companion_active",
    permissions: { owner_account_only: true, provider_access: false },
    provenance: {
      origin: "local_simulation",
      historical_data_status: "unavailable_not_fabricated",
    },
  };
}

function communicationCapability(overrides = {}) {
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
    input_contract_ref: "contracts/companion/v1/chat.schema.json",
    output_contract_ref: "contracts/companion/v1/chat.schema.json",
    ...overrides,
  };
}

function toolCapability() {
  return communicationCapability({
    capability_id: "kindred.capability.cloud.local-tool.v1",
    owner_component: "kindred_cloud",
    action_type: "tool",
    allowed_agent_classes: ["worker", "service"],
    required_authority: "governance_delegated",
    data_classifications: ["internal"],
    execution_mode: "governed_local_reversible",
    compensation_required: true,
    input_contract_ref: "contracts/agent/v1/message-envelope.schema.json",
    output_contract_ref: "contracts/agent/v1/protocol-receipt.schema.json",
  });
}

function settlementCapability() {
  return communicationCapability({
    capability_id: "kindred.capability.retrobank.internal-settlement.v1",
    owner_component: "retrobank",
    action_type: "settlement",
    allowed_agent_classes: ["worker", "service"],
    required_authority: "governance_delegated",
    risk_ceiling: "high",
    data_classifications: ["restricted"],
    execution_mode: "governed_local_reversible",
    compensation_required: true,
    input_contract_ref: "contracts/agent/v1/message-envelope.schema.json",
    output_contract_ref: "contracts/agent/v1/protocol-receipt.schema.json",
  });
}

function identity(overrides = {}) {
  const base = createLivingCompanionIdentity({
    companion: companion(),
    accountId: "kindred-account-owner-0001",
    tenantId: "kindred-tenant-local-0001",
    capabilities: [capabilityId],
    grantRefs: [grantId],
  });
  return { ...base, ...overrides };
}

function grant(overrides = {}) {
  return {
    contract_version: AUTHORITY_GRANT_CONTRACT_VERSION,
    grant_id: grantId,
    subject_agent_id: identity().agent_id,
    issuer_component: "brainstem",
    issuer_id: "kindred-component-brainstem",
    authentication_ref: "kindred-authref-companion-0001",
    authority_level: "user_delegated",
    capability_ids: [capabilityId],
    message_types: ["proposal", "request", "response"],
    permissions: ["companion.communicate"],
    budget_refs: [],
    parent_grant_ref: null,
    issued_at: "2026-07-21T15:30:00.000Z",
    expires_at: "2026-07-21T17:00:00.000Z",
    status: "active",
    revoked_at: null,
    ...overrides,
  };
}

function envelope(overrides = {}) {
  return {
    contract_version: MESSAGE_ENVELOPE_CONTRACT_VERSION,
    message_id: "kindred-message-proposal-0001",
    message_type: "proposal",
    sender: { principal_type: "agent", id: identity().agent_id },
    recipient: { principal_type: "runtime_component", id: "brainstem" },
    authority_ref: grantId,
    correlation_id: "correlation-0001",
    causation_id: null,
    nonce: "nonce-000000000001",
    timestamp: "2026-07-21T16:00:00.000Z",
    expires_at: "2026-07-21T16:05:00.000Z",
    data_classification: "confidential",
    requested_capability: capabilityId,
    budget_ref: null,
    evidence_refs: [],
    authentication_ref: "kindred-authref-companion-0001",
    delegation_ref: null,
    payload: { message: "Hello through the governed proposal boundary." },
    ...overrides,
  };
}

function gateway(options = {}) {
  const protocol = new AgentProtocolGateway({ now: () => fixedNow, ...options });
  protocol.registerCapability(communicationCapability());
  protocol.registerIdentity(identity());
  protocol.registerAuthorityGrant(grant());
  return protocol;
}

function assertReason(reasonClass, operation) {
  assert.throws(
    operation,
    (error) =>
      error instanceof AgentProtocolError && error.reasonClass === reasonClass,
  );
}

test("manifest declares one runtime with exactly four components and adjacent chain", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../runtime-manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.single_runtime, true);
  assert.equal(manifest.runtime_id, "kindred.runtime.unified-quad.v1");
  assert.deepEqual(
    manifest.components.map((component) => component.component_id),
    RUNTIME_COMPONENTS,
  );
  assert.deepEqual(manifest.adjacent_systems, [
    {
      system_id: "kindred_chain",
      name: "Kindred Chain",
      relationship: "adjacent_not_runtime_component",
    },
  ]);
  assert.equal(
    manifest.invariants.includes("companion_never_inherits_founder_authority"),
    true,
  );
});

test("living companion identity is stable, owner-bound, and proposal-only", () => {
  const first = identity();
  const second = identity();
  assert.deepEqual(first, second);
  assert.equal(first.contract_version, AGENT_IDENTITY_CONTRACT_VERSION);
  assert.equal(first.agent_class, "living_companion");
  assert.equal(first.owner_id, companion().owner_account_id);
  assert.equal(first.authority.ceiling, "user_delegated");
  assert.equal(first.memory_scope.write_mode, "proposal_only");
  assert.equal(first.execution_scope.mode, "proposal_only");
  assert.equal(first.provider_scope.mode, "mediated_only");
  assert.equal(first.prohibited_capabilities.includes("founder_authority"), true);
});

test("gateway accepts an authorized proposal once and consumes its nonce", () => {
  const protocol = gateway();
  const accepted = protocol.acceptEnvelope(envelope());
  assert.equal(accepted.contract_version, PROTOCOL_RECEIPT_CONTRACT_VERSION);
  assert.deepEqual(validateProtocolReceipt(accepted), accepted);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.replay_consumed, true);
  assertReason("envelope_replay", () => protocol.acceptEnvelope(envelope()));
});

test("agent authentication and delegation references are grant-bound", () => {
  const protocol = gateway();
  assertReason("authentication_reference_mismatch", () =>
    protocol.acceptEnvelope(
      envelope({ authentication_ref: "kindred-authref-unbound-0001" }),
    ),
  );
  assertReason("delegation_reference_mismatch", () =>
    protocol.acceptEnvelope(
      envelope({
        nonce: "nonce-000000000009",
        delegation_ref: "kindred-grant-unbound-0001",
      }),
    ),
  );

  const parentGrantId = "kindred-grant-parent-0001";
  const delegatedIdentity = identity();
  delegatedIdentity.authority.grant_refs = [parentGrantId, grantId];
  const expiredParent = new AgentProtocolGateway({ now: () => fixedNow });
  expiredParent.registerCapability(communicationCapability());
  expiredParent.registerIdentity(delegatedIdentity);
  expiredParent.registerAuthorityGrant(
    grant({
      grant_id: parentGrantId,
      expires_at: "2026-07-21T15:59:00.000Z",
    }),
  );
  expiredParent.registerAuthorityGrant(
    grant({ parent_grant_ref: parentGrantId }),
  );
  assertReason("parent_grant_inactive", () =>
    expiredParent.acceptEnvelope(
      envelope({
        nonce: "nonce-000000000010",
        delegation_ref: parentGrantId,
      }),
    ),
  );
});

test("gateway rejects authority escalation, inactive grants, and inactive agents", () => {
  const escalation = new AgentProtocolGateway({ now: () => fixedNow });
  escalation.registerCapability(communicationCapability());
  escalation.registerIdentity(identity());
  assertReason("authority_escalation_forbidden", () =>
    escalation.registerAuthorityGrant(
      grant({ authority_level: "founder_delegated" }),
    ),
  );

  const suspendedGrant = new AgentProtocolGateway({ now: () => fixedNow });
  suspendedGrant.registerCapability(communicationCapability());
  suspendedGrant.registerIdentity(identity());
  suspendedGrant.registerAuthorityGrant(grant({ status: "suspended" }));
  assertReason("authority_grant_inactive", () =>
    suspendedGrant.acceptEnvelope(envelope()),
  );

  const suspendedAgent = new AgentProtocolGateway({ now: () => fixedNow });
  suspendedAgent.registerCapability(communicationCapability());
  suspendedAgent.registerIdentity(identity({ lifecycle_state: "suspended" }));
  suspendedAgent.registerAuthorityGrant(grant());
  assertReason("agent_inactive", () => suspendedAgent.acceptEnvelope(envelope()));
});

test("companion founder authority and direct agent execution fail closed", () => {
  const elevated = identity();
  elevated.authority.ceiling = "founder_delegated";
  assertReason("companion_authority_boundary_violation", () =>
    validateAgentIdentity(elevated),
  );
  const protocol = gateway();
  assertReason("direct_agent_execution_forbidden", () =>
    protocol.acceptEnvelope(envelope({ message_type: "execution_request" })),
  );
  assertReason("direct_agent_execution_forbidden", () =>
    protocol.acceptEnvelope(
      envelope({
        message_id: "kindred-message-settlement-0001",
        message_type: "settlement_request",
        nonce: "nonce-000000000002",
        recipient: { principal_type: "runtime_component", id: "retrobank" },
        budget_ref: "budget-local-0001",
      }),
    ),
  );
  assertReason("principal_invalid", () =>
    protocol.acceptEnvelope(
      envelope({
        nonce: "nonce-000000000011",
        sender: { principal_type: "model", id: "provider-model" },
      }),
    ),
  );
});

test("secret-bearing, expired, oversized, and future envelopes fail closed", () => {
  const protocol = gateway();
  assertReason("sensitive_payload_forbidden", () =>
    protocol.acceptEnvelope(
      envelope({ payload: { access_token: "never-accepted" } }),
    ),
  );
  assertReason("envelope_expired", () =>
    protocol.acceptEnvelope(
      envelope({
        timestamp: "2026-07-21T15:40:00.000Z",
        expires_at: "2026-07-21T15:45:00.000Z",
      }),
    ),
  );
  assertReason("payload_capacity_exceeded", () =>
    protocol.acceptEnvelope(
      envelope({ payload: { data: Array(9).fill("x".repeat(4096)) } }),
    ),
  );
  assertReason("envelope_from_future", () =>
    protocol.acceptEnvelope(
      envelope({
        timestamp: "2026-07-21T16:06:00.000Z",
        expires_at: "2026-07-21T16:10:00.000Z",
      }),
    ),
  );
});

test("component execution and settlement routes require authenticated Brainstem", () => {
  const protocol = new AgentProtocolGateway({
    now: () => fixedNow,
    componentAuthenticationRefs: { brainstem: [componentAuth] },
  });
  protocol.registerCapability(communicationCapability());
  protocol.registerCapability(toolCapability());
  protocol.registerCapability(settlementCapability());
  const execution = envelope({
    message_id: "kindred-message-execution-0001",
    message_type: "execution_request",
    sender: { principal_type: "runtime_component", id: "brainstem" },
    recipient: { principal_type: "runtime_component", id: "kindred_cloud" },
    authentication_ref: componentAuth,
    requested_capability: toolCapability().capability_id,
    data_classification: "internal",
    nonce: "nonce-000000000003",
  });
  assert.equal(protocol.acceptEnvelope(execution).status, "accepted");

  const settlement = envelope({
    message_id: "kindred-message-settlement-0002",
    message_type: "settlement_request",
    sender: { principal_type: "runtime_component", id: "brainstem" },
    recipient: { principal_type: "runtime_component", id: "retrobank" },
    authentication_ref: componentAuth,
    requested_capability: settlementCapability().capability_id,
    data_classification: "restricted",
    budget_ref: "budget-local-0001",
    nonce: "nonce-000000000004",
  });
  assert.equal(protocol.acceptEnvelope(settlement).status, "accepted");
  assertReason("component_authentication_invalid", () =>
    protocol.acceptEnvelope({
      ...execution,
      message_id: "kindred-message-execution-0002",
      nonce: "nonce-000000000005",
      sender: { principal_type: "runtime_component", id: "emit_core" },
    }),
  );
  assertReason("execution_route_forbidden", () =>
    protocol.acceptEnvelope({
      ...execution,
      message_id: "kindred-message-execution-0003",
      nonce: "nonce-000000000012",
      requested_capability: capabilityId,
      data_classification: "confidential",
    }),
  );
});

test("replay guard is bounded and frees expired nonce tombstones", () => {
  let now = fixedNow;
  const guard = new ReplayGuard({ now: () => now, maxEntries: 1 });
  guard.consume("agent:a", "nonce-000000000006", now + 1_000);
  assertReason("replay_capacity_reached", () =>
    guard.consume("agent:b", "nonce-000000000007", now + 2_000),
  );
  now += 1_001;
  guard.consume("agent:b", "nonce-000000000007", now + 2_000);
  assert.equal(guard.entries.size, 1);
});

test("runtime validators and JSON schemas keep exact fields and enums synchronized", async () => {
  const root = new URL("../../../", import.meta.url);
  const [
    identitySchema,
    capabilitySchema,
    grantSchema,
    envelopeSchema,
    receiptSchema,
    manifestSchema,
  ] =
    await Promise.all(
      [
        "contracts/agent/v1/identity.schema.json",
        "contracts/agent/v1/capability.schema.json",
        "contracts/agent/v1/authority-grant.schema.json",
        "contracts/agent/v1/message-envelope.schema.json",
        "contracts/agent/v1/protocol-receipt.schema.json",
        "contracts/runtime/v1/unified-quad-manifest.schema.json",
      ].map(async (path) =>
        JSON.parse(await readFile(new URL(path, root), "utf8")),
      ),
    );
  assert.deepEqual(identitySchema.required, IDENTITY_FIELDS);
  assert.deepEqual(capabilitySchema.required, CAPABILITY_FIELDS);
  assert.deepEqual(grantSchema.required, AUTHORITY_GRANT_FIELDS);
  assert.deepEqual(envelopeSchema.required, ENVELOPE_FIELDS);
  assert.deepEqual(receiptSchema.required, PROTOCOL_RECEIPT_FIELDS);
  assert.deepEqual(envelopeSchema.$defs.message_type.enum, MESSAGE_TYPES);
  assert.deepEqual(
    manifestSchema.properties.components.items.properties.component_id.enum,
    RUNTIME_COMPONENTS,
  );
  assert.deepEqual(
    Object.keys(
      JSON.parse(
        await readFile(new URL("../runtime-manifest.json", import.meta.url), "utf8"),
      ),
    ),
    manifestSchema.required,
  );
  validateAgentIdentity(identity());
  validateCapability(communicationCapability());
  validateAuthorityGrant(grant());
  validateEnvelope(envelope());
  validateProtocolReceipt({
    contract_version: PROTOCOL_RECEIPT_CONTRACT_VERSION,
    message_id: "kindred-message-receipt-0001",
    correlation_id: "correlation-0001",
    status: "accepted",
    accepted_at: "2026-07-21T16:00:00.000Z",
    replay_consumed: true,
  });
  for (const invalid of [
    { ...identity(), unexpected: true },
    { ...communicationCapability(), unexpected: true },
    { ...grant(), unexpected: true },
    { ...envelope(), unexpected: true },
  ]) {
    assert.throws(() => {
      if ("agent_id" in invalid) validateAgentIdentity(invalid);
      else if ("capability_id" in invalid) validateCapability(invalid);
      else if ("grant_id" in invalid) validateAuthorityGrant(invalid);
      else validateEnvelope(invalid);
    }, AgentProtocolError);
  }
});
