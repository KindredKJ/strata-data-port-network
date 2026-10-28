import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  randomUUID,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify
} from "node:crypto";

export const EXTERNAL_PROOF_CHALLENGE_SCHEMA = "kindred.external-proof.challenge.v1";
export const EXTERNAL_PROOF_RECEIPT_SCHEMA = "kindred.external-proof.receipt.v1";
export const EXTERNAL_PROOF_CIPHER = "AES-256-GCM";
export const EXTERNAL_PROOF_MAX_BYTES = 1024 * 1024;

function boundedString(value, label, max = 512) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\r\n]/.test(value)) {
    throw new TypeError(`${label} must be a bounded single-line string`);
  }
  return value;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256(value) {
  return sha256Hex(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"));
}

export function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite numbers are not canonicalizable");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  throw new TypeError(`unsupported canonical value type: ${typeof value}`);
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), "utf8");
}

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("KINDRED external proof secret must be at least 32 characters");
  }
}

function validSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function hmac(secret, value, encoding = "base64url") {
  return createHmac("sha256", secret).update(value).digest(encoding);
}

function safeEqualEncoded(left, right, encoding = "base64url") {
  try {
    const a = Buffer.from(left, encoding);
    const b = Buffer.from(right, encoding);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function issueExternalProofChallenge({
  secret,
  request,
  destinationNodeId,
  ttlMs = 120_000,
  nowMs = Date.now()
}) {
  requireSecret(secret);
  boundedString(destinationNodeId, "destinationNodeId", 256);
  const sourceNodeId = boundedString(request?.sourceNodeId, "sourceNodeId", 256);
  const stateId = boundedString(request?.stateId, "stateId", 512);
  if (!validSha256(request?.stateHash) || !validSha256(request?.payloadSha256)) {
    throw new TypeError("stateHash and payloadSha256 must be SHA-256 hex digests");
  }
  if (request.stateHash.toLowerCase() !== request.payloadSha256.toLowerCase()) {
    throw new Error("stateHash must equal payloadSha256 for canonical proof payloads");
  }
  if (!Number.isSafeInteger(request?.generation) || request.generation < 0) {
    throw new TypeError("generation must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(request?.payloadBytes) || request.payloadBytes < 1 || request.payloadBytes > EXTERNAL_PROOF_MAX_BYTES) {
    throw new RangeError(`payloadBytes must be between 1 and ${EXTERNAL_PROOF_MAX_BYTES}`);
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 10_000 || ttlMs > 10 * 60_000) {
    throw new RangeError("ttlMs must be between 10 seconds and 10 minutes");
  }

  const claims = {
    schemaVersion: EXTERNAL_PROOF_CHALLENGE_SCHEMA,
    challengeId: randomUUID(),
    nonce: randomBytes(32).toString("hex"),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    sourceNodeId,
    destinationNodeId,
    stateId,
    stateHash: request.stateHash.toLowerCase(),
    generation: request.generation,
    payloadSha256: request.payloadSha256.toLowerCase(),
    payloadBytes: request.payloadBytes
  };
  const encoded = canonicalBytes(claims).toString("base64url");
  const mac = hmac(secret, encoded);
  return {
    ...claims,
    token: `${encoded}.${mac}`,
    cipher: EXTERNAL_PROOF_CIPHER
  };
}

export function verifyExternalProofToken({ secret, token, nowMs = Date.now() }) {
  requireSecret(secret);
  boundedString(token, "token", 16_384);
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("invalid challenge token");
  const [encoded, suppliedMac] = parts;
  const expectedMac = hmac(secret, encoded);
  if (!safeEqualEncoded(suppliedMac, expectedMac)) throw new Error("challenge token authentication failed");

  let claims;
  try {
    claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("challenge token payload is invalid");
  }
  if (claims.schemaVersion !== EXTERNAL_PROOF_CHALLENGE_SCHEMA) throw new Error("challenge schema mismatch");
  if (!validSha256(claims.stateHash) || !validSha256(claims.payloadSha256)) throw new Error("challenge hash fields invalid");
  if (claims.stateHash !== claims.payloadSha256) throw new Error("challenge state hash mismatch");
  if (!Number.isSafeInteger(claims.generation) || claims.generation < 0) throw new Error("challenge generation invalid");
  if (!Number.isSafeInteger(claims.payloadBytes) || claims.payloadBytes < 1 || claims.payloadBytes > EXTERNAL_PROOF_MAX_BYTES) throw new Error("challenge payload size invalid");
  boundedString(claims.challengeId, "challengeId", 64);
  boundedString(claims.nonce, "nonce", 128);
  boundedString(claims.sourceNodeId, "sourceNodeId", 256);
  boundedString(claims.destinationNodeId, "destinationNodeId", 256);
  boundedString(claims.stateId, "stateId", 512);
  const issued = Date.parse(claims.issuedAt);
  const expires = Date.parse(claims.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) throw new Error("challenge timestamps invalid");
  if (nowMs > expires) throw new Error("challenge token expired");
  if (issued > nowMs + 60_000) throw new Error("challenge token issued in the future");
  return claims;
}

export function deriveExternalProofKey({ secret, claims }) {
  requireSecret(secret);
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from(claims.nonce, "hex"),
    Buffer.from(`kindred-external-proof-v1|${claims.challengeId}`, "utf8"),
    32
  ));
}

export function encryptExternalProofPayload({ secret, token, claims, payload }) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (body.length !== claims.payloadBytes) throw new Error("payload length does not match challenge");
  if (sha256(body) !== claims.payloadSha256) throw new Error("payload SHA-256 does not match challenge");
  const key = deriveExternalProofKey({ secret, claims });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(token, "utf8"), { plaintextLength: body.length });
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  return {
    ciphertextB64: ciphertext.toString("base64url"),
    ivB64: iv.toString("base64url"),
    tagB64: cipher.getAuthTag().toString("base64url")
  };
}

