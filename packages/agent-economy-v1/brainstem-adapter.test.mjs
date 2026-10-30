import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { AgentProtocolGateway, AGENT_IDENTITY_CONTRACT_VERSION,
  AUTHORITY_GRANT_CONTRACT_VERSION, CAPABILITY_CONTRACT_VERSION
} from "../../candidates/unified-quad-direct-pipe/runtime/unified-quad/src/agent-protocol.mjs";
import { bridgeBrainstemGrant } from "./brainstem-adapter.mjs";

const CAP = "kindred.capability.retrobank.internal-settlement.v1";
const AGENT = "kindred-agent-marketplace-0001";
const TENANT = "kindred-tenant-marketplace-0001";
const GRANT = "kindred-grant-marketplace-0001";
const BUDGET = "budget-marketplace-0001";
const KEY = "test-brainstem-key-NOT-PRODUCTION-123456789";
const NOW = Date.parse("2026-10-30T12:00:00Z");

function fixture() {
  const capability = {
    contract_version: CAPABILITY_CONTRACT_VERSION, capability_id: CAP,
    version: "1.0.0", owner_component: "retrobank", action_type: "settlement",
    allowed_agent_classes: ["worker"], required_authority: "governance_delegated",
    risk_ceiling: "high", data_classifications: ["restricted"],
    execution_mode: "governed_local_reversible",
    provider_contact: "mediated_only", memory_commit: "brainstem_only",
    settlement: "retrobank_mandate_only", compensation_required: true,
    input_contract_ref: "contracts/agent/v1/request.json",
    output_contract_ref: "contracts/agent/v1/receipt.json",
  };
  const identity = {
    contract_version: AGENT_IDENTITY_CONTRACT_VERSION,
    agent_id: AGENT, tenant_id: TENANT, agent_class: "worker",
    owner_id: "kindred-account-owner-0001",
    creator_id: "kindred-founder-0001", version: "1.0.0",
    lineage: { parent_agent_id: null, replaces_agent_id: null },
    purpose: "Perform contracted paid tasks", capabilities: [CAP],
    prohibited_capabilities: [], permissions: ["agent.marketplace.purchase"],
    authority: { issuer_component: "brainstem", grant_refs: [GRANT],
                 ceiling: "governance_delegated" },
    budget_refs: [BUDGET], lifecycle_state: "active", health: "healthy",
    evidence_refs: [],
    memory_scope: { namespace_refs: [], write_mode: "proposal_only" },
    execution_scope: { mode: "proposal_only", allowed_capabilities: [] },
    provider_scope: { mode: "mediated_only", provider_refs: [] },
    economic_mandate_ref: null, replacement_agent_id: null,
    created_at: "2026-10-29T10:00:00.000Z", revoked_at: null,
  };
  const grant = {
    contract_version: AUTHORITY_GRANT_CONTRACT_VERSION,
    grant_id: GRANT, subject_agent_id: AGENT, issuer_component: "brainstem",
    issuer_id: "kindred-component-brainstem",
    authentication_ref: "kindred-authref-marketplace-0001",
    authority_level: "governance_delegated", capability_ids: [CAP],
    message_types: ["settlement_request"], permissions: ["agent.marketplace.purchase"],
    budget_refs: [BUDGET], parent_grant_ref: null,
    issued_at: "2026-10-29T00:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    status: "active", revoked_at: null,
  };
  const gateway = new AgentProtocolGateway({ now: () => NOW });
  gateway.registerCapability(capability);
  gateway.registerIdentity(identity);
  gateway.registerAuthorityGrant(grant);
  return { gateway, identity, grant };
}

test("registered Brainstem settlement mandate signs a bounded v1 grant", () => {
  const { gateway, identity, grant } = fixture();
  const value = bridgeBrainstemGrant({
    gateway, identity, authorityGrant: grant,
    capabilityId: CAP, budgetId: BUDGET,
    maxAtomic: 32000, secret: KEY, now: NOW,
  });
  assert.equal(value.contract_version, "kindred.port-agent.v1");
  assert.equal(value.grant.agent_id, AGENT);
  assert.equal(value.grant.ceiling, 32000);
  assert.equal(value.signature.length, 64);
  assert.equal(value.signature, createHmac("sha256",KEY)
    .update(JSON.stringify(Object.fromEntries(Object.entries(value.grant)
      .sort(([a],[b])=>a.localeCompare(b)))), "utf8").digest("hex"));
});

test("unregistered or altered grants never issue economic authority", () => {
  const { gateway, identity, grant } = fixture();
  const args = { gateway, identity, authorityGrant: grant,
    capabilityId: CAP, budgetId: BUDGET, maxAtomic: 1, secret: KEY, now: NOW };
  assert.throws(() => bridgeBrainstemGrant({...args,budgetId:"budget-other-0001"}));
  assert.throws(() => bridgeBrainstemGrant({...args,maxAtomic:0}));
  assert.throws(() => bridgeBrainstemGrant({...args,
    authorityGrant:{...grant,expires_at:"2026-10-30T00:00:00.000Z"}}));
  gateway.grants.delete(GRANT);
  assert.throws(() => bridgeBrainstemGrant(args));
});
