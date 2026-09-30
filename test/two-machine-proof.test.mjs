import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  TWO_HOST_CIPHER,
  startProofReceiver,
  sendTwoHostProof
} from "../src/two-machine-proof.mjs";

const secret = "kindred-proof-test-secret-32-bytes-minimum";
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("loopback proof encrypts payload but refuses two-host claim", async (t) => {
  const receiver = await startProofReceiver({
    host: "127.0.0.1",
    port: 0,
    secret
  });
  t.after(() => receiver.close());

  const payload = Buffer.from('{"generation":1,"kindred":"state"}');
  const stateHash = digest(payload);
  const receipt = await sendTwoHostProof({
    host: "127.0.0.1",
    port: receiver.port,
    secret,
    canonicalPayload: payload,
    stateId: `kindred-state:1:${stateHash.slice(0, 16)}`,
    stateHash,
    generation: 1
  });

  assert.equal(receipt.authenticationVerified, true);
  assert.equal(receipt.integrityVerified, true);
  assert.equal(receipt.encryptedOnWire, true);
  assert.equal(receipt.cipher, TWO_HOST_CIPHER);
  assert.equal(receipt.transportClass, "HTTP_TCP_AES_256_GCM_BUFFERED");
  assert.equal(receipt.loopbackObserved, true);
  assert.equal(receipt.twoHostNetworkProofSatisfied, false);
  assert.equal(receipt.physicalMachineAttestationProven, false);
  assert.equal(receipt.productionReadyClaim, false);
});

test("wrong proof secret is rejected before plaintext can be accepted", async (t) => {
  const receiver = await startProofReceiver({
    host: "127.0.0.1",
    port: 0,
    secret
  });
  t.after(() => receiver.close());

  const payload = Buffer.from('{"state":"test"}');
  const stateHash = digest(payload);
  await assert.rejects(
    sendTwoHostProof({
      host: "127.0.0.1",
      port: receiver.port,
      secret: "wrong-secret-that-is-still-at-least-32-characters",
      canonicalPayload: payload,
      stateId: `kindred-state:2:${stateHash.slice(0, 16)}`,
      stateHash,
      generation: 2
    }),
    /proof transfer failed: 403/
  );
});

test("sender refuses payload that does not match Kindred state hash", async (t) => {
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
      secret,
      canonicalPayload: Buffer.from('{"state":"wrong"}'),
      stateId: "kindred-state:3:deadbeefdeadbeef",
      stateHash: "a".repeat(64),
      generation: 3
    }),
    /payload SHA-256/
  );
});