export function decryptExternalProofPayload({ secret, token, claims, ciphertextB64, ivB64, tagB64 }) {
  const key = deriveExternalProofKey({ secret, claims });
  const ciphertext = Buffer.from(boundedString(ciphertextB64, "ciphertextB64", EXTERNAL_PROOF_MAX_BYTES * 2), "base64url");
  const iv = Buffer.from(boundedString(ivB64, "ivB64", 64), "base64url");
  const tag = Buffer.from(boundedString(tagB64, "tagB64", 64), "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("invalid AES-GCM IV or tag");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(token, "utf8"), { plaintextLength: claims.payloadBytes });
  decipher.setAuthTag(tag);
  const payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (payload.length !== claims.payloadBytes) throw new Error("received payload length mismatch");
  const receivedSha256 = sha256(payload);
  if (receivedSha256 !== claims.payloadSha256) throw new Error("received payload SHA-256 mismatch");
  return { payload, receivedSha256, ciphertextBytes: ciphertext.length };
}

export function createExternalProofReceipt({
  claims,
  receivedSha256,
  ciphertextBytes,
  destinationExecution = {},
  observedAt = new Date().toISOString()
}) {
  return {
    schemaVersion: EXTERNAL_PROOF_RECEIPT_SCHEMA,
    challengeId: claims.challengeId,
    sourceNodeId: claims.sourceNodeId,
    destinationNodeId: claims.destinationNodeId,
    stateId: claims.stateId,
    stateHash: claims.stateHash,
    generation: claims.generation,
    payloadSha256: claims.payloadSha256,
    receivedSha256,
    payloadBytes: claims.payloadBytes,
    ciphertextBytes,
    transport: {
      protocol: "HTTPS",
      applicationCipher: EXTERNAL_PROOF_CIPHER,
      challengeAuthentication: "HMAC-SHA256",
      statelessChallenge: true,
      authenticationVerified: true,
      integrityVerified: receivedSha256 === claims.payloadSha256,
      encryptedApplicationPayload: true
    },
    destinationExecution: {
      provider: destinationExecution.provider ?? "vercel",
      deploymentId: destinationExecution.deploymentId ?? null,
      deploymentUrl: destinationExecution.deploymentUrl ?? null,
      commitSha: destinationExecution.commitSha ?? null,
      region: destinationExecution.region ?? null
    },
    claims: {
      externalRuntime: true,
      distinctServiceIdentity: claims.sourceNodeId !== claims.destinationNodeId,
      physicalMachineAttestationProven: false,
      productionReadyClaim: false
    },
    observedAt
  };
}

export function signExternalProofReceipt({ receipt, privateKeyPkcs8Base64 }) {
  boundedString(privateKeyPkcs8Base64, "privateKeyPkcs8Base64", 8192);
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8Base64, "base64"),
    format: "der",
    type: "pkcs8"
  });
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const keyId = sha256(publicDer);
  const signature = cryptoSign(null, canonicalBytes(receipt), privateKey).toString("base64url");
  return {
    receipt,
    signatureAlgorithm: "Ed25519",
    keyId,
    publicKeySpkiBase64: publicDer.toString("base64"),
    signature
  };
}

export function verifyExternalProofEnvelope({ envelope, trustedPublicKeySpkiBase64 }) {
  if (!envelope || envelope.signatureAlgorithm !== "Ed25519" || typeof envelope.signature !== "string") {
    throw new Error("invalid external proof envelope");
  }
  const suppliedPublic = boundedString(envelope.publicKeySpkiBase64, "publicKeySpkiBase64", 4096);
  if (trustedPublicKeySpkiBase64 && suppliedPublic !== trustedPublicKeySpkiBase64) {
    throw new Error("external proof signing key does not match trusted public key");
  }
  const publicDer = Buffer.from(trustedPublicKeySpkiBase64 ?? suppliedPublic, "base64");
  if (sha256(publicDer) !== envelope.keyId) throw new Error("external proof key fingerprint mismatch");
  const publicKey = createPublicKey({ key: publicDer, format: "der", type: "spki" });
  const ok = cryptoVerify(
    null,
    canonicalBytes(envelope.receipt),
    publicKey,
    Buffer.from(envelope.signature, "base64url")
  );
  if (!ok) throw new Error("external proof signature verification failed");
  if (envelope.receipt?.schemaVersion !== EXTERNAL_PROOF_RECEIPT_SCHEMA) throw new Error("external proof receipt schema mismatch");
  if (envelope.receipt?.payloadSha256 !== envelope.receipt?.receivedSha256) throw new Error("external proof receipt integrity mismatch");
  if (envelope.receipt?.transport?.integrityVerified !== true || envelope.receipt?.transport?.authenticationVerified !== true) {
    throw new Error("external proof receipt did not verify transport integrity/authentication");
  }
  return {
    verified: true,
    keyId: envelope.keyId,
    stateHash: envelope.receipt.stateHash,
    challengeId: envelope.receipt.challengeId
  };
}
