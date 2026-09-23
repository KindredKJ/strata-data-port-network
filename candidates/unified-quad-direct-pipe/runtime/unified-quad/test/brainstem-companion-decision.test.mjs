import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AgentProtocolGateway, createLivingCompanionIdentity } from "../src/agent-protocol.mjs";
import { createCompanionCommunicationArtifacts } from "../src/companion-communication.mjs";
import {
  BRAINSTEM_COMPANION_DECISION_CONTRACT_VERSION,
  BRAINSTEM_COMPANION_DECISION_FIELDS,
  decideCompanionCommunication,
  validateBrainstemCompanionDecision,
} from "../src/brainstem-companion-decision.mjs";

const fixedNow = Date.parse("2026-07-21T20:00:00.000Z");

function admitted() {
  const identity = createLivingCompanionIdentity({
    companion: {
      contract_version: "kindred.companion.aggregate.v1",
      id: "local-companion-BrainstemFixture0001",
      owner_account_id: "kindred-account-brainstem-0001",
      adopted_at: "2026-07-21T19:00:00.000Z",
      lifecycle_state: "companion_active",
      permissions: { owner_account_only: true, provider_access: false },
      provenance: {
        origin: "local_simulation",
        historical_data_status: "unavailable_not_fabricated",
      },
    },
    accountId: "kindred-account-brainstem-0001",
    tenantId: "kindred-tenant-brainstem-0001",
  });
  const artifacts = createCompanionCommunicationArtifacts({
    identity,
    consentReceiptRef: "consent-receipt-BrainstemFixture0001",
    userMessageId: "chat-message-BrainstemFixture0001",
    clientMessageId: "client-message-brainstem-0001",
    content: "Authorize only the fixed local acknowledgement.",
    now: fixedNow,
  });
  const gateway = new AgentProtocolGateway({ now: () => fixedNow });
  gateway.registerCapability(artifacts.capability);
  gateway.registerIdentity(artifacts.identity);
  gateway.registerAuthorityGrant(artifacts.grant);
  return {
    ...artifacts,
    protocolReceipt: gateway.acceptEnvelope(artifacts.envelope),
  };
}

test("Brainstem authorizes only the deterministic local acknowledgement", () => {
  const fixture = admitted();
  const decision = decideCompanionCommunication({
    envelope: fixture.envelope,
    protocolReceipt: fixture.protocolReceipt,
    identity: fixture.identity,
    now: fixedNow,
  });
  assert.equal(decision.decision, "approved");
  assert.equal(decision.reason_class, "local_acknowledgement_allowed");
  assert.equal(
    decision.response_policy,
    "deterministic_local_acknowledgement_only",
  );
  assert.equal(decision.local_response_authorized, true);
  for (const field of [
    "provider_contact_authorized",
    "memory_write_authorized",
    "tool_execution_authorized",
    "settlement_authorized",
    "external_effects_authorized",
  ]) {
    assert.equal(decision[field], false);
  }
  assert.deepEqual(validateBrainstemCompanionDecision(decision), decision);
});

test("Brainstem denies tampered admission, route, authority, and side effects", () => {
  const fixture = admitted();
  const decide = (overrides = {}) =>
    decideCompanionCommunication({
      envelope: fixture.envelope,
      protocolReceipt: fixture.protocolReceipt,
      identity: fixture.identity,
      now: fixedNow,
      ...overrides,
    });
  assert.equal(
    decide({
      protocolReceipt: {
        ...fixture.protocolReceipt,
        correlation_id: "client-message-tampered-0001",
      },
    }).reason_class,
    "admission_receipt_invalid",
  );
  assert.equal(
    decide({
      envelope: {
        ...fixture.envelope,
        recipient: { principal_type: "runtime_component", id: "kindred_cloud" },
      },
    }).reason_class,
    "route_invalid",
  );
  assert.equal(
    decide({
      identity: {
        ...fixture.identity,
        lifecycle_state: "suspended",
        health: "unavailable",
      },
    }).reason_class,
    "principal_inactive",
  );
  assert.equal(
    decide({
      envelope: {
        ...fixture.envelope,
        payload: { ...fixture.envelope.payload, external_effects: true },
      },
    }).reason_class,
    "proposal_contract_invalid",
  );
  assert.equal(
    decide({
      identity: { ...fixture.identity, economic_mandate_ref: "mandate-forbidden-0001" },
    }).reason_class,
    "authority_scope_invalid",
  );
  assert.equal(
    decide({
      identity: {
        ...fixture.identity,
        permissions: ["companion.memory.propose"],
      },
    }).reason_class,
    "authority_scope_invalid",
  );
});

test("malformed input produces a safe typed denial without echoing content", () => {
  const secretMarker = "sensitive-marker-must-not-echo";
  const decision = decideCompanionCommunication({
    envelope: { content: secretMarker },
    protocolReceipt: null,
    identity: null,
    now: fixedNow,
  });
  assert.equal(decision.decision, "denied");
  assert.equal(decision.local_response_authorized, false);
  assert.equal(decision.response_policy, null);
  assert.equal(JSON.stringify(decision).includes(secretMarker), false);
  assert.equal(decision.reason_class, "proposal_contract_invalid");
});

test("Brainstem decision schema stays exact and fail closed", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../../contracts/brainstem/v1/companion-communication-decision.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(schema.required, BRAINSTEM_COMPANION_DECISION_FIELDS);
  assert.equal(
    schema.properties.contract_version.const,
    BRAINSTEM_COMPANION_DECISION_CONTRACT_VERSION,
  );
  for (const field of [
    "provider_contact_authorized",
    "memory_write_authorized",
    "tool_execution_authorized",
    "settlement_authorized",
    "external_effects_authorized",
  ]) {
    assert.equal(schema.properties[field].const, false);
  }
  const decision = decideCompanionCommunication({
    envelope: null,
    protocolReceipt: null,
    identity: null,
    now: fixedNow,
  });
  assert.throws(
    () => validateBrainstemCompanionDecision({ ...decision, extra: true }),
    (error) => error.reasonClass === "decision_invalid",
  );
  assert.throws(
    () =>
      validateBrainstemCompanionDecision({
        ...decision,
        decision: "approved",
        local_response_authorized: true,
      }),
    (error) => error.reasonClass === "decision_policy_invalid",
  );
});
