// Kindred Labs SDPN — split-plane, reference-only Tesseract materialization candidate.
// The signed control plane coordinates two ports. The destination reads only its OWN
// pre-existing state. Nothing in this module sends object bytes over a network.
// This is not a global carrier or proof of teleportation of unknown information.
import { randomBytes } from 'node:crypto';
import { canonicalBytes, digest, exactFields, verifyEnvelope, verifyPeerRecord } from './native-port-identity.mjs';
import { NativeSessionPolicy, validateAdapterDescriptor } from './native-session.mjs';

export const STATE_MANIFEST_SCHEMA = 'kindred.sdpn.tesseract-reference-manifest.v1';
export const STATE_COORDINATION_SCHEMA = 'kindred.sdpn.tesseract-coordinate-offer.v1';
export const STATE_RECEIPT_SCHEMA = 'kindred.sdpn.tesseract-local-reconstruction-receipt.v1';
const MAX_BYTES = 4 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const MAX_CHUNKS = MAX_BYTES / CHUNK_BYTES;
const HEX = /^[a-f0-9]{64}$/;
const sessionPattern = /^[a-f0-9]{32}$/;
const fields = ['schema', 'totalBytes', 'sha256', 'chunks'];
const offerFields = ['schema', 'sessionId', 'fromPort', 'toPort', 'issuedAt', 'expiresAt',
  'manifest', 'manifestSha256', 'adapter'];
const receiptFields = ['schema', 'sessionId', 'fromPort', 'toPort', 'manifestSha256',
  'stateSha256', 'receivedBytes', 'reconstructedSha256', 'mode',
  'payloadBytesTransferredByProtocol', 'destinationOnlyState', 'issuedAt'];

function validateTime(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid coordination time');
}
function isBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Binary state required');
  if (bytes.byteLength > MAX_BYTES) throw new Error('Tesseract candidate size cap exceeded');
}
function canonicalCopy(value) { return JSON.parse(canonicalBytes(value).toString('utf8')); }
function ownerPolicy(policy) {
  if (Object.getPrototypeOf(policy) !== NativeSessionPolicy.prototype) {
    throw new Error('Independent deterministic owner policy required');
  }
}
function routeFreeAdapter(adapter) {
  validateAdapterDescriptor(adapter);
  if (adapter.underlyingIp !== false || adapter.underlyingRouting !== false) {
    throw new Error('Routed/IP adapter rejected in strictly route-free mode');
  }
}
export function verifyReferenceManifest(manifest) {
  exactFields(manifest, fields);
  if (manifest.schema !== STATE_MANIFEST_SCHEMA ||
      !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 ||
      manifest.totalBytes > MAX_BYTES || typeof manifest.sha256 !== 'string' ||
      !HEX.test(manifest.sha256) || !Array.isArray(manifest.chunks) ||
      manifest.chunks.length > MAX_CHUNKS ||
      manifest.chunks.length !== Math.ceil(manifest.totalBytes / CHUNK_BYTES)) {
    throw new Error('Tesseract manifest structure rejected');
  }
  let length = 0;
  for (let i = 0; i < manifest.chunks.length; i++) {
    const item = manifest.chunks[i];
    exactFields(item, ['sha256', 'bytes']);
    if (typeof item.sha256 !== 'string' || !HEX.test(item.sha256) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 ||
        item.bytes > CHUNK_BYTES ||
        (i < manifest.chunks.length - 1 && item.bytes !== CHUNK_BYTES)) {
      throw new Error('Tesseract chunk descriptor rejected');
    }
    length += item.bytes;
  }
  if (length !== manifest.totalBytes || (length === 0 && manifest.sha256 !== digest(Buffer.alloc(0)))) {
    throw new Error('Tesseract manifest total size/digest rejected');
  }
  return Object.freeze(canonicalCopy(manifest));
}

// Returns an origin reference manifest and a SEPARATE local chunk map. Raw bytes
// never appear in a manifest or a coordination envelope.
export function prepareReferenceState(bytes) {
  isBytes(bytes);
  const input = Buffer.from(bytes);
  const chunks = [];
  const localChunks = new Map();
  for (let offset = 0; offset < input.length; offset += CHUNK_BYTES) {
    const chunk = Buffer.from(input.subarray(offset, offset + CHUNK_BYTES));
    const sha256 = digest(chunk);
    chunks.push({ sha256, bytes: chunk.length });
    localChunks.set(sha256, chunk);
  }
  const manifest = verifyReferenceManifest({
    schema: STATE_MANIFEST_SCHEMA, totalBytes: input.length,
    sha256: digest(input), chunks
  });
  return Object.freeze({ manifest, localChunks });
}

// This is the destination's own Tesseract-compatible state resolver boundary.
// Inject original ZPS/Tesseract storage through resolveLocalChunk; no network fallback.
export async function reconstructFromLocalState(manifest, resolveLocalChunk) {
  const valid = verifyReferenceManifest(manifest);
  if (typeof resolveLocalChunk !== 'function') throw new TypeError('Local chunk resolver required');
  const bytes = Buffer.alloc(valid.totalBytes);
  let offset = 0;
  for (const chunk of valid.chunks) {
    const found = await resolveLocalChunk(chunk.sha256);
    if (!(found instanceof Uint8Array) || found.byteLength !== chunk.bytes ||
        digest(found) !== chunk.sha256) {
      bytes.fill(0);
      throw new Error('Destination local Tesseract state missing or corrupted');
    }
    Buffer.from(found).copy(bytes, offset);
    offset += chunk.bytes;
  }
  if (digest(bytes) !== valid.sha256) {
    bytes.fill(0);
    throw new Error('Destination Tesseract exact reconstruction SHA-256 mismatch');
  }
  return bytes;
}

