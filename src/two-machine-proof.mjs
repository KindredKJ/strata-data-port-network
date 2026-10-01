import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";

export const TWO_HOST_PROOF_SCHEMA = "kindred.sdpn.two-host-proof.v2";
export const TWO_HOST_CIPHER = "AES-256-GCM";
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const CHALLENGE_TTL_MS = 30_000;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hmac(secret, text) {
  return createHmac("sha256", secret).update(text).digest("hex");
}

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("proof secret must contain at least 32 characters");
  }
  return secret;
}

function validSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isLoopback(address = "") {
  const normalized = address.replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function boolText(value) {
  return value ? "true" : "false";
}

export function generatePairingSecret() {
  return randomBytes(32).toString("base64url");
}

export function hostFingerprint() {
  const macs = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces ?? []) {
      if (!entry.internal && entry.mac && entry.mac !== "00:00:00:00:00:00") {
        macs.push(entry.mac.toLowerCase());
      }
    }
  }
  macs.sort();
  return sha256(Buffer.from(JSON.stringify({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    macs
  })));
}

function proofTranscript({
  sessionId,
  challenge,
  sourceHostFingerprint,
  destinationHostFingerprint,
  stateId,
  stateHash,
  generation,
  payloadSha256,
  payloadBytes
}) {
  return [
    TWO_HOST_PROOF_SCHEMA,
    sessionId,
    challenge,
    sourceHostFingerprint,
    destinationHostFingerprint,
    stateId,
    stateHash,
    String(generation),
    payloadSha256,
    String(payloadBytes)
  ].join("|");
}

export function receiptTranscript(receipt) {
  return [
    receipt.schemaVersion,
    receipt.sessionId,
    receipt.stateId,
    receipt.stateHash,
    String(receipt.generation),
    receipt.payloadSha256,
    receipt.receivedSha256,
    String(receipt.payloadBytes),
    String(receipt.ciphertextBytes),
    receipt.sourceHostFingerprint,
    receipt.destinationHostFingerprint,
    boolText(receipt.distinctHostFingerprints),
    boolText(receipt.loopbackObserved),
    boolText(receipt.authenticationVerified),
    boolText(receipt.integrityVerified),
    boolText(receipt.encryptedOnWire),
    receipt.cipher,
    receipt.transportClass,
    boolText(receipt.twoHostNetworkProofSatisfied),
    boolText(receipt.physicalMachineAttestationProven),
    boolText(receipt.productionReadyClaim),
    receipt.observedAt
  ].join("|");
}

function deriveSessionKey(secret, challenge, sessionId) {
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from(challenge, "hex"),
    Buffer.from(`kindred-sdpn-sw06f|${sessionId}`, "utf8"),
    32
  ));
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new RangeError("request body exceeds proof receiver limit");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": body.length,
    "cache-control": "no-store"
  });
  response.end(body);
}

