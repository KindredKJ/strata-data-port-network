import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CAPABILITY_CONTRACT_VERSION,
  AgentProtocolError,
  AgentProtocolGateway,
  ReplayGuard,
  createLivingCompanionIdentity,
} from "../src/agent-protocol.mjs";
import {
  CAPABILITY_DISCOVERY_PROJECTION_FIELDS,
  CAPABILITY_DISCOVERY_QUERY_CONTRACT_VERSION,
  CAPABILITY_DISCOVERY_QUERY_FIELDS,
  CAPABILITY_DISCOVERY_RESULT_CONTRACT_VERSION,
  CAPABILITY_DISCOVERY_RESULT_FIELDS,
  CapabilityDiscoveryCatalog,
  CapabilityDiscoveryError,
  createCapabilityDiscoveryArtifacts,
  executeCapabilityDiscovery,
  validateCapabilityDiscoveryQuery,
  validateCapabilityDiscoveryResult,
} from "../src/capability-discovery.mjs";

const fixedNow = Date.parse("2026-07-21T21:00:00.000Z");

function identity() {
  return createLivingCompanionIdentity({
    companion: {
      contract_version: "kindred.companion.aggregate.v1",
      id: "local-companion-DiscoveryFixture0001",
      owner_account_id: "kindred-account-discovery-0001",
      adopted_at: "2026-07-21T20:00:00.000Z",
      lifecycle_state: "companion_active",
      permissions: { owner_account_only: true, provider_access: false },
      provenance: {
        origin: "local_simulation",
        historical_data_status: "unavailable_not_fabricated",
      },
    },
    accountId: "kindred-account-discovery-0001",
    tenantId: "kindred-tenant-discovery-0001",
  });
}

function capability(id, overrides = {}) {
  return {
    contract_version: CAPABILITY_CONTRACT_VERSION,
    capability_id: id,
    version: "1.0.0",
    owner_component: "emit_core",
    action_type: "communication",
    allowed_agent_classes: ["living_companion"],
    required_authority: "user_delegated",
    risk_ceiling: "low",
    data_classifications: ["internal"],
    execution_mode: "proposal_only",
    provider_contact: "mediated_only",
    memory_commit: "brainstem_only",
    settlement: "retrobank_mandate_only",
    compensation_required: false,
    input_contract_ref: "contracts/agent/v1/capability-discovery-query.schema.json",
    output_contract_ref: "contracts/agent/v1/capability-discovery-result.schema.json",
    ...overrides,
  };
}

function admitted(overrides = {}) {
  const artifacts = createCapabilityDiscoveryArtifacts({
    identity: identity(),
    correlationId: "discovery-correlation-0001",
    actionTypes: ["communication"],
    dataClassification: "internal",
    riskCeiling: "low",
    resultLimit: 16,
    now: fixedNow,
    ...overrides,
  });
  const gateway = new AgentProtocolGateway({ now: () => fixedNow });
  gateway.registerIdentity(artifacts.identity);
  gateway.registerAuthorityGrant(artifacts.grant);
  const protocolReceipt = gateway.acceptEnvelope(artifacts.envelope);
  return { ...artifacts, gateway, protocolReceipt };
}

test("discovery is grant-bound, replay-safe, and grants no capability", () => {
  const fixture = admitted();
  assert.deepEqual(fixture.grant.capability_ids, []);
  assert.deepEqual(fixture.grant.message_types, ["discovery"]);
  assert.deepEqual(fixture.grant.permissions, ["capability.discover"]);
  assert.deepEqual(fixture.identity.capabilities, []);
  assert.equal(fixture.envelope.requested_capability, null);
  assert.equal(fixture.envelope.budget_ref, null);
  assert.throws(
    () => fixture.gateway.acceptEnvelope(fixture.envelope),
    (error) =>
      error instanceof AgentProtocolError && error.reasonClass === "envelope_replay",
  );
});

