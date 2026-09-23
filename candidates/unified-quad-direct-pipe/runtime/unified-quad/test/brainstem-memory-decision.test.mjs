import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AgentProtocolGateway,
  createLivingCompanionIdentity,
} from "../src/agent-protocol.mjs";
import { createCompanionMemoryProposalArtifacts } from "../src/companion-memory-proposal.mjs";
import {
  BRAINSTEM_MEMORY_DECISION_CONTRACT_VERSION,
  BRAINSTEM_MEMORY_DECISION_FIELDS,
  decideCompanionMemory,
  validateBrainstemMemoryDecision,
} from "../src/brainstem-memory-decision.mjs";

const fixedNow = Date.parse("2026-07-21T23:30:00.000Z");

function admitted() {
  const identity = createLivingCompanionIdentity({
    companion: {
      contract_version: "kindred.companion.aggregate.v1",
      id: "local-companion-BrainstemMemoryFixture01",
      owner_account_id: "kindred-account-brainstem-memory-0001",
      adopted_at: "2026-07-21T23:00:00.000Z",
      lifecycle_state: "companion_active",
      permissions: { owner_account_only: true, provider_access: false },
      provenance: {
        origin: "local_simulation",
        historical_data_status: "unavailable_not_fabricated",
      },
    },
    accountId: "kindred-account-brainstem-memory-0001",
    tenantId: "kindred-tenant-brainstem-memory-0001",
  });
  const artifacts = createCompanionMemoryProposalArtifacts({
    identity,
    consentReceiptRef: "consent-receipt-BrainstemMemoryFixture1",
    clientRequestId: "memory-request-brainstem-fixture-0001",
    targetNamespaceRef:
      "companion:local-companion-BrainstemMemoryFixture01",
    expectedMemoryVersion: 1,
    memory: {
      category: "relationship",
      content: "The user explicitly named this companion locally.",
      source: { kind: "user_provided", reference: null },
      retention: "user_managed",
      companion_access: true,
    },
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

test("Brainstem alone authorizes the bounded local memory commit", () => {
  const fixture = admitted();
  const decision = decideCompanionMemory({
    envelope: fixture.envelope,
    protocolReceipt: fixture.protocolReceipt,
    identity: fixture.identity,
    now: fixedNow,
  });
  assert.equal(decision.decision, "approved");
  assert.equal(
    decision.reason_class,
    "authoritative_local_memory_commit_allowed",
  );
  assert.equal(decision.commit_policy, "brainstem_authoritative_local_commit");
  assert.equal(decision.memory_commit_authorized, true);
  assert.equal(decision.expected_memory_version, 1);
  assert.equal(decision.mutation, "append_unverified");
  for (const field of [
    "provider_contact_authorized",
    "tool_execution_authorized",
    "settlement_authorized",
    "external_effects_authorized",
  ]) {
    assert.equal(decision[field], false);
  }
  assert.deepEqual(validateBrainstemMemoryDecision(decision), decision);
});

test("Brainstem denies tampered admission, route, authority, and proposal effects", () => {
  const fixture = admitted();
  const decide = (overrides = {}) =>
    decideCompanionMemory({
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
        correlation_id: "memory-request-tampered-receipt-0001",
      },
    }).reason_class,
    "admission_receipt_invalid",
  );
  assert.equal(
    decide({
      envelope: {
        ...fixture.envelope,
        causation_id: "memory-version:999",
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
        payload: { ...fixture.envelope.payload, memory_mutated: true },
      },
    }).reason_class,
    "proposal_contract_invalid",
  );
  assert.equal(
    decide({
      identity: {
        ...fixture.identity,
        memory_scope: { namespace_refs: [], write_mode: "proposal_only" },
      },
    }).reason_class,
    "authority_scope_invalid",
  );
});

test("malformed memory proposal produces a safe denial without echoing content", () => {
  const marker = "sensitive-memory-marker-must-not-echo";
  const decision = decideCompanionMemory({
    envelope: { content: marker },
    protocolReceipt: null,
    identity: null,
    now: fixedNow,
  });
  assert.equal(decision.decision, "denied");
  assert.equal(decision.memory_commit_authorized, false);
  assert.equal(decision.reason_class, "proposal_contract_invalid");
  assert.equal(JSON.stringify(decision).includes(marker), false);
});

test("Brainstem memory decision schema stays exact and fail closed", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../../contracts/brainstem/v1/memory-commit-decision.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(schema.required, BRAINSTEM_MEMORY_DECISION_FIELDS);
  assert.equal(
    schema.properties.contract_version.const,
    BRAINSTEM_MEMORY_DECISION_CONTRACT_VERSION,
  );
  for (const field of [
    "provider_contact_authorized",
    "tool_execution_authorized",
    "settlement_authorized",
    "external_effects_authorized",
  ]) {
    assert.equal(schema.properties[field].const, false);
  }
  const denied = decideCompanionMemory({
    envelope: null,
    protocolReceipt: null,
    identity: null,
    now: fixedNow,
  });
  assert.throws(
    () => validateBrainstemMemoryDecision({ ...denied, extra: true }),
    (error) => error.reasonClass === "memory_decision_invalid",
  );
  assert.throws(
    () =>
      validateBrainstemMemoryDecision({
        ...denied,
        decision: "approved",
        memory_commit_authorized: true,
      }),
    (error) => error.reasonClass === "memory_decision_policy_invalid",
  );
});
