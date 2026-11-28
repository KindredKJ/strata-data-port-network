import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registry = JSON.parse(
  readFileSync(new URL("../docs/interconnect-feature-register.v1.json", import.meta.url), "utf8")
);

test("INTERCONNECT registry remains proposal-only and non-Chromium", () => {
  assert.equal(registry.schemaVersion, "kindred.sdpn.interconnect.feature-register.v1");
  assert.equal(registry.status, "PROPOSED_NOT_IMPLEMENTED");
  assert.equal(registry.product, "INTERCONNECT");
  assert.equal(registry.policy.browserEngine, "NON_CHROMIUM");
  assert.equal(registry.policy.productionActivation, false);
  assert.equal(registry.policy.proofPromotion, false);
  assert.equal(registry.policy.privateDataSyncByDefault, false);
  assert.equal(registry.policy.existingPortZeroAuthorityUnchanged, true);
  assert.equal(registry.policy.existingEncryptedFileWorkspaceUnchanged, true);
  assert.equal(registry.policy.independentKindredProducts, true);
});

test("features use unique stable IDs, explicit owners, release gates, and review requirements", () => {
  assert.equal(registry.features.length, 16);
  assert.equal(new Set(registry.features.map((feature) => feature.id)).size, registry.features.length);
  const owners = new Set(["browser-local", "hybrid", "network-opt-in"]);
  for (const [index, feature] of registry.features.entries()) {
    assert.equal(feature.id, `IC-${String(index + 1).padStart(3, "0")}`);
    assert.match(feature.name, /^.{8,}$/);
    assert.ok(["P0", "P1", "P2"].includes(feature.priority));
    assert.ok(owners.has(feature.owner));
    assert.equal(typeof feature.sdpnReuse, "string");
    assert.ok(feature.sdpnReuse.length > 0);
    assert.equal(typeof feature.defaultBehavior, "string");
    assert.ok(["gate-b", "gate-c", "gate-d", "gate-e"].includes(feature.releaseGate));
    assert.equal(feature.status, "proposed");
    assert.equal(feature.requiresExplicitReview, true);
  }
});

test("evidence sources are HTTPS URLs and cover the observed research", () => {
  assert.ok(registry.sources.length >= 5);
  for (const source of registry.sources) {
    const parsed = new URL(source);
    assert.equal(parsed.protocol, "https:");
  }
});
