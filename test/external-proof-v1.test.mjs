import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  canonicalBytes,
  createExternalProofReceipt,
  decryptExternalProofPayload,
  encryptExternalProofPayload,
  issueExternalProofChallenge,
  sha256,
  signExternalProofReceipt,
  verifyExternalProofEnvelope,
  verifyExternalProofToken
} from "../src/external-proof-v1.mjs";

const secret = "test-secret-that-is-intentionally-at-least-thirty-two-characters";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPkcs8Base64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const publicKeySpkiBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

function fixture() {
  const canonicalPayload = canonicalBytes({
    jobId: "job-test-1",
    operation: "HASH_TEXT",
    inputHash: sha256("hello"),
    outputHash: sha256("hello")
  });
  const stateHash = sha256(canonicalPayload);
  const challenge = issueExternalProofChallenge({
    secret,
    destinationNodeId: "strata-test-node",
    request: {
      sourceNodeId: "genesis-test-node",
      stateId: "job-test-1",
      stateHash,
      generation: 1,
      payloadSha256: stateHash,
      payloadBytes: canonicalPayload.length
    },
    nowMs: Date.parse("2026-10-27T00:00:00.000Z")
  });
  const claims = verifyExternalProofToken({
    secret,
    token: challenge.token,
    nowMs: Date.parse("2026-10-27T00:01:00.000Z")
  });
  const encrypted = encryptExternalProofPayload({
    secret,
    token: challenge.token,
    claims,
    payload: canonicalPayload
  });
  const decrypted = decryptExternalProofPayload({
    secret,
    token: challenge.token,
    claims,
    ...encrypted
  });
  const receipt = createExternalProofReceipt({
    claims,
    receivedSha256: decrypted.receivedSha256,
    ciphertextBytes: decrypted.ciphertextBytes,
    destinationExecution: {
      provider: "node-test",
      commitSha: "test-commit"
    },
    observedAt: "2026-10-27T00:01:01.000Z"
  });
  const envelope = signExternalProofReceipt({ receipt, privateKeyPkcs8Base64 });
  return { canonicalPayload, stateHash, challenge, claims, encrypted, envelope };
}

test("external proof round trip is signed and independently verifiable", () => {
  const { envelope, stateHash } = fixture();
  const verified = verifyExternalProofEnvelope({ envelope, trustedPublicKeySpkiBase64: publicKeySpkiBase64 });
  assert.equal(verified.verified, true);
  assert.equal(verified.stateHash, stateHash);
  assert.equal(envelope.receipt.transport.integrityVerified, true);
  assert.equal(envelope.receipt.claims.physicalMachineAttestationProven, false);
  assert.equal(envelope.receipt.claims.productionReadyClaim, false);
});

test("tampered receipt fails signature verification", () => {
  const { envelope } = fixture();
  envelope.receipt.payloadBytes += 1;
  assert.throws(
    () => verifyExternalProofEnvelope({ envelope, trustedPublicKeySpkiBase64: publicKeySpkiBase64 }),
    /signature verification failed/
  );
});

test("tampered challenge token is rejected", () => {
  const { challenge } = fixture();
  const token = challenge.token.slice(0, -1) + (challenge.token.endsWith("A") ? "B" : "A");
  assert.throws(
    () => verifyExternalProofToken({ secret, token, nowMs: Date.parse("2026-10-27T00:01:00.000Z") }),
    /authentication failed/
  );
});

test("expired challenge token is rejected", () => {
  const { challenge } = fixture();
  assert.throws(
    () => verifyExternalProofToken({ secret, token: challenge.token, nowMs: Date.parse("2026-10-27T00:10:01.000Z") }),
    /expired/
  );
});
