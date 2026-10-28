import assert from "node:assert/strict";
import { createCipheriv, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import test from "node:test";
import {
  canonicalBytes,
  createCrossProviderRecoveryRecord,
  createExternalProofReceipt,
  decryptExternalProofPayload,
  encryptExternalProofPayload,
  issueExternalProofChallenge,
  openRecoveryCapsule,
  sha256,
  signCrossProviderRecovery,
  signExternalProofReceipt,
  verifyCrossProviderRecoveryEnvelope,
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


function recoveryFixture(job = {
  operation: "HASH_TEXT",
  input: { text: "cross-provider-recovery" },
  clientRequestId: "test-recovery"
}) {
  const recoveryId = "recovery-11111111-1111-4111-8111-111111111111";
  const normalizedInput = job.operation === "HASH_TEXT"
    ? { text: job.input.text }
    : { value: job.input.value };
  const validatedInputHash = sha256(canonicalBytes(normalizedInput));
  const state = {
    schemaVersion: "kindred.external-proof.recovery-state.v1",
    recoveryId,
    checkpointedAt: "2026-10-28T00:00:00.000Z",
    sourceNodeId: "genesis-render-node-a",
    sourceBootId: "boot-a",
    checkpointStage: "VALIDATED_BEFORE_EXTERNAL_TRANSFER",
    validatedInputHash,
    job
  };
  const plaintext = canonicalBytes(state);
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    salt,
    Buffer.from(`kindred-external-proof-recovery-v1|${recoveryId}`, "utf8"),
    32
  ));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("kindred.external-proof.recovery-capsule.v1", "utf8"), {
    plaintextLength: plaintext.length
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const unsigned = {
    schemaVersion: "kindred.external-proof.recovery-capsule.v1",
    recoveryId,
    saltB64: salt.toString("base64url"),
    ivB64: iv.toString("base64url"),
    ciphertextB64: ciphertext.toString("base64url"),
    tagB64: cipher.getAuthTag().toString("base64url")
  };
  return {
    state,
    capsule: {
      ...unsigned,
      capsuleSha256: sha256(canonicalBytes(unsigned))
    }
  };
}

test("opens a Genesis-compatible sealed recovery capsule and signs cross-provider recovery", () => {
  const { capsule, state } = recoveryFixture();
  const opened = openRecoveryCapsule({ secret, capsule });
  assert.equal(opened.state.recoveryId, state.recoveryId);
  assert.equal(opened.state.sourceNodeId, "genesis-render-node-a");
  assert.equal(opened.executed.inputHash, state.validatedInputHash);

  const recovery = createCrossProviderRecoveryRecord({
    state: opened.state,
    executed: opened.executed,
    capsuleSha256: capsule.capsuleSha256,
    recoveryNodeId: "strata-vercel-recovery-node-c",
    execution: { provider: "vercel", commitSha: "test-recovery-commit" },
    observedAt: "2026-10-28T00:01:00.000Z"
  });
  const envelope = signCrossProviderRecovery({ recovery, privateKeyPkcs8Base64 });
  const verified = verifyCrossProviderRecoveryEnvelope({
    envelope,
    trustedPublicKeySpkiBase64: publicKeySpkiBase64
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.recoveryId, state.recoveryId);
  assert.equal(recovery.originalSourceNodeId, "genesis-render-node-a");
  assert.equal(recovery.recoveryNodeId, "strata-vercel-recovery-node-c");
  assert.equal(recovery.claims.automaticFailoverProven, false);
});

test("rejects a tampered sealed recovery capsule", () => {
  const { capsule } = recoveryFixture();
  const tampered = {
    ...capsule,
    ciphertextB64: capsule.ciphertextB64.slice(0, -1) +
      (capsule.ciphertextB64.endsWith("A") ? "B" : "A")
  };
  assert.throws(
    () => openRecoveryCapsule({ secret, capsule: tampered }),
    /digest mismatch/
  );
});