function checkOffer(offer, originRecord, destinationId, adapter, now) {
  validateTime(now);
  const source = verifyPeerRecord(originRecord, now);
  if (!source.capabilities.includes('native.materialize.v1')) {
    throw new Error('Origin native materialization capability not advertised');
  }
  const body = verifyEnvelope(offer, source.portId, source.publicKey);
  exactFields(body, offerFields);
  if (body.schema !== STATE_COORDINATION_SCHEMA ||
      !sessionPattern.test(body.sessionId) ||
      body.fromPort !== source.portId || body.toPort !== destinationId ||
      !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt) ||
      body.issuedAt > now || body.expiresAt <= now ||
      body.expiresAt - body.issuedAt > 30_000 ||
      body.manifestSha256 !== digest(canonicalBytes(body.manifest)) ||
      digest(canonicalBytes(body.adapter)) !== digest(canonicalBytes(adapter))) {
    throw new Error('Coordination offer identity, scope, freshness or adapter rejected');
  }
  routeFreeAdapter(body.adapter);
  verifyReferenceManifest(body.manifest);
  return body;
}

export function createReferenceCoordinationOffer({
  originIdentity, destinationRecord, manifest, policy, adapter, now = Date.now()
}) {
  validateTime(now);
  ownerPolicy(policy);
  routeFreeAdapter(adapter);
  const destination = verifyPeerRecord(destinationRecord, now);
  if (!destination.capabilities.includes('native.materialize.v1')) {
    throw new Error('Destination Tesseract capability not advertised');
  }
  const validated = verifyReferenceManifest(manifest);
  policy.authorize(destination.portId,
    { stateSha256: validated.sha256, maxBytes: Math.max(1, validated.totalBytes) }, adapter);
  const body = { schema: STATE_COORDINATION_SCHEMA,
    sessionId: randomBytes(16).toString('hex'), fromPort: originIdentity.id,
    toPort: destination.portId, issuedAt: now, expiresAt: now + 30_000,
    manifest: validated, manifestSha256: digest(canonicalBytes(validated)),
    adapter };
  const offer = originIdentity.sign(body);
  if (canonicalBytes(offer).length > 64 * 1024) throw new Error('Control-only envelope size cap exceeded');
  // Critically: no payload bytes or location-routing fields in this signed object.
  return offer;
}

export async function fulfillReferenceCoordinationOffer({
  destinationIdentity, offer, originRecord, policy, adapter,
  resolveLocalChunk, now = Date.now()
}) {
  ownerPolicy(policy);
  routeFreeAdapter(adapter);
  const body = checkOffer(offer, originRecord, destinationIdentity.id, adapter, now);
  const state = { stateSha256: body.manifest.sha256,
    maxBytes: Math.max(1, body.manifest.totalBytes) };
  policy.authorize(body.fromPort, state, adapter);
  policy.consume(body.sessionId, body.expiresAt, now); // Reject duplicate offers.
  const reconstructed = await reconstructFromLocalState(body.manifest, resolveLocalChunk);
  const receipt = destinationIdentity.sign({
    schema: STATE_RECEIPT_SCHEMA, sessionId: body.sessionId,
    fromPort: destinationIdentity.id, toPort: body.fromPort,
    manifestSha256: body.manifestSha256,
    stateSha256: body.manifest.sha256, receivedBytes: reconstructed.length,
    reconstructedSha256: digest(reconstructed),
    mode: 'DESTINATION_PREEXISTING_STATE',
    payloadBytesTransferredByProtocol: 0,
    destinationOnlyState: true, issuedAt: now
  });
  return Object.freeze({ reconstructed, receipt,
    coordinationOnly: true, newlyDeliveredPayloadBytes: 0,
    globallyRoutelessTransferProven: false });
}

export function verifyReferenceReconstructionReceipt({
  offer, receipt, destinationRecord, now = Date.now()
}) {
  validateTime(now);
  const destination = verifyPeerRecord(destinationRecord, now);
  const body = verifyEnvelope(receipt, destination.portId, destination.publicKey);
  exactFields(body, receiptFields);
  const request = offer?.body;
  if (!request || request.schema !== STATE_COORDINATION_SCHEMA ||
      body.schema !== STATE_RECEIPT_SCHEMA ||
      body.fromPort !== destination.portId || body.toPort !== request.fromPort ||
      body.sessionId !== request.sessionId ||
      body.manifestSha256 !== request.manifestSha256 ||
      body.stateSha256 !== request.manifest.sha256 ||
      body.reconstructedSha256 !== request.manifest.sha256 ||
      body.receivedBytes !== request.manifest.totalBytes ||
      body.mode !== 'DESTINATION_PREEXISTING_STATE' ||
      body.payloadBytesTransferredByProtocol !== 0 ||
      body.destinationOnlyState !== true ||
      !Number.isSafeInteger(body.issuedAt) ||
      body.issuedAt < request.issuedAt || body.issuedAt > now ||
      now >= request.expiresAt) {
    throw new Error('Destination reconstruction receipt binding rejected');
  }
  return Object.freeze({ exactReconstructionAcknowledged: true,
    receiptSigner: destination.portId, stateSha256: body.stateSha256,
    bytes: body.receivedBytes, deliveryMode: body.mode,
    transmittedPayloadBytesAccordingToReceipt: 0,
    globallyRoutelessTransferProven: false });
}
