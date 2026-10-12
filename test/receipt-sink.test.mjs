import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generatePairingSecret, startProofReceiver, sendTwoHostProof } from "../src/two-machine-proof.mjs";

test("audit sink receives the exact immutable authenticated receipt before sender success", async () => {
  const secret = generatePairingSecret(), captured = [];
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret,
    onReceipt: receipt => { assert.equal(Object.isFrozen(receipt), true); captured.push(receipt); } });
  try {
    const payload = Buffer.from("audited local receipt");
    const receipt = await sendTwoHostProof({ host: "127.0.0.1", port: receiver.port, secret,
      canonicalPayload: payload, stateId: "local/audit", generation: 1,
      stateHash: createHash("sha256").update(payload).digest("hex") });
    assert.deepEqual(captured, [receipt]);
  } finally { await receiver.close(); }
});
test("failed receipt persistence rejects sender success", async () => {
  const secret = generatePairingSecret();
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret,
    onReceipt: () => { throw new Error("TEST_ONLY_AUDIT_WRITE_FAILURE"); } });
  try {
    const payload = Buffer.from("persist before success");
    await assert.rejects(sendTwoHostProof({ host: "127.0.0.1", port: receiver.port, secret,
      canonicalPayload: payload, stateId: "local/audit", generation: 1,
      stateHash: createHash("sha256").update(payload).digest("hex") }), error =>
        /proof transfer failed: 503/.test(error.message) && !error.message.includes("TEST_ONLY_AUDIT_WRITE_FAILURE"));
  } finally { await receiver.close(); }
});
