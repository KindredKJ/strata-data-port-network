// Kindred Labs SDPN — destination-owned, signed ZPS/CDC materialization attestations.
// Validates software-observed reconstruction and store publication. It does not
// attest distinct physical hosts, carrier reach, independent witnesses, or power loss.
import { canonicalBytes, digest, exactFields, verifyEnvelope, verifyPeerRecord } from './native-port-identity.mjs';
import { verifyCdcManifest } from './tesseract-cdc-delta.mjs';
import { reconstructCdcOverNativeSession } from './tesseract-cdc-native-session.mjs';
import { DurablePortChunkStore } from './zps-durable-cas.mjs';
import { validateAdapterDescriptor } from './native-session.mjs';

export const ZPS_RECEIPT_SCHEMA = 'kindred.sdpn.zps.cdc-materialization-receipt.v1';
const RECEIPT_FIELDS = ['schema', 'sessionId', 'originPort', 'destinationPort',
  'stateSha256', 'stateBytes', 'publishedStateSha256', 'atRestEncrypted',
  'encryptedRequestCount', 'newlyDeliveredUniqueBytes', 'reusedPayloadBytes',
  'requestCiphertextBytes', 'responseCiphertextBytes', 'declaredAdapter',
  'exactReconstructionVerified', 'durableStateIndexPublished',
  'physicalPowerLossTested', 'independentPhysicalHostSeparationProven',
  'physicalRouteFreeTransportVerified', 'globalAvailabilityVerified', 'issuedAt'];
const unsigned = obj => JSON.parse(canonicalBytes(obj).toString('utf8'));

function knownSessionOffer(offer, originRecord, expectedOrigin, expectedDestination, stateSha) {
  const origin = verifyPeerRecord(originRecord, offer?.body?.issuedAt, expectedOrigin);
  const signed = verifyEnvelope(offer, origin.portId, origin.publicKey);
  if (signed.schema !== 'kindred.sdpn.session-offer.v1' ||
      signed.fromPort !== expectedOrigin || signed.toPort !== expectedDestination ||
      signed.scope?.stateSha256 !== stateSha ||
      !Number.isSafeInteger(signed.issuedAt) || !Number.isSafeInteger(signed.expiresAt) ||
      signed.expiresAt - signed.issuedAt < 1 ||
      signed.expiresAt - signed.issuedAt > 30_000) {
    throw new Error('Signed ZPS session/Port scope rejected');
  }
  validateAdapterDescriptor(signed.adapter);
  if (signed.adapter.underlyingIp !== false || signed.adapter.underlyingRouting !== false) {
    throw new Error('ZPS materialization strictly forbids routed/IP adapter');
  }
  return signed;
}

export function signZpsMaterializationReceipt({
  destinationIdentity, signedSessionOffer, originRecord,
  verifiedResult, published, now = Date.now()
}) {
  if (!destinationIdentity || typeof destinationIdentity.sign !== 'function' ||
      typeof destinationIdentity.id !== 'string') {
    throw new Error('Destination Port private signing identity required');
  }
  const result = verifiedResult;
  if (!result || result.exactReconstructionVerified !== true ||
      result.signedCdcSessionEstablished !== true ||
      !(result.reconstructed instanceof Uint8Array) ||
      digest(result.reconstructed) !== result.stateSha256 ||
      result.reconstructed.byteLength !== result.stateBytes ||
      result.destinationPortId !== destinationIdentity.id ||
      !published || published.published !== true ||
      published.stateSha256 !== result.stateSha256 ||
      published.ownerPort !== destinationIdentity.id ||
      published.encryptedChunkStorage !== true) {
    throw new Error('Exact reconstruction and owner-local durable ZPS publication required');
  }
  const signed = knownSessionOffer(signedSessionOffer, originRecord,
    result.sourcePortId, destinationIdentity.id, result.stateSha256);
  if (!Number.isSafeInteger(now) || now < signed.issuedAt || now >= signed.expiresAt ||
      !Number.isSafeInteger(result.newlyDeliveredUniqueBytes) ||
      result.newlyDeliveredUniqueBytes < 0 ||
      !Number.isSafeInteger(result.reusedPayloadBytes) ||
      result.reusedPayloadBytes < 0 ||
      !Number.isSafeInteger(result.encryptedMissingChunkRequests) ||
      result.encryptedMissingChunkRequests < 0) {
    throw new Error('ZPS materialization time/accounting rejected');
  }
  for (const count of [result.encryptedRequestCiphertextBytes,
    result.encryptedResponseCiphertextBytes]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('ZPS ciphertext accounting rejected');
  }
  const body = {
    schema: ZPS_RECEIPT_SCHEMA, sessionId: signed.sessionId,
    originPort: signed.fromPort, destinationPort: destinationIdentity.id,
    stateSha256: result.stateSha256, stateBytes: result.stateBytes,
    publishedStateSha256: published.stateSha256,
    atRestEncrypted: true, encryptedRequestCount: result.encryptedMissingChunkRequests,
    newlyDeliveredUniqueBytes: result.newlyDeliveredUniqueBytes,
    reusedPayloadBytes: result.reusedPayloadBytes,
    requestCiphertextBytes: result.encryptedRequestCiphertextBytes,
    responseCiphertextBytes: result.encryptedResponseCiphertextBytes,
    declaredAdapter: unsigned(signed.adapter),
    exactReconstructionVerified: true, durableStateIndexPublished: true,
    physicalPowerLossTested: false,
    independentPhysicalHostSeparationProven: false,
    physicalRouteFreeTransportVerified: false,
    globalAvailabilityVerified: false,
    issuedAt: now
  };
  return destinationIdentity.sign(body);
}