test("catalog returns deterministic allowed metadata without authority", () => {
  const fixture = admitted();
  const catalog = new CapabilityDiscoveryCatalog({ now: () => fixedNow });
  catalog.registerCapability(
    capability("kindred.capability.companion.discovery-chat.v1"),
  );
  catalog.registerCapability(
    capability("kindred.capability.cloud.discovery-tool.v1", {
      owner_component: "kindred_cloud",
      action_type: "tool",
      allowed_agent_classes: ["worker"],
      required_authority: "governance_delegated",
      risk_ceiling: "high",
      execution_mode: "governed_local_reversible",
    }),
  );
  catalog.registerCapability(
    capability("kindred.capability.companion.discovery-offline.v1"),
    { available: false },
  );
  const result = catalog.discover({
    envelope: fixture.envelope,
    protocolReceipt: fixture.protocolReceipt,
    identity: fixture.identity,
    now: fixedNow,
  });
  assert.equal(result.result_count, 1);
  assert.equal(
    result.capabilities[0].capability_id,
    "kindred.capability.companion.discovery-chat.v1",
  );
  assert.equal(result.authority_granted, false);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.provider_contact_authorized, false);
  assert.equal(result.memory_write_authorized, false);
  assert.equal(result.settlement_authorized, false);
  assert.equal(result.external_effects_authorized, false);
  assert.equal("authentication_ref" in result.capabilities[0], false);
  assert.equal("grant_id" in result.capabilities[0], false);
});

test("canonical discovery execution retains replay only, not temporary authority", () => {
  const replayGuard = new ReplayGuard({ now: () => fixedNow });
  const catalog = new CapabilityDiscoveryCatalog({ now: () => fixedNow });
  catalog.registerCapability(
    capability("kindred.capability.companion.discovery-chat.v1"),
  );
  const input = {
    identity: identity(),
    correlationId: "discovery-correlation-canonical-0001",
    actionTypes: ["communication"],
    dataClassification: "internal",
    riskCeiling: "low",
    resultLimit: 16,
    now: fixedNow,
    replayGuard,
    catalog,
  };
  const outcome = executeCapabilityDiscovery(input);
  assert.equal(outcome.admission_receipt.status, "accepted");
  assert.equal(outcome.result.result_count, 1);
  assert.equal(replayGuard.entries.size, 1);
  assert.deepEqual(Object.keys(outcome).sort(), ["admission_receipt", "result"]);
  assert.equal("grant" in outcome, false);
  assert.equal("identity" in outcome, false);
  assert.throws(
    () => executeCapabilityDiscovery(input),
    (error) =>
      error instanceof AgentProtocolError && error.reasonClass === "envelope_replay",
  );
});

test("canonical discovery requires its bounded dependencies and authority ceiling", () => {
  const catalog = new CapabilityDiscoveryCatalog({ now: () => fixedNow });
  const replayGuard = new ReplayGuard({ now: () => fixedNow });
  const input = {
    identity: identity(),
    correlationId: "discovery-correlation-dependencies-0001",
    now: fixedNow,
  };
  assert.throws(
    () => executeCapabilityDiscovery({ ...input, catalog }),
    (error) => error.reasonClass === "discovery_replay_guard_required",
  );
  assert.throws(
    () => executeCapabilityDiscovery({ ...input, replayGuard }),
    (error) => error.reasonClass === "discovery_catalog_required",
  );
  assert.throws(
    () =>
      createCapabilityDiscoveryArtifacts({
        ...input,
        identity: {
          ...input.identity,
          authority: { ...input.identity.authority, ceiling: "none" },
        },
      }),
    (error) => error.reasonClass === "discovery_authority_ceiling_invalid",
  );
});

test("catalog bounds capacity, results, conflicts, and availability", () => {
  const fixture = admitted({ resultLimit: 1, actionTypes: [] });
  const catalog = new CapabilityDiscoveryCatalog({
    now: () => fixedNow,
    maxCapabilities: 2,
  });
  const first = capability("kindred.capability.companion.discovery-a.v1");
  const second = capability("kindred.capability.companion.discovery-b.v1");
  catalog.registerCapability(second);
  catalog.registerCapability(first);
  const result = catalog.discover({
    envelope: fixture.envelope,
    protocolReceipt: fixture.protocolReceipt,
    identity: fixture.identity,
    now: fixedNow,
  });
  assert.equal(result.result_count, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.capabilities[0].capability_id, first.capability_id);
  assert.throws(
    () =>
      catalog.registerCapability(
        capability("kindred.capability.companion.discovery-c.v1"),
      ),
    (error) =>
      error instanceof CapabilityDiscoveryError &&
      error.reasonClass === "discovery_catalog_capacity_reached",
  );
  assert.throws(
    () => catalog.registerCapability({ ...first, version: "2.0.0" }),
    (error) => error.reasonClass === "discovery_capability_conflict",
  );
  catalog.setAvailability(first.capability_id, false);
  assert.throws(
    () => catalog.setAvailability("kindred.capability.missing.v1", true),
    (error) => error.reasonClass === "discovery_capability_unknown",
  );
});

