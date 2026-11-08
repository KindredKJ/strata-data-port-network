// Kindred Labs SDPN — Tesseract MORPH/1: copy/insert state transformation.
// Coordination is an Ed25519-signed digest-only instruction; genuinely new bytes
// travel separately inside an authenticated AES-GCM native Port session.
// The destination MUST already possess and verify the exact base state.
import { canonicalBytes, digest, exactFields, verifyEnvelope, verifyPeerRecord } from './native-port-identity.mjs';
import { validateAdapterDescriptor } from './native-session.mjs';
import { prepareCdcState } from './tesseract-cdc-delta.mjs';
import { DurablePortChunkStore } from './zps-durable-cas.mjs';

export const MORPH_SCHEMA = 'kindred.sdpn.tesseract.morph.single-splice.v1';
export const MORPH_COORD_SCHEMA = 'kindred.sdpn.tesseract.morph.coordinate.v1';
export const MORPH_RECEIPT_SCHEMA = 'kindred.sdpn.tesseract.morph.receipt.v1';
const MAX_OBJECT = 4 * 1024 * 1024, MAX_INSERT = 256 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const PORT = /^strata:port:ed25519:[a-f0-9]{64}$/;
const MANIFEST_FIELDS = ['schema', 'baseSha256', 'baseBytes', 'targetSha256',
  'targetBytes', 'prefixBytes', 'suffixBytes', 'insertSha256', 'insertBytes'];
const COORD_FIELDS = ['schema', 'originPort', 'destinationPort', 'issuedAt',
  'expiresAt', 'manifest', 'manifestSha256'];
const RECEIPT_FIELDS = ['schema', 'originPort', 'destinationPort', 'sessionId',
  'coordinateSha256', 'baseSha256', 'targetSha256', 'reconstructedBytes',
  'newLogicalPayloadBytes', 'encryptedCiphertextBytes', 'localStatePublished',
  'exactReconstructionVerified', 'physicalRouteFreeVerified', 'globalReachVerified',
  'issuedAt'];
