/** Additive typed bridge: existing Brainstem grant -> durable commerce mandate.
 * Executed only by a trusted Brainstem service holding KINDRED_BRAINSTEM_GRANT_KEY.
 * A gateway registration is required; merely passing an object is not authority.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  validateAgentIdentity,
  validateAuthorityGrant,
} from "../../candidates/unified-quad-direct-pipe/runtime/unified-quad/src/agent-protocol.mjs";

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}
export function bridgeBrainstemGrant({
  gateway, identity, authorityGrant, capabilityId, budgetId, maxAtomic, secret,
  now = Date.now(),
}) {
  if (!gateway || typeof gateway !== "object") throw new TypeError("trusted Brainstem gateway required");
  const agent = validateAgentIdentity(identity);
  const grant = validateAuthorityGrant(authorityGrant);
  const installedIdentity = gateway.identities?.get(agent.agent_id);
  const installedGrant = gateway.grants?.get(grant.grant_id);
  if (!installedIdentity || !installedGrant ||
      canonical(installedIdentity) !== canonical(agent) ||
      canonical(installedGrant) !== canonical(grant)) {
    throw new Error("Brainstem registration and grant must exist");
  }
  if (agent.lifecycle_state !== "active" || grant.status !== "active" ||
      grant.issuer_component !== "brainstem" || grant.subject_agent_id !== agent.agent_id ||
      grant.revoked_at !== null || Date.parse(grant.expires_at) <= now ||
      Date.parse(grant.issued_at) > now || !grant.capability_ids.includes(capabilityId) ||
      !agent.capabilities.includes(capabilityId) || !grant.budget_refs.includes(budgetId)) {
    throw new Error("Brainstem policy denied");
  }
  if (!Number.isSafeInteger(maxAtomic) || maxAtomic <= 0 ||
      typeof secret !== "string" || secret.length < 32) {
    throw new Error("budget limit and secret required");
  }
  const payload = {
    grant_id: grant.grant_id, tenant_id: agent.tenant_id,
    agent_id: agent.agent_id, capability: capabilityId, budget_id: budgetId,
    ceiling: maxAtomic, expires_at: Math.floor(Date.parse(grant.expires_at) / 1000),
  };
  const signature = createHmac("sha256",secret).update(canonical(payload),"utf8").digest("hex");
  return Object.freeze({ contract_version: "kindred.port-agent.v1",
                         grant: Object.freeze(payload), signature });
}