export async function startProofReceiver({
  host = "0.0.0.0",
  port = 47900,
  secret,
  maxBytes = DEFAULT_MAX_BYTES
} = {}) {
  requireSecret(secret);
  positiveInteger(maxBytes, "maxBytes");
  const destinationHostFingerprint = hostFingerprint();
  const sessions = new Map();

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/proof/challenge") {
        const body = await readBody(request, 64 * 1024);
        const hello = JSON.parse(body.toString("utf8"));
        if (hello.schemaVersion !== TWO_HOST_PROOF_SCHEMA) {
          return sendJson(response, 400, { error: "schema_mismatch" });
        }
        if (
          !hello.sourceHostFingerprint ||
          !hello.stateId ||
          !validSha256(hello.stateHash) ||
          !Number.isSafeInteger(hello.generation) ||
          hello.generation < 0 ||
          !validSha256(hello.payloadSha256)
        ) {
          return sendJson(response, 400, { error: "invalid_hello" });
        }
        if (
          !Number.isSafeInteger(hello.payloadBytes) ||
          hello.payloadBytes < 1 ||
          hello.payloadBytes > maxBytes
        ) {
          return sendJson(response, 413, { error: "payload_size_rejected" });
        }

        const sessionId = randomUUID();
        const challenge = randomBytes(32).toString("hex");
        sessions.set(sessionId, {
          challenge,
          createdAt: Date.now(),
          sourceHostFingerprint: hello.sourceHostFingerprint,
          destinationHostFingerprint,
          stateId: hello.stateId,
          stateHash: hello.stateHash.toLowerCase(),
          generation: hello.generation,
          payloadSha256: hello.payloadSha256.toLowerCase(),
          payloadBytes: hello.payloadBytes
        });

        return sendJson(response, 200, {
          schemaVersion: TWO_HOST_PROOF_SCHEMA,
          sessionId,
          challenge,
          destinationHostFingerprint,
          cipher: TWO_HOST_CIPHER,
          expiresInMs: CHALLENGE_TTL_MS
        });
      }

      if (request.method === "POST" && request.url === "/proof/transfer") {
        const sessionId = request.headers["x-kindred-session"];
        const authorization = request.headers["x-kindred-proof-auth"];
        const ivB64 = request.headers["x-kindred-proof-iv"];
        const tagB64 = request.headers["x-kindred-proof-tag"];
        if (
          typeof sessionId !== "string" ||
          typeof authorization !== "string" ||
          typeof ivB64 !== "string" ||
          typeof tagB64 !== "string"
        ) {
          return sendJson(response, 401, { error: "proof_auth_required" });
        }

        const session = sessions.get(sessionId);
        if (!session || Date.now() - session.createdAt > CHALLENGE_TTL_MS) {
          sessions.delete(sessionId);
          return sendJson(response, 401, { error: "proof_session_invalid" });
        }

        const transcript = proofTranscript({ sessionId, ...session });
        const expectedAuth = hmac(secret, transcript);
        if (!safeEqualHex(authorization, expectedAuth)) {
          return sendJson(response, 403, { error: "proof_auth_rejected" });
        }

        const ciphertext = await readBody(request, maxBytes);
        let payload;
        try {
          const key = deriveSessionKey(secret, session.challenge, sessionId);
          const iv = Buffer.from(ivB64, "base64url");
          const tag = Buffer.from(tagB64, "base64url");
          if (iv.length !== 12 || tag.length !== 16) {
            throw new Error("invalid AES-GCM nonce or tag length");
          }
          const decipher = createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAAD(Buffer.from(transcript, "utf8"), {
            plaintextLength: session.payloadBytes
          });
          decipher.setAuthTag(tag);
          payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch {
          sessions.delete(sessionId);
          return sendJson(response, 422, { error: "payload_decryption_failed" });
        }

        const receivedSha256 = sha256(payload);
        const integrityVerified =
          payload.length === session.payloadBytes &&
          receivedSha256 === session.payloadSha256;

        const loopbackObserved = isLoopback(request.socket.remoteAddress);
        const distinctHostFingerprints =
          session.sourceHostFingerprint !== session.destinationHostFingerprint;
        const twoHostNetworkProofSatisfied =
          integrityVerified && distinctHostFingerprints && !loopbackObserved;

        const receiptCore = {
          schemaVersion: TWO_HOST_PROOF_SCHEMA,
          sessionId,
          stateId: session.stateId,
          stateHash: session.stateHash,
          generation: session.generation,
          payloadSha256: session.payloadSha256,
          receivedSha256,
          payloadBytes: payload.length,
          ciphertextBytes: ciphertext.length,
          sourceHostFingerprint: session.sourceHostFingerprint,
          destinationHostFingerprint: session.destinationHostFingerprint,
          distinctHostFingerprints,
          loopbackObserved,
          authenticationVerified: true,
          integrityVerified,
          encryptedOnWire: true,
          cipher: TWO_HOST_CIPHER,
          transportClass: "HTTP_TCP_AES_256_GCM_BUFFERED",
          twoHostNetworkProofSatisfied,
          physicalMachineAttestationProven: false,
          productionReadyClaim: false,
          observedAt: new Date().toISOString()
        };
        const receiptMac = hmac(secret, receiptTranscript(receiptCore));
        sessions.delete(sessionId);

        return sendJson(response, integrityVerified ? 200 : 422, {
          ...receiptCore,
          receiptMac
        });
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      sendJson(response, 400, {
        error: "proof_protocol_error",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("proof receiver did not expose a TCP address");
  }

  return {
    server,
    host: address.address,
    port: address.port,
    destinationHostFingerprint,
    cipher: TWO_HOST_CIPHER,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

export async function sendTwoHostProof({
  host,
  port,
  secret,
  canonicalPayload,
  stateId,
  stateHash,
  generation,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  requireSecret(secret);
  positiveInteger(port, "port");
  positiveInteger(timeoutMs, "timeoutMs");
  if (!stateId) throw new Error("stateId is required");
  if (!validSha256(stateHash)) throw new Error("stateHash must be a SHA-256 hex digest");
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("generation must be a non-negative safe integer");
  }

  const sourceHostFingerprint = hostFingerprint();
  const payload = Buffer.isBuffer(canonicalPayload)
    ? canonicalPayload
    : Buffer.from(canonicalPayload);
  if (payload.length < 1) throw new Error("canonical payload must not be empty");

  const payloadSha256 = sha256(payload);
  if (payloadSha256 !== stateHash.toLowerCase()) {
    throw new Error("canonical payload SHA-256 must equal the Kindred state hash");
  }

  const challengeResponse = await fetch(`http://${host}:${port}/proof/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: TWO_HOST_PROOF_SCHEMA,
      sourceHostFingerprint,
      stateId,
      stateHash: stateHash.toLowerCase(),
      generation,
      payloadSha256,
      payloadBytes: payload.length
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!challengeResponse.ok) {
    throw new Error(`proof challenge failed: ${challengeResponse.status}`);
  }
  const challenge = await challengeResponse.json();
  if (challenge.cipher !== TWO_HOST_CIPHER) {
    throw new Error("proof receiver cipher mismatch");
  }

  const transcript = proofTranscript({
    sessionId: challenge.sessionId,
    challenge: challenge.challenge,
    sourceHostFingerprint,
    destinationHostFingerprint: challenge.destinationHostFingerprint,
    stateId,
    stateHash: stateHash.toLowerCase(),
    generation,
    payloadSha256,
    payloadBytes: payload.length
  });
  const authorization = hmac(secret, transcript);

  const key = deriveSessionKey(secret, challenge.challenge, challenge.sessionId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(transcript, "utf8"), { plaintextLength: payload.length });
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();

  const transferResponse = await fetch(`http://${host}:${port}/proof/transfer`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-kindred-session": challenge.sessionId,
      "x-kindred-proof-auth": authorization,
      "x-kindred-proof-iv": iv.toString("base64url"),
      "x-kindred-proof-tag": tag.toString("base64url")
    },
    body: ciphertext,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const receipt = await transferResponse.json();
  if (!transferResponse.ok) {
    throw new Error(`proof transfer failed: ${transferResponse.status} ${JSON.stringify(receipt)}`);
  }

  const receivedMac = receipt.receiptMac;
  const receiptCore = { ...receipt };
  delete receiptCore.receiptMac;
  const expectedMac = hmac(secret, receiptTranscript(receiptCore));
  if (!safeEqualHex(receivedMac, expectedMac)) {
    throw new Error("proof receipt MAC verification failed");
  }
  if (
    !receipt.integrityVerified ||
    !receipt.encryptedOnWire ||
    receipt.cipher !== TWO_HOST_CIPHER ||
    receipt.receivedSha256 !== payloadSha256 ||
    receipt.stateId !== stateId ||
    receipt.stateHash !== stateHash.toLowerCase() ||
    receipt.generation !== generation
  ) {
    throw new Error("proof receipt identity, encryption, or integrity verification failed");
  }

  return receipt;
}