function isBoundedBytes(value) {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_OBJECT) {
    throw new Error('Tesseract MORPH/1 binary input must be at most 4 MiB');
  }
}
function signedBody(body) { return JSON.parse(canonicalBytes(body).toString('utf8')); }
function time(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Tesseract MORPH invalid time');
}
export function verifyMorphManifest(manifest) {
  exactFields(manifest, MANIFEST_FIELDS);
  if (manifest.schema !== MORPH_SCHEMA ||
      !HASH.test(manifest.baseSha256) || !HASH.test(manifest.targetSha256) ||
      !HASH.test(manifest.insertSha256) ||
      !Number.isSafeInteger(manifest.baseBytes) ||
      !Number.isSafeInteger(manifest.targetBytes) ||
      !Number.isSafeInteger(manifest.prefixBytes) ||
      !Number.isSafeInteger(manifest.suffixBytes) ||
      !Number.isSafeInteger(manifest.insertBytes) ||
      manifest.baseBytes < 0 || manifest.baseBytes > MAX_OBJECT ||
      manifest.targetBytes < 0 || manifest.targetBytes > MAX_OBJECT ||
      manifest.prefixBytes < 0 || manifest.suffixBytes < 0 ||
      manifest.insertBytes < 0 || manifest.insertBytes > MAX_INSERT ||
      manifest.prefixBytes + manifest.suffixBytes > manifest.baseBytes ||
      manifest.prefixBytes + manifest.insertBytes + manifest.suffixBytes !== manifest.targetBytes ||
      (manifest.insertBytes === 0 && manifest.insertSha256 !== digest(Buffer.alloc(0)))) {
    throw new Error('Tesseract MORPH schema, sizes or digest rejected');
  }
  return Object.freeze(signedBody(manifest));
}
export function prepareMorphDelta(baseBytes, targetBytes) {
  isBoundedBytes(baseBytes);
  isBoundedBytes(targetBytes);
  const base = Buffer.from(baseBytes), target = Buffer.from(targetBytes);
  let prefix = 0;
  while (prefix < Math.min(base.length, target.length) && base[prefix] === target[prefix]) prefix++;
  let suffix = 0;
  while (suffix < base.length - prefix && suffix < target.length - prefix &&
      base[base.length - suffix - 1] === target[target.length - suffix - 1]) suffix++;
  const inserted = Buffer.from(target.subarray(prefix, target.length - suffix));
  if (inserted.length > MAX_INSERT) {
    throw new Error('MORPH delta too large; fall back to CDC/1 missing-chunk delivery');
  }
  const manifest = verifyMorphManifest({
    schema: MORPH_SCHEMA, baseSha256: digest(base), baseBytes: base.length,
    targetSha256: digest(target), targetBytes: target.length,
    prefixBytes: prefix, suffixBytes: suffix,
    insertSha256: digest(inserted), insertBytes: inserted.length
  });
  return Object.freeze({ manifest, insertedBytes: inserted });
}
export function signMorphCoordinate({
  originIdentity, destinationPortId, manifest, now = Date.now(), ttlMs = 30_000
}) {
  time(now);
  const valid = verifyMorphManifest(manifest);
  if (!originIdentity || typeof originIdentity.sign !== 'function' ||
      !PORT.test(originIdentity.id) || !PORT.test(destinationPortId) ||
      originIdentity.id === destinationPortId ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 30_000 ||
      now + ttlMs > Number.MAX_SAFE_INTEGER) {
    throw new Error('MORPH independent Port identities and expiration required');
  }
  return originIdentity.sign({
    schema: MORPH_COORD_SCHEMA, originPort: originIdentity.id,
    destinationPort: destinationPortId, issuedAt: now, expiresAt: now + ttlMs,
    manifest: valid, manifestSha256: digest(canonicalBytes(valid))
  });
}
export function verifyMorphCoordinate({
  coordinate, originRecord, expectedOriginPortId, expectedDestinationPortId, now = Date.now()
}) {
  time(now);
  const record = verifyPeerRecord(originRecord, now, expectedOriginPortId);
  const body = verifyEnvelope(coordinate, record.portId, record.publicKey);
  exactFields(body, COORD_FIELDS);
  if (body.schema !== MORPH_COORD_SCHEMA ||
      body.originPort !== expectedOriginPortId ||
      body.destinationPort !== expectedDestinationPortId ||
      !PORT.test(body.destinationPort) ||
      body.destinationPort === body.originPort ||
      !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt) ||
      body.issuedAt > now || now >= body.expiresAt ||
      body.expiresAt - body.issuedAt > 30_000 ||
      body.manifestSha256 !== digest(canonicalBytes(body.manifest))) {
    throw new Error('Tesseract MORPH signed coordinate expired, mismatched or altered');
  }
  return Object.freeze({ ...body, manifest: verifyMorphManifest(body.manifest) });
}
export function reconstructMorphLocally(manifest, baseBytes, insertedBytes) {
  const valid = verifyMorphManifest(manifest);
  isBoundedBytes(baseBytes);
  if (!(insertedBytes instanceof Uint8Array)) throw new Error('MORPH new information missing');
  if (baseBytes.length !== valid.baseBytes || digest(baseBytes) !== valid.baseSha256) {
    throw new Error('MORPH destination has no matching verified base state');
  }
  if (insertedBytes.length !== valid.insertBytes ||
      digest(insertedBytes) !== valid.insertSha256) {
    throw new Error('MORPH missing inserted information or corrupt payload');
  }
  const out = Buffer.alloc(valid.targetBytes);
  Buffer.from(baseBytes).copy(out, 0, 0, valid.prefixBytes);
  Buffer.from(insertedBytes).copy(out, valid.prefixBytes);
  Buffer.from(baseBytes).copy(out, valid.prefixBytes + valid.insertBytes,
    baseBytes.length - valid.suffixBytes);
  if (digest(out) !== valid.targetSha256) {
    out.fill(0);
    throw new Error('MORPH destination exact SHA-256 reconstruction failed');
  }
  return out;
}
function strictNativeSession({
  session, signedSessionOffer, coordinate, originRecord,
  expectedOriginPortId, expectedDestinationPortId, now, role
}) {
  const body = verifyMorphCoordinate({
    coordinate, originRecord, expectedOriginPortId, expectedDestinationPortId, now
  });
  const origin = verifyPeerRecord(originRecord, now, expectedOriginPortId);
  const offer = verifyEnvelope(signedSessionOffer, origin.portId, origin.publicKey);
  if (!session || typeof session.seal !== 'function' ||
      typeof session.open !== 'function' ||
      offer.schema !== 'kindred.sdpn.session-offer.v1' ||
      offer.sessionId !== session.id ||
      offer.fromPort !== body.originPort || offer.toPort !== body.destinationPort ||
      offer.scope?.stateSha256 !== body.manifest.targetSha256 ||
      !Number.isSafeInteger(offer.scope?.maxBytes) ||
      offer.scope.maxBytes < Math.max(body.manifest.insertBytes, 1) ||
      (role === 'origin' && (session.localPort !== body.originPort ||
        session.peerPort !== body.destinationPort)) ||
      (role === 'destination' && (session.localPort !== body.destinationPort ||
        session.peerPort !== body.originPort))) {
    throw new Error('MORPH encrypted session not scoped to signed target and Ports');
  }
  validateAdapterDescriptor(session.adapter);
  validateAdapterDescriptor(offer.adapter);
  if (session.adapter.underlyingIp !== false ||
      session.adapter.underlyingRouting !== false ||
      offer.adapter.underlyingIp !== false ||
      offer.adapter.underlyingRouting !== false ||
      digest(canonicalBytes(offer.adapter)) !== digest(canonicalBytes(session.adapter))) {
    throw new Error('MORPH STRICT rejects IP/routed or mismatched adapter');
  }
  return body;
}
export function sealMorphInsert({
  sourceSession, signedSessionOffer, coordinate, originRecord,
  insertedBytes, now = Date.now()
}) {
  const body = strictNativeSession({
    session: sourceSession, signedSessionOffer, coordinate, originRecord,
    expectedOriginPortId: sourceSession?.localPort,
    expectedDestinationPortId: sourceSession?.peerPort,
    now, role: 'origin'
  });
  if (!(insertedBytes instanceof Uint8Array) ||
      insertedBytes.length !== body.manifest.insertBytes ||
      digest(insertedBytes) !== body.manifest.insertSha256) {
    throw new Error('MORPH source inserted bytes do not match signed digest');
  }
  return sourceSession.seal(Buffer.from(insertedBytes), now);
}
export async function materializeMorphNative({
  coordinate, originRecord, signedSessionOffer, destinationIdentity,
  destinationSession, destinationStore, encryptedInsertFrame, now = Date.now()
}) {
  if (!(destinationStore instanceof DurablePortChunkStore) ||
      destinationStore.portId !== destinationIdentity?.id) {
    throw new Error('MORPH destination ZPS ownership mismatch');
  }
  const body = strictNativeSession({
    session: destinationSession, signedSessionOffer, coordinate, originRecord,
    expectedOriginPortId: destinationSession?.peerPort,
    expectedDestinationPortId: destinationIdentity.id, now, role: 'destination'
  });
  const base = await destinationStore.readPublishedState(body.manifest.baseSha256);
  if (!base) throw new Error('MORPH destination verified base state unavailable');
  if (!encryptedInsertFrame) throw new Error('MORPH encrypted insertion frame required');
  const inserted = destinationSession.open(encryptedInsertFrame, now);
  let output;
  try {
    output = reconstructMorphLocally(body.manifest, base, inserted);
    const published = await destinationStore.importPrepared(prepareCdcState(output));
    const signedReceipt = destinationIdentity.sign({
      schema: MORPH_RECEIPT_SCHEMA, originPort: body.originPort,
      destinationPort: body.destinationPort, sessionId: destinationSession.id,
      coordinateSha256: digest(canonicalBytes(coordinate)),
      baseSha256: body.manifest.baseSha256, targetSha256: body.manifest.targetSha256,
      reconstructedBytes: output.length, newLogicalPayloadBytes: inserted.length,
      encryptedCiphertextBytes: Buffer.from(encryptedInsertFrame.ciphertext, 'base64').length,
      localStatePublished: published.published === true,
      exactReconstructionVerified: true,
      physicalRouteFreeVerified: false, globalReachVerified: false, issuedAt: now
    });
    return Object.freeze({
      reconstructed: output, published, receipt: signedReceipt,
      exactReconstructionVerified: true,
      newlyDeliveredLogicalBytes: inserted.length,
      physicalRouteFreeVerified: false,
      globalReachVerified: false
    });
  } finally {
    base.fill(0);
    inserted.fill(0);
  }
}
export function verifyMorphReceipt({
  receipt, coordinate, signedSessionOffer, originRecord, destinationRecord,
  expectedOriginPortId, expectedDestinationPortId, now = Date.now()
}) {
  time(now);
  const body = receipt?.body;
  exactFields(body, RECEIPT_FIELDS);
  if (!Number.isSafeInteger(body.issuedAt) || body.issuedAt > now) {
    throw new Error('MORPH receipt time invalid');
  }
  // Verify against the receipt's historical time for offline audit.
  const original = verifyMorphCoordinate({
    coordinate, originRecord, expectedOriginPortId, expectedDestinationPortId,
    now: body.issuedAt
  });
  const source = verifyPeerRecord(originRecord, body.issuedAt, expectedOriginPortId);
  const offer = verifyEnvelope(signedSessionOffer, source.portId, source.publicKey);
  validateAdapterDescriptor(offer.adapter);
  if (offer.schema !== 'kindred.sdpn.session-offer.v1' ||
      offer.sessionId !== body.sessionId ||
      offer.fromPort !== expectedOriginPortId ||
      offer.toPort !== expectedDestinationPortId ||
      offer.scope?.stateSha256 !== original.manifest.targetSha256 ||
      offer.adapter.underlyingIp !== false ||
      offer.adapter.underlyingRouting !== false) {
    throw new Error('MORPH receipt not bound to signed native session or route-free adapter');
  }
  const dest = verifyPeerRecord(destinationRecord, body.issuedAt, expectedDestinationPortId);
  const signed = verifyEnvelope(receipt, dest.portId, dest.publicKey);
  if (signed.schema !== MORPH_RECEIPT_SCHEMA ||
      signed.originPort !== expectedOriginPortId ||
      signed.destinationPort !== expectedDestinationPortId ||
      signed.coordinateSha256 !== digest(canonicalBytes(coordinate)) ||
      signed.baseSha256 !== original.manifest.baseSha256 ||
      signed.targetSha256 !== original.manifest.targetSha256 ||
      signed.reconstructedBytes !== original.manifest.targetBytes ||
      signed.newLogicalPayloadBytes !== original.manifest.insertBytes ||
      !Number.isSafeInteger(signed.encryptedCiphertextBytes) ||
      signed.encryptedCiphertextBytes !== original.manifest.insertBytes ||
      typeof signed.sessionId !== 'string' ||
      !/^[a-f0-9]{32}$/.test(signed.sessionId) ||
      signed.localStatePublished !== true ||
      signed.exactReconstructionVerified !== true ||
      signed.physicalRouteFreeVerified !== false ||
      signed.globalReachVerified !== false) {
    throw new Error('MORPH destination signed receipt does not match actual state');
  }
  return Object.freeze({
    destinationSignatureVerified: true,
    exactStateAcknowledged: true,
    stateSha256: signed.targetSha256,
    verifiedNewLogicalBytes: signed.newLogicalPayloadBytes,
    globalRouteFreeTransportProven: false,
    independentlyVerifiedPhysicalHosts: false
  });
}
