import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AgentProtocolGateway,
  createLivingCompanionIdentity,
} from "../src/agent-protocol.mjs";
import {
  COMPANION_MEMORY_PROPOSAL_CAPABILITY_ID,
  COMPANION_MEMORY_PROPOSAL_CONTRACT_VERSION,
  COMPANION_MEMORY_PROPOSAL_FIELDS,
  createCompanionMemoryProposalArtifacts,
  validateCompanionMemoryProposal,
} from "../src/companion-memory-proposal.mjs";

const fixedNow = Date.parse("2026-07-21T23:15:00.000Z");

function identity() {
  return createLivingCompanionIdentity({
    companion: {
      contract_version: "kindred.companion.aggregate.v1",
      id: "local-companion-MemoryProposalFixture0001",
      owner_account_id: "kindred-account-memory-proposal-0001",
      adopted_at: "2026-07-21T23:00:00.000Z",
      lifecycle_state: "companion_active",
      permissions: { owner_account_only: true, provider_access: false },
      provenance: {
        origin: "local_simulation",
        historical_data_status: "unavailable_not_fabricated",
      },
    },
    accountId: "kindred-account-memory-proposal-0001",
    tenantId: "kindred-tenant-memory-proposal-0001",
  });
}

function input(overrides = {}) {
  return {
    identity: identity(),
    consentReceiptRef: "consent-receipt-MemoryProposalFixture01",
    clientRequestId: "memory-request-proposal-fixture-0001",
    targetNamespaceRef:
      "companion:local-companion-MemoryProposalFixture0001",
    expectedMemoryVersion: 1,
    memory: {
      category: "preference",
      content: "The user explicitly prefers local-only memory.",
      source: { kind: "user_provided", reference: null },
      retention: "user_managed",
      companion_access: true,
    },
    now: fixedNow,
    ...overrides,
  };
}

test("memory artifacts grant one proposal and cannot commit state", () => {
  const artifacts = createCompanionMemoryProposalArtifacts(input());
  assert.equal(
    artifacts.envelope.payload.contract_version,
    COMPANION_MEMORY_PROPOSAL_CONTRACT_VERSION,
  );
  assert.equal(
    artifacts.capability.capability_id,
    COMPANION_MEMORY_PROPOSAL_CAPABILITY_ID,
  );
  assert.equal(artifacts.capability.action_type, "memory_proposal");
  assert.equal(artifacts.capability.execution_mode, "proposal_only");
  assert.equal(artifacts.capability.memory_commit, "brainstem_only");
  assert.deepEqual(artifacts.grant.message_types, ["proposal"]);
  assert.deepEqual(artifacts.grant.permissions, ["companion.memory.propose"]);
  assert.equal(artifacts.envelope.recipient.id, "brainstem");
  assert.equal(artifacts.envelope.payload.memory_mutated, false);
  assert.equal(artifacts.envelope.payload.provider_contact_requested, false);
  assert.equal(artifacts.envelope.payload.tool_execution_requested, false);
  assert.equal(artifacts.envelope.payload.settlement_requested, false);
  assert.equal(artifacts.envelope.payload.external_effects, false);

  const gateway = new AgentProtocolGateway({ now: () => fixedNow });
  gateway.registerCapability(artifacts.capability);
  gateway.registerIdentity(artifacts.identity);
  gateway.registerAuthorityGrant(artifacts.grant);
  assert.equal(gateway.acceptEnvelope(artifacts.envelope).status, "accepted");
  assert.throws(
    () => gateway.acceptEnvelope(artifacts.envelope),
    (error) => error.reasonClass === "envelope_replay",
  );
  const changedContent = createCompanionMemoryProposalArtifacts(
    input({
      memory: {
        ...input().memory,
        content: "A distinct content proposal must have distinct evidence.",
      },
    }),
  );
  assert.notEqual(changedContent.envelope.message_id, artifacts.envelope.message_id);
  assert.notEqual(changedContent.envelope.nonce, artifacts.envelope.nonce);
});

test("memory proposal rejects fabricated, escalated, and cross-scope input", () => {
  const proposal = createCompanionMemoryProposalArtifacts(input()).envelope.payload;
  for (const invalid of [
    { ...proposal, source_kind: "imported_record" },
    { ...proposal, verification: "verified" },
    { ...proposal, memory_mutated: true },
    { ...proposal, provider_contact_requested: true },
    { ...proposal, tool_execution_requested: true },
    { ...proposal, settlement_requested: true },
    { ...proposal, external_effects: true },
  ]) {
    assert.throws(
      () => validateCompanionMemoryProposal(invalid),
      (error) => error.reasonClass === "memory_proposal_invalid",
    );
  }
  assert.throws(
    () =>
      validateCompanionMemoryProposal({
        ...proposal,
        target_namespace_ref:
          "companion:local-companion-AnotherMemoryFixture0001",
      }),
    (error) => error.reasonClass === "memory_proposal_target_invalid",
  );
  assert.throws(
    () => validateCompanionMemoryProposal({ ...proposal, direct_commit: true }),
    (error) => error.reasonClass === "memory_proposal_fields_invalid",
  );
  assert.throws(
    () =>
      createCompanionMemoryProposalArtifacts(
        input({
          targetNamespaceRef:
            "companion:local-companion-AnotherMemoryFixture0001",
        }),
      ),
    (error) => error.reasonClass === "companion_memory_scope_invalid",
  );
});

test("memory proposal schema stays exact and confidential", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../../contracts/agent/v1/companion-memory-proposal.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(schema.required, COMPANION_MEMORY_PROPOSAL_FIELDS);
  assert.equal(
    schema.properties.contract_version.const,
    COMPANION_MEMORY_PROPOSAL_CONTRACT_VERSION,
  );
  assert.equal(schema.properties.memory_mutated.const, false);
  assert.equal(schema.properties.external_effects.const, false);
  assert.equal(schema["x-kindred-data-classification"], "confidential");
});