// The caller explicitly pins BOTH Port IDs; it must not treat a self-signed
// stranger as the intended counterparty. Signed receipts stay auditable after
// session expiry, provided historical peer keys/records are retained.
export function verifyZpsMaterializationReceipt({
  receipt, signedSessionOffer, originRecord, destinationRecord,
  expectedOriginPortId, expectedDestinationPortId, now = Date.now()
}) {
  const candidate = receipt?.body;
  exactFields(candidate, RECEIPT_FIELDS);
  if (candidate.schema !== ZPS_RECEIPT_SCHEMA ||
      !Number.isSafeInteger(candidate.issuedAt) || candidate.issuedAt > now ||
      candidate.originPort !== expectedOriginPortId ||
      candidate.destinationPort !== expectedDestinationPortId) {
    throw new Error('ZPS materialization receipt identity/time rejected');
  }
  const signed = knownSessionOffer(signedSessionOffer, originRecord,
    expectedOriginPortId, expectedDestinationPortId, candidate.stateSha256);
  const recipient = verifyPeerRecord(destinationRecord, candidate.issuedAt, expectedDestinationPortId);
  const body = verifyEnvelope(receipt, recipient.portId, recipient.publicKey);
  if (body.sessionId !== signed.sessionId ||
      body.issuedAt < signed.issuedAt || body.issuedAt >= signed.expiresAt ||
      body.stateSha256 !== signed.scope.stateSha256 ||
      body.publishedStateSha256 !== body.stateSha256 ||
      !Number.isSafeInteger(body.stateBytes) || body.stateBytes < 0 ||
      !Number.isSafeInteger(body.newlyDeliveredUniqueBytes) || body.newlyDeliveredUniqueBytes < 0 ||
      body.newlyDeliveredUniqueBytes > body.stateBytes ||
      !Number.isSafeInteger(body.reusedPayloadBytes) || body.reusedPayloadBytes < 0 ||
      body.reusedPayloadBytes > body.stateBytes ||
      !Number.isSafeInteger(body.encryptedRequestCount) || body.encryptedRequestCount < 0 ||
      !Number.isSafeInteger(body.requestCiphertextBytes) || body.requestCiphertextBytes < 0 ||
      !Number.isSafeInteger(body.responseCiphertextBytes) || body.responseCiphertextBytes < 0 ||
      digest(canonicalBytes(body.declaredAdapter)) !== digest(canonicalBytes(signed.adapter)) ||
      body.atRestEncrypted !== true || body.exactReconstructionVerified !== true ||
      body.durableStateIndexPublished !== true ||
      body.physicalPowerLossTested !== false ||
      body.independentPhysicalHostSeparationProven !== false ||
      body.physicalRouteFreeTransportVerified !== false ||
      body.globalAvailabilityVerified !== false) {
    throw new Error('ZPS materialization signed receipt contents rejected');
  }
  return Object.freeze({
    receiptDigest: digest(canonicalBytes(receipt)),
    signedByDestinationPort: body.destinationPort,
    originPort: body.originPort,
    sessionId: body.sessionId,
    stateSha256: body.stateSha256,
    exactReconstructionAcknowledged: true,
    localStateIndexAcknowledged: true,
    atRestEncryptionAcknowledged: true,
    encryptedLogicalCiphertextBytes: body.requestCiphertextBytes + body.responseCiphertextBytes,
    physicalPowerLossTested: false,
    physicalRoutingIndependentlyVerified: false,
    globallyReachable: false,
    independentPhysicalHostSeparationProven: false
  });
}

export async function reconstructPublishAndReceipt({
  destinationIdentity, store, manifest, session,
  signedSessionOffer, originRecord, exchangeEncryptedFrame,
  now = Date.now()
}) {
  if (!(store instanceof DurablePortChunkStore) || store.portId !== destinationIdentity?.id) {
    throw new Error('ZPS Port store ownership must match the destination');
  }
  const verified = verifyCdcManifest(manifest);
  const result = await reconstructCdcOverNativeSession({
    manifest: verified, session, signedSessionOffer, originRecord,
    readLocalChunk: async hash => store.readChunk(hash),
    persistVerifiedChunk: async (hash, chunk) => store.putChunk(chunk, hash),
    exchangeEncryptedFrame, now
  });
  const published = await store.publishManifest(verified);
  const receipt = signZpsMaterializationReceipt({
    destinationIdentity, signedSessionOffer, originRecord,
    verifiedResult: result, published, now
  });
  return Object.freeze({ result, published, receipt,
    physicalPowerLossTested: false,
    noPhysicalGlobalRoutingClaim: true
  });
}
