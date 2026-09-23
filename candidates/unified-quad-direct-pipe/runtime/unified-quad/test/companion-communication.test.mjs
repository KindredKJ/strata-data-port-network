import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AgentProtocolGateway,
  createLivingCompanionIdentity,
} from "../src/agent-protocol.mjs";
import {
  COMPANION_COMMUNICATION_CAPABILITY_ID,
  COMPANION_COMMUNICATION_PROPOSAL_CONTRACT_VERSION,
  COMPANION_COMMUNICATION_PROPOSAL_FIELDS,
  createCompanionCommunicationArtifacts,
  validateCompanionCommunicationProposal,
} from "../src/companion-communication.mjs";

const fixedNow = Date.parse("2026-07-21T19:00:00.000Z");

function identity() {
  return createLivingCompanionIdentity({
    companion: {
      contract_version: "kindred.companion.aggregate.v1",
      id: "local-companion-CommunicationFixture0001",
      owner_account_id: "kindred-account-communication-0001",
      adopted_at: "2026-07-21T18:00:00.000Z",
      lifecycle_state: "companion_active",
      permissions: { owner_account_only: true, provider_access: false },
      provenance: {
        origin: "local_simulation",
        historical_data_status: "unavailable_not_fabricated",
      },
    },
    accountId: "kindred-account-communication-0001",
    tenantId: "kindred-tenant-communication-0001",
    capabilities: [],
    grantRefs: [],
    budgetRefs: [],
    economicMandateRef: null,
  });
}

function input(overrides = {}) {
  return {
    identity: identity(),
    consentReceiptRef: "consent-receipt-CommunicationFixture01",
    userMessageId: "chat-message-CommunicationFixture01",
    clientMessageId: "client-message-communication-0001",
    content: "Please acknowledge this local companion message.",
    now: fixedNow,
    ...overrides,
  };
}

test("communication artifacts grant one proposal and no execution authority", () => {
  const artifacts = createCompanionCommunicationArtifacts(input());
  assert.equal(
    artifacts.envelope.payload.contract_version,
    COMPANION_COMMUNICATION_PROPOSAL_CONTRACT_VERSION,
  );
  assert.equal(
    artifacts.capability.capability_id,
    COMPANION_COMMUNICATION_CAPABILITY_ID,
  );
  assert.equal(artifacts.capability.execution_mode, "proposal_only");
  assert.equal(artifacts.capability.provider_contact, "mediated_only");
  assert.equal(artifacts.capability.memory_commit, "brainstem_only");
  assert.equal(artifacts.capability.settlement, "retrobank_mandate_only");
  assert.deepEqual(artifacts.grant.message_types, ["proposal"]);
  assert.deepEqual(artifacts.grant.budget_refs, []);
  assert.equal(artifacts.grant.authority_level, "user_delegated");
  assert.equal(artifacts.envelope.recipient.id, "brainstem");
  assert.equal(artifacts.envelope.data_classification, "confidential");
  assert.equal(artifacts.envelope.payload.external_effects, false);
  assert.equal(
    Date.parse(artifacts.grant.expires_at) - Date.parse(artifacts.grant.issued_at),
    120_000,
  );

  const gateway = new AgentProtocolGateway({ now: () => fixedNow });
  gateway.registerCapability(artifacts.capability);
  gateway.registerIdentity(artifacts.identity);
  gateway.registerAuthorityGrant(artifacts.grant);
  assert.equal(gateway.acceptEnvelope(artifacts.envelope).status, "accepted");
  assert.throws(
    () => gateway.acceptEnvelope(artifacts.envelope),
    (error) => error.reasonClass === "envelope_replay",
  );
});

test("communication proposal rejects added authority and malformed consent", () => {
  const proposal = createCompanionCommunicationArtifacts(input()).envelope.payload;
  for (const invalid of [
    { ...proposal, external_effects: true },
    { ...proposal, provider_contact_requested: true },
    { ...proposal, memory_write_requested: true },
    { ...proposal, tool_execution_requested: true },
    { ...proposal, settlement_requested: true },
    { ...proposal, consent_receipt_ref: "not-a-consent-receipt" },
  ]) {
    assert.throws(
      () => validateCompanionCommunicationProposal(invalid),
      (error) => error.reasonClass === "proposal_invalid",
    );
  }
  assert.throws(
    () =>
      validateCompanionCommunicationProposal({
        ...proposal,
        unexpected_authority: true,
      }),
    (error) => error.reasonClass === "proposal_fields_invalid",
  );
  const alreadyScoped = identity();
  alreadyScoped.capabilities = [COMPANION_COMMUNICATION_CAPABILITY_ID];
  assert.throws(
    () => createCompanionCommunicationArtifacts(input({ identity: alreadyScoped })),
    (error) => error.reasonClass === "companion_scope_not_empty",
  );
});

test("communication proposal schema stays exact and confidential", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../../contracts/agent/v1/companion-communication-proposal.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(schema.required, COMPANION_COMMUNICATION_PROPOSAL_FIELDS);
  assert.equal(
    schema.properties.contract_version.const,
    COMPANION_COMMUNICATION_PROPOSAL_CONTRACT_VERSION,
  );
  assert.equal(schema.properties.external_effects.const, false);
  assert.equal(schema["x-kindred-data-classification"], "confidential");
  const proposal = createCompanionCommunicationArtifacts(input()).envelope.payload;
  assert.deepEqual(
    validateCompanionCommunicationProposal(
      Object.fromEntries(Object.entries(proposal).reverse()),
    ),
    proposal,
  );
});
