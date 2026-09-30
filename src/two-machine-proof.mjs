import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";

export const TWO_HOST_PROOF_SCHEMA = "kindred.sdpn.two-host-proof.v1";
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
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("proof secret must contain at least 16 characters");
  }
  return secret;
}

function isLoopback(address = "") {
  const normalized = address.replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
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

function transcript({
  sessionId,
  challenge,
  sourceHostFingerprint,
  destinationHostFingerprint,
  payloadSha256,
  payloadBytes
}) {
  return [
    TWO_HOST_PROOF_SCHEMA,
    sessionId,
    challenge,
    sourceHostFingerprint,
    destinationHostFingerprint,
    payloadSha256,
    String(payloadBytes)
  ].join("|");
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
  maxBytes = DEFAULT_MAX_BYTES,
  destinationHostFingerprint = hostFingerprint()
} = {}) {
  requireSecret(secret);
  positiveInteger(maxBytes, "maxBytes");
  const sessions = new Map();

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/proof/challenge") {
        const body = await readBody(request, 64 * 1024);
        const hello = JSON.parse(body.toString("utf8"));
        if (hello.schemaVersion !== TWO_HOST_PROOF_SCHEMA) {
          return sendJson(response, 400, { error: "schema_mismatch" });
        }
        if (!hello.sourceHostFingerprint || !hello.payloadSha256 || !hello.payloadBytes) {
          return sendJson(response, 400, { error: "invalid_hello" });
        }
        if (!Number.isSafeInteger(hello.payloadBytes) || hello.payloadBytes < 1 || hello.payloadBytes > maxBytes) {
          return sendJson(response, 413, { error: "payload_size_rejected" });
        }

        const sessionId = randomUUID();
        const challenge = randomBytes(32).toString("hex");
        sessions.set(sessionId, {
          challenge,
          createdAt: Date.now(),
          sourceHostFingerprint: hello.sourceHostFingerprint,
          destinationHostFingerprint,
          stateId: hello.stateId ?? "",
          stateHash: hello.stateHash ?? "",
          payloadSha256: hello.payloadSha256,
          payloadBytes: hello.payloadBytes
        });

        return sendJson(response, 200, {
          schemaVersion: TWO_HOST_PROOF_SCHEMA,
          sessionId,
          challenge,
          destinationHostFingerprint,
          expiresInMs: CHALLENGE_TTL_MS
        });
      }

      if (request.method === "POST" && request.url === "/proof/transfer") {
        const sessionId = request.headers["x-kindred-session"];
        const authorization = request.headers["x-kindred-proof-auth"];
        if (typeof sessionId !== "string" || typeof authorization !== "string") {
          return sendJson(response, 401, { error: "proof_auth_required" });
        }
        const session = sessions.get(sessionId);
        if (!session || Date.now() - session.createdAt > CHALLENGE_TTL_MS) {
          sessions.delete(sessionId);
          return sendJson(response, 401, { error: "proof_session_invalid" });
        }

        const expectedAuth = hmac(secret, transcript({ sessionId, ...session }));
        if (!safeEqualHex(authorization, expectedAuth)) {
          return sendJson(response, 403, { error: "proof_auth_rejected" });
        }

        const payload = await readBody(request, maxBytes);
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
          payloadSha256: session.payloadSha256,
          receivedSha256,
          payloadBytes: payload.length,
          sourceHostFingerprint: session.sourceHostFingerprint,
          destinationHostFingerprint: session.destinationHostFingerprint,
          distinctHostFingerprints,
          loopbackObserved,
          authenticationVerified: true,
          integrityVerified,
          transportClass: "HTTP_TCP_BUFFERED",
          twoHostNetworkProofSatisfied,
          physicalMachineAttestationProven: false,
          productionReadyClaim: false,
          observedAt: new Date().toISOString()
        };
        const receiptMac = hmac(secret, JSON.stringify(receiptCore));
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
  sourceHostFingerprint = hostFingerprint(),
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  requireSecret(secret);
  positiveInteger(port, "port");
  positiveInteger(timeoutMs, "timeoutMs");
  const payload = Buffer.isBuffer(canonicalPayload)
    ? canonicalPayload
    : Buffer.from(canonicalPayload);
  if (payload.length < 1) throw new Error("canonical payload must not be empty");

  const payloadSha256 = sha256(payload);
  const challengeResponse = await fetch(`http://${host}:${port}/proof/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: TWO_HOST_PROOF_SCHEMA,
      sourceHostFingerprint,
      stateId,
      stateHash,
      payloadSha256,
      payloadBytes: payload.length
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!challengeResponse.ok) {
    throw new Error(`proof challenge failed: ${challengeResponse.status}`);
  }
  const challenge = await challengeResponse.json();

  const authorization = hmac(secret, transcript({
    sessionId: challenge.sessionId,
    challenge: challenge.challenge,
    sourceHostFingerprint,
    destinationHostFingerprint: challenge.destinationHostFingerprint,
    payloadSha256,
    payloadBytes: payload.length
  }));

  const transferResponse = await fetch(`http://${host}:${port}/proof/transfer`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-kindred-session": challenge.sessionId,
      "x-kindred-proof-auth": authorization
    },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const receipt = await transferResponse.json();
  if (!transferResponse.ok) {
    throw new Error(`proof transfer failed: ${transferResponse.status} ${JSON.stringify(receipt)}`);
  }

  const receivedMac = receipt.receiptMac;
  const receiptCore = { ...receipt };
  delete receiptCore.receiptMac;
  const expectedMac = hmac(secret, JSON.stringify(receiptCore));
  if (!safeEqualHex(receivedMac, expectedMac)) {
    throw new Error("proof receipt MAC verification failed");
  }
  if (!receipt.integrityVerified || receipt.receivedSha256 !== payloadSha256) {
    throw new Error("proof receipt integrity verification failed");
  }

  return receipt;
}
