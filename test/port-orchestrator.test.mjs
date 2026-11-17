import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SDPNPortOrchestrator } from "../src/port-orchestrator.mjs";
import { toStrataCastRenderFrame } from "../src/stratacast-topology-bridge.mjs";

async function harness(transport, authorize = async () => ({ allowed: true, authorityId: "port-zero" })) {
  const directory = await mkdtemp(join(tmpdir(), "sdpn-orch-"));
  const path = join(directory, "audit.ndjson");
  const now = () => 1800000000000;
  const coordinator = await SDPNPortOrchestrator.open({
    journalPath: path, authorize, transport, now
  });
  const port = (id, scopes, allowedDestinations = []) => ({
    id, ownerId: "tenant-1", scopes, allowedDestinations,
    expiresAt: now() + 60000, consentGranted: true, identityVerified: true,
    health: "healthy"
  });
  const cleanup = async () => {
    await coordinator.close();
    await rm(directory, { recursive: true, force: true });
  };
  return { coordinator, port, directory, path, now, cleanup };
}
test("deny-by-default authority rejects port registration", async () => {
  const h = await harness(async () => {}, async () => ({ allowed: false }));
  try {
    await assert.rejects(h.coordinator.registerPort({ actor: "alice", port: h.port("a", ["transfer:send"]) }), /Authorization denied/);
    assert.equal(h.coordinator.snapshot().ports.length, 0);
  } finally { await h.cleanup(); }
});
test("verified receipt, restart replay prevention and immutable state digest", async () => {
  let sent = 0;
  const h = await harness(async (request) => {
    sent++;
    return { accepted: true, transferId: request.transferId,
      destinationId: request.destinationId, stateId: request.stateId,
      payloadSha256: request.payloadSha256, integrityVerified: true };
  });
  try {
    await h.coordinator.registerPort({ actor: "operator", port: h.port("a", ["transfer:send"], ["b"]) });
    await h.coordinator.registerPort({ actor: "operator", port: h.port("b", ["transfer:receive"]) });
    const bytes = new TextEncoder().encode("canonical bytes");
    const result = await h.coordinator.dispatch({
      actor: "operator", sourceId: "a", destinationIds: ["b"],
      stateId: "state-1", payload: bytes, idempotencyKey: "k1"
    });
    assert.equal(sent, 1);
    assert.equal(result.classification, "CONNECTOR_RECEIPT_VERIFIED");
    assert.equal(result.physicalZeroCopyProven, false);
    const snapshot = h.coordinator.snapshot();
    const frame = toStrataCastRenderFrame(snapshot);
    assert.equal(frame.kind, "RenderFrame");
    assert.equal(frame.objects.length, 2);
    assert.equal(frame.schemaVersion, "stratacast.kindred/v1");
    assert.ok(!(await readFile(h.path, "utf8")).includes("canonical bytes"));
    await h.coordinator.close();
    const restored = await SDPNPortOrchestrator.open({
      journalPath: h.path, now: h.now, authorize: async () => ({ allowed: true, authorityId: "port-zero" }),
      transport: async () => { throw new Error("should never send"); }
    });
    await assert.rejects(restored.dispatch({
      actor: "operator", sourceId: "a", destinationIds: ["b"],
      stateId: "state-1", payload: bytes, idempotencyKey: "k1"
    }), /Replay/);
    await restored.close();
  } finally { await h.cleanup(); }
});
test("definitive refusal fails over; indeterminate outcome stops", async () => {
  const called = [];
  const h = await harness(async (r) => {
    called.push(r.destinationId);
    return r.destinationId === "b"
      ? { accepted: false, committed: false, safeToRetry: true, transferId: r.transferId }
      : { accepted: true, transferId: r.transferId, destinationId: r.destinationId,
        stateId: r.stateId, payloadSha256: r.payloadSha256, integrityVerified: true };
  });
  try {
    await h.coordinator.registerPort({ actor: "operator", port: h.port("a", ["transfer:send"], ["b", "c"]) });
    await h.coordinator.registerPort({ actor: "operator", port: h.port("b", ["transfer:receive"]) });
    await h.coordinator.registerPort({ actor: "operator", port: h.port("c", ["transfer:receive"]) });
    const args = { actor: "operator", sourceId: "a", destinationIds: ["b", "c"],
      stateId: "s", payload: Uint8Array.of(1, 2, 3), idempotencyKey: "once" };
    const result = await h.coordinator.dispatch(args);
    assert.equal(result.destinationId, "c");
    assert.deepEqual(called, ["b", "c"]);
    await h.coordinator.revokePort({ actor: "operator", portId: "c" });
    await assert.rejects(h.coordinator.dispatch({ ...args, idempotencyKey: "twice" }), /Port unavailable/);
    assert.equal(h.coordinator.snapshot().ports.find((p) => p.id === "c").health, "revoked");
  } finally { await h.cleanup(); }
});
test("corrupt audit, missing approval and false proof claims fail closed", async () => {
  const h = await harness(async () => { throw new Error("timeout"); });
  try {
    await h.coordinator.registerPort({ actor: "operator", port: h.port("a", ["transfer:send"], ["b"]) });
    await h.coordinator.registerPort({ actor: "operator", port: h.port("b", ["transfer:receive"]) });
    await assert.rejects(h.coordinator.dispatch({
      actor: "operator", sourceId: "a", destinationIds: ["b"], stateId: "s",
      payload: Uint8Array.of(5), idempotencyKey: "unknown"
    }), /indeterminate/);
    assert.equal(h.coordinator.snapshot().publicNetworkOperational, false);
    await h.coordinator.close();
    const records = (await readFile(h.path, "utf8")).replace('"healthy"', '"offline"');
    await writeFile(h.path, records);
    await assert.rejects(SDPNPortOrchestrator.open({
      journalPath: h.path, authorize: async () => ({ allowed: true, authorityId: "port-zero" }),
      transport: async () => {}
    }), /integrity failure/);
  } finally { await h.cleanup(); }
});

test("concurrent dispatch and privileged mutation cannot bypass the single writer", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = await harness(async (request) => {
    await gate;
    return { accepted: true, transferId: request.transferId,
      destinationId: request.destinationId, stateId: request.stateId,
      payloadSha256: request.payloadSha256, integrityVerified: true };
  });
  try {
    await h.coordinator.registerPort({ actor: "operator", port: h.port("a", ["transfer:send"], ["b"]) });
    await h.coordinator.registerPort({ actor: "operator", port: h.port("b", ["transfer:receive"]) });
    const args = { actor: "operator", sourceId: "a", destinationIds: ["b"],
      stateId: "test", payload: Uint8Array.of(2), idempotencyKey: "single-writer" };
    const first = h.coordinator.dispatch(args);
    await assert.rejects(h.coordinator.dispatch(args), /single-writer/);
    await assert.rejects(h.coordinator.revokePort({ actor: "operator", portId: "b" }), /single-writer/);
    release();
    await first;
    await h.coordinator.revokePort({ actor: "operator", portId: "b" });
    assert.equal(h.coordinator.snapshot().ports.find((p) => p.id === "b").health, "revoked");
  } finally { release(); await h.cleanup(); }
});
