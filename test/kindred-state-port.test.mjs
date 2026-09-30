import test from "node:test";
import assert from "node:assert/strict";
import { KindredStatePort, stateHash } from "../src/kindred-state-port.mjs";

test("reference state port moves no payload", async () => {
  const payload = { mode: "ready", tool: "camera" };
  const port = new KindredStatePort();
  const candidate = {
    state_id: "camera-ready",
    state_hash: stateHash(payload),
    locator: "recall://camera-ready",
    verified: true
  };

  const result = await port.transfer({
    candidate,
    destination: "surface://local",
    payload,
    supportsReference: true
  });

  assert.equal(result.classification, "REFERENCE");
  assert.equal(result.payloadMoved, false);
  assert.equal(result.locator, "recall://camera-ready");
  await port.close();
});

test("local payload path uses SW06-E reduced-copy boundary", async (t) => {
  const payload = { state: "active", value: 7 };
  const port = new KindredStatePort();
  t.after(() => port.close());
  const candidate = {
    state_id: "active-7",
    state_hash: stateHash(payload),
    locator: "memory://active-7",
    verified: true
  };

  const result = await port.transfer({
    candidate,
    destination: "worker://local",
    payload,
    supportsReference: false,
    local: true
  });

  assert.equal(result.classification, "REDUCED_COPY");
  assert.equal(result.workerMeasurement.explicitPayloadCopies, 0);
  assert.equal(result.workerMeasurement.zeroCopyClaimAuthorized, false);
  assert.equal(result.physicalZeroCopyProven, false);
});

test("payload hash mismatch is rejected", async () => {
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
      payload: { unexpected: true },
      supportsReference: false,
      local: true
    }),
    /payload hash/
  );
  await port.close();
});