test("discovery denies unbound authentication, route, receipt, and principal", () => {
  const fixture = admitted();
  const catalog = new CapabilityDiscoveryCatalog({ now: () => fixedNow });
  catalog.registerCapability(
    capability("kindred.capability.companion.discovery-chat.v1"),
  );
  const newGateway = () => {
    const gateway = new AgentProtocolGateway({ now: () => fixedNow });
    gateway.registerIdentity(fixture.identity);
    gateway.registerAuthorityGrant(fixture.grant);
    return gateway;
  };
  assert.throws(
    () =>
      newGateway().acceptEnvelope({
        ...fixture.envelope,
        authentication_ref: "kindred-authref-unbound-discovery",
      }),
    (error) => error.reasonClass === "authentication_reference_mismatch",
  );
  assert.throws(
    () =>
      newGateway().acceptEnvelope({
        ...fixture.envelope,
        recipient: { principal_type: "runtime_component", id: "emit_core" },
      }),
    (error) => error.reasonClass === "discovery_route_forbidden",
  );
  assert.throws(
    () =>
      catalog.discover({
        envelope: fixture.envelope,
        protocolReceipt: {
          ...fixture.protocolReceipt,
          correlation_id: "discovery-correlation-tampered",
        },
        identity: fixture.identity,
        now: fixedNow,
      }),
    (error) => error.reasonClass === "discovery_receipt_invalid",
  );
  assert.throws(
    () =>
      catalog.discover({
        envelope: fixture.envelope,
        protocolReceipt: fixture.protocolReceipt,
        identity: {
          ...fixture.identity,
          lifecycle_state: "suspended",
          health: "unavailable",
        },
        now: fixedNow,
      }),
    (error) => error.reasonClass === "discovery_principal_inactive",
  );
});

test("discovery query and result schemas stay exact and side-effect denying", async () => {
  const root = new URL("../../../", import.meta.url);
  const [querySchema, resultSchema] = await Promise.all(
    [
      "contracts/agent/v1/capability-discovery-query.schema.json",
      "contracts/agent/v1/capability-discovery-result.schema.json",
    ].map(async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"))),
  );
  assert.deepEqual(querySchema.required, CAPABILITY_DISCOVERY_QUERY_FIELDS);
  assert.deepEqual(resultSchema.required, CAPABILITY_DISCOVERY_RESULT_FIELDS);
  assert.deepEqual(
    resultSchema.$defs.capability_projection.required,
    CAPABILITY_DISCOVERY_PROJECTION_FIELDS,
  );
  assert.equal(
    querySchema.properties.contract_version.const,
    CAPABILITY_DISCOVERY_QUERY_CONTRACT_VERSION,
  );
  assert.equal(
    resultSchema.properties.contract_version.const,
    CAPABILITY_DISCOVERY_RESULT_CONTRACT_VERSION,
  );
  for (const field of [
    "authority_requested",
    "provider_contact_requested",
    "memory_write_requested",
    "tool_execution_requested",
    "settlement_requested",
    "external_effects",
  ]) {
    assert.equal(querySchema.properties[field].const, false);
  }
  for (const field of [
    "authority_granted",
    "execution_authorized",
    "provider_contact_authorized",
    "memory_write_authorized",
    "settlement_authorized",
    "external_effects_authorized",
  ]) {
    assert.equal(resultSchema.properties[field].const, false);
  }
  const fixture = admitted();
  assert.throws(
    () =>
      validateCapabilityDiscoveryQuery({
        ...fixture.envelope.payload,
        authority_requested: true,
      }),
    (error) => error.reasonClass === "discovery_query_invalid",
  );
  const catalog = new CapabilityDiscoveryCatalog({ now: () => fixedNow });
  const result = catalog.discover({
    envelope: fixture.envelope,
    protocolReceipt: fixture.protocolReceipt,
    identity: fixture.identity,
    now: fixedNow,
  });
  assert.deepEqual(validateCapabilityDiscoveryResult(result), result);
  assert.throws(
    () => validateCapabilityDiscoveryResult({ ...result, extra: true }),
    (error) => error.reasonClass === "discovery_result_invalid",
  );
});
