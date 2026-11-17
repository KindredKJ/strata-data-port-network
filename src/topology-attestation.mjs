import {
  createHash, createPrivateKey, createPublicKey, sign, verify
} from "node:crypto";

export const TOPOLOGY_ATTESTATION_SCHEMA = "kindred.sdpn.topology-attestation.v1";
const MAX_TTL_MS = 15 * 60 * 1000;
const HEX = /^[0-9a-f]{64}$/;
const keyId = (key) => "sha256:" +
  createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");

function checkCore(core, now) {
  if (!core || core.schemaVersion !== TOPOLOGY_ATTESTATION_SCHEMA ||
      core.algorithm !== "Ed25519" ||
      typeof core.signerKeyId !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(core.signerKeyId) ||
      !HEX.test(core.journalHash) ||
      !Number.isSafeInteger(core.issuedAtMs) ||
      !Number.isSafeInteger(core.expiresAtMs) ||
      core.issuedAtMs > now + 30_000 || core.expiresAtMs <= now ||
      core.expiresAtMs <= core.issuedAtMs ||
      core.expiresAtMs - core.issuedAtMs > MAX_TTL_MS ||
      core.frame?.schemaVersion !== "stratacast.kindred/v1" ||
      core.frame?.kind !== "RenderFrame" ||
      core.frame?.worldId !== "sdpn.network.topology" ||
      !Number.isSafeInteger(core.frame.sourceSequence) ||
      core.frame.sourceSequence < 0 ||
      core.frame.sourceTick !== core.frame.sourceSequence ||
      !Array.isArray(core.frame.objects) || core.frame.objects.length > 2000 ||
      Buffer.byteLength(JSON.stringify(core), "utf8") > 1024 * 1024) {
    throw new Error("Invalid, expired or oversized topology attestation");
  }
}

export function signTopologyAttestation({
  frame, journalHash, privateKeyPem, issuedAtMs = Date.now(),
  expiresAtMs = issuedAtMs + 5 * 60 * 1000
}) {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 key required");
  const publicKey = createPublicKey(privateKey);
  const core = {
    schemaVersion: TOPOLOGY_ATTESTATION_SCHEMA,
    algorithm: "Ed25519",
    signerKeyId: keyId(publicKey),
    issuedAtMs, expiresAtMs, journalHash, frame
  };
  checkCore(core, issuedAtMs);
  const signature = sign(null, Buffer.from(JSON.stringify(core)), privateKey);
  return { ...core, signature: signature.toString("base64url") };
}

export function verifyTopologyAttestation(attestation, trustedPublicKeyPem, now = Date.now()) {
  if (!attestation || typeof attestation !== "object" ||
      Array.isArray(attestation) ||
      typeof attestation.signature !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/.test(attestation.signature)) {
    throw new Error("Missing or malformed Ed25519 signature");
  }
  const publicKey = createPublicKey(trustedPublicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 public key required");
  const { signature, ...core } = attestation;
  checkCore(core, now);
  if (core.signerKeyId !== keyId(publicKey)) {
    throw new Error("Attestation signer not present in explicitly trusted key");
  }
  const signatureBytes = Buffer.from(signature, "base64url");
  if (signatureBytes.length !== 64 ||
      signatureBytes.toString("base64url") !== signature ||
      !verify(null, Buffer.from(JSON.stringify(core)), publicKey, signatureBytes)) {
    throw new Error("Attestation signature verification failed");
  }
  return Object.freeze({
    signerKeyId: core.signerKeyId,
    journalHash: core.journalHash,
    sourceSequence: core.frame.sourceSequence,
    frame: core.frame,
    topologyAuthenticityVerified: true,
    physicalZeroCopyProven: false,
    publicNetworkOperational: false
  });
}
