import test from "node:test";
import assert from "node:assert/strict";
import { KindredStatePort, payloadDigest } from "../src/kindred-state-port.mjs";

test("reference state port moves no payload", async () => {
  const canonicalPayload = '{"mode":"ready","tool":"camera"}';
  const port = new KindredStatePort();
  const candidate = {
    state_id: "camera-ready",
    state_hash: "1".repeat(64),
    locator: "recall://camera-ready",
    verified: true
  };

  const result = await port.transfer({
    candidate,
    destination: "surface://local",
    canonicalPayload,
    expectedIntegrityHash: payloadDigest(canonicalPayload),
    supportsReference: true
  });

  assert.equal(result.classification, "REFERENCE");
  assert.equal(result.executed, true);
  assert.equal(result.payloadMoved, false);
  assert.equal(result.locator, "recall://camera-ready");
  await port.close();
});

test("local payload path transfers exact canonical bytes through SW06-E", async (t) => {
  const canonicalPayload = '{"state":"active","value":1.0}';
  const port = new KindredStatePort();
  t.after(() => port.close());
  const candidate = {
    state_id: "active-1",
    state_hash: "2".repeat(64),
    locator: "memory://active-1",
    verified: true
  };

  const result = await port.transfer({
    candidate,
    destination: "worker://local",
    canonicalPayload,
    expectedIntegrityHash: payloadDigest(canonicalPayload),
    supportsReference: false,
    local: true
  });

  assert.equal(result.classification, "REDUCED_COPY");
  assert.equal(result.executed, true);
  assert.equal(result.workerMeasurement.explicitPayloadCopies, 0);
  assert.equal(result.workerMeasurement.zeroCopyClaimAuthorized, false);
  assert.equal(result.physicalZeroCopyProven, false);
});

test("integrity mismatch is rejected before worker transfer", async () => {
  const canonicalPayload = '{"unexpected":true}';
  const port = new KindredStatePort();
  const candidate = {
    state_id: "bad",
    state_hash: "0".repeat(64),
    locator: "memory://bad",
    verified: true
  };

  await assert.rejects(
    port.transfer({
      candidate,
      destination: "worker://local",
      canonicalPayload,
      expectedIntegrityHash: "f".repeat(64),
      supportsReference: false,
      local: true
    }),
    /integrity hash/
  );
  await port.close();
});

test("remote buffered fallback is a plan, not a fake execution", async () => {
  const canonicalPayload = '{"remote":true}';
  const port = new KindredStatePort();
  const candidate = {
    state_id: "remote",
    state_hash: "3".repeat(64),
    locator: "memory://remote",
    verified: true
  };

  const result = await port.transfer({
    candidate,
    destination: "peer://remote",
    canonicalPayload,
    expectedIntegrityHash: payloadDigest(canonicalPayload),
    supportsReference: false,
    local: false
  });

  assert.equal(result.classification, "PORTABLE_BUFFERED");
  assert.equal(result.executed, false);
  assert.equal(result.payloadMoved, false);
  assert.equal(result.boundary, "BUFFERED_FALLBACK_NOT_IMPLEMENTED");
  await port.close();
});
