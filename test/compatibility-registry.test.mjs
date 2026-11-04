import test from "node:test";
import assert from "node:assert/strict";
import { loadCompatibilityRegistry, assertComponentCompatibility, SDPNCompatibilityError } from "../src/compatibility-registry.mjs";
import { ORCHESTRATOR_SCHEMA } from "../src/port-orchestrator.mjs";
import { STRATACAST_RENDER_FRAME_SCHEMA } from "../src/stratacast-topology-bridge.mjs";
import { KINDRED_STATE_PORT_SCHEMA } from "../src/kindred-state-port.mjs";
import { TWO_HOST_PROOF_SCHEMA } from "../src/two-machine-proof.mjs";

test("all critical runtime schemas have pinned, compatible registry entries", () => {
  const registry = loadCompatibilityRegistry();
  const mapping = {
    "sdpn.orchestrator": ORCHESTRATOR_SCHEMA,
    "sdpn.stratacast-topology-bridge": STRATACAST_RENDER_FRAME_SCHEMA,
    "sdpn.state-port": KINDRED_STATE_PORT_SCHEMA,
    "sdpn.two-host-proof": TWO_HOST_PROOF_SCHEMA
  };
  assert.equal(registry.releasePolicy.automaticProductionDeployment, false);
  for (const [name, schema] of Object.entries(mapping)) {
    const entry = registry.components.find((item) => item.id === name);
    assert.ok(entry, name + " missing from registry");
    assert.equal(entry.schemaId, schema);
    assert.equal(assertComponentCompatibility(registry, name, schema, entry.schemaVersion).componentId, name);
  }
});

test("unknown, old, incompatible and unpinned schemas fail closed", () => {
  const registry = loadCompatibilityRegistry();
  for (const [name, schema, version] of [
    ["stratacast.render-frame", "stratacast.kindred/v1", "2.0.0"],
    ["stratacast.render-frame", "stratacast.kindred/v1", "0.9.9"],
    ["stratacast.render-frame", "stratacast.unknown/v1", "1.0.0"],
    ["not-registered", "stratacast.kindred/v1", "1.0.0"],
    ["stratacast.render-frame", "stratacast.kindred/v1", "latest"]
  ]) assert.throws(() => assertComponentCompatibility(registry, name, schema, version), SDPNCompatibilityError);
});

test("future additive minor schema may negotiate only inside pinned major", () => {
  const registry = loadCompatibilityRegistry();
  assert.equal(assertComponentCompatibility(registry, "stratacast.render-frame",
    "stratacast.kindred/v1", "1.1.0").negotiatedMajor, 1);
});
