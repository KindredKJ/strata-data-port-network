import test from "node:test";
import assert from "node:assert/strict";
import { startProofReceiver, sendTwoHostProof } from "../src/two-machine-proof.mjs";

const secret = "kindred-proof-test-secret-32-bytes";

test("loopback proof verifies auth and bytes but refuses two-host claim", async (t) => {
  const receiver = await startProofReceiver({
    host: "127.0.0.1",
    port: 0,
    secret
  });
  t.after(() => receiver.close());

  const payload = Buffer.from('{"kindred":"state","generation":1}');
  const receipt = await sendTwoHostProof({
    host: "127.0.0.1",
    port: receiver.port,
    secret,
    canonicalPayload: payload,
    stateId: "state-1",
    stateHash: "a".repeat(64)
  });

  assert.equal(receipt.authenticationVerified, true);
  assert.equal(receipt.integrityVerified, true);
  assert.equal(receipt.loopbackObserved, true);
  assert.equal(receipt.twoHostNetworkProofSatisfied, false);
  assert.equal(receipt.physicalMachineAttestationProven, false);
  assert.equal(receipt.productionReadyClaim, false);
});

test("wrong proof secret is rejected", async (t) => {
  const receiver = await startProofReceiver({
    host: "127.0.0.1",
    port: 0,
    secret
  });
  t.after(() => receiver.close());

  await assert.rejects(
    sendTwoHostProof({
      host: "127.0.0.1",
      port: receiver.port,
      secret: "wrong-secret-that-is-long-enough",
      canonicalPayload: Buffer.from('{"state":"test"}'),
      stateId: "state-2",
      stateHash: "b".repeat(64)
    }),
    /proof transfer failed: 403/
  );
});
