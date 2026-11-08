// Kindred Labs SDPN — CDC/1 encrypted missing-chunk exchange on existing native Port sessions.
// Session setup, signed peer consent and real frame delivery are caller responsibilities.
// No TCP/IP listener, router, relay, DNS or physical carrier is implemented here.
import { canonicalBytes, digest, verifyEnvelope, verifyPeerRecord } from './native-port-identity.mjs';
import { validateAdapterDescriptor } from './native-session.mjs';
import { verifyCdcManifest, reconstructCdcDelta } from './tesseract-cdc-delta.mjs';

export const CDC_WIRE_REQUEST = 0x51; // Q + SHA-256 (32 bytes) + uint32 length
export const CDC_WIRE_DATA = 0x44; // D + SHA-256 (32 bytes) + exact chunk bytes
const REQUEST_LENGTH = 37, DATA_PREFIX = 33;
const SHA256 = /^[a-f0-9]{64}$/;

function strict(session, manifest, offer, originRecord, role, now) {
  const state = verifyCdcManifest(manifest);
  if (!session || typeof session.open !== 'function' ||
      typeof session.seal !== 'function' ||
      typeof session.localPort !== 'string' || typeof session.peerPort !== 'string') {
    throw new Error('Actual encrypted native Port session required');
  }
  const origin = verifyPeerRecord(originRecord, now);
  const signed = verifyEnvelope(offer, origin.portId, origin.publicKey);
  validateAdapterDescriptor(session.adapter);
  validateAdapterDescriptor(signed.adapter);
  if (session.adapter.underlyingIp !== false ||
      session.adapter.underlyingRouting !== false ||
      signed.adapter.underlyingIp !== false ||
      signed.adapter.underlyingRouting !== false) {
    throw new Error('CDC native session forbids routed/IP carrier');
  }
  const maxChunk = Math.max(0, ...state.chunks.map(c => c.bytes));
  if (signed.schema !== 'kindred.sdpn.session-offer.v1' ||
      signed.sessionId !== session.id ||
      signed.scope?.stateSha256 !== state.sha256 ||
      signed.scope?.maxBytes < maxChunk + DATA_PREFIX ||
      digest(canonicalBytes(signed.adapter)) !== digest(canonicalBytes(session.adapter)) ||
      signed.fromPort !== origin.portId || signed.toPort === signed.fromPort ||
      (role === 'source' && (session.localPort !== signed.fromPort || session.peerPort !== signed.toPort)) ||
      (role === 'destination' && (session.localPort !== signed.toPort || session.peerPort !== signed.fromPort))) {
    throw new Error('Native session is not scoped to exact CDC Port identity and state');
  }
  return state;
}

export function makeCdcSourceResponder({
  manifest, sourceChunks, session, signedSessionOffer, originRecord,
  now = Date.now()
}) {
  const state = strict(session, manifest, signedSessionOffer, originRecord, 'source', now);
  if (!(sourceChunks instanceof Map)) throw new Error('Local Tesseract source chunk Map required');
  const permitted = new Map(state.chunks.map(c => [c.sha256, c.bytes]));
  return async (encryptedRequest, receivedAt = now) => {
    const decrypted = session.open(encryptedRequest, receivedAt);
    if (decrypted.byteLength !== REQUEST_LENGTH || decrypted[0] !== CDC_WIRE_REQUEST) {
      throw new Error('CDC request frame structure rejected');
    }
    const hash = decrypted.subarray(1, 33).toString('hex');
    const requestedBytes = decrypted.readUInt32BE(33);
    if (!SHA256.test(hash) || permitted.get(hash) !== requestedBytes) {
      throw new Error('CDC chunk request outside signed manifest');
    }
    const chunk = sourceChunks.get(hash);
    if (!(chunk instanceof Uint8Array) || chunk.length !== requestedBytes ||
        digest(chunk) !== hash) throw new Error('Origin source chunk missing or corrupted');
    const data = Buffer.alloc(DATA_PREFIX + chunk.byteLength);
    data[0] = CDC_WIRE_DATA;
    Buffer.from(hash, 'hex').copy(data, 1);
    Buffer.from(chunk).copy(data, DATA_PREFIX);
    return session.seal(data, receivedAt);
  };
}

export async function reconstructCdcOverNativeSession({
  manifest, session, signedSessionOffer, originRecord,
  readLocalChunk, exchangeEncryptedFrame, onReconstructed,
  now = Date.now()
}) {
  const state = strict(session, manifest, signedSessionOffer, originRecord, 'destination', now);
  if (typeof exchangeEncryptedFrame !== 'function') {
    throw new TypeError('Real encrypted-frame exchange callback required');
  }
  let requests = 0, ciphertextPayloadBytes = 0, ciphertextResponseBytes = 0;
  const fetch = async (hash, bytes) => {
    if (!SHA256.test(hash) || !Number.isSafeInteger(bytes) || bytes < 1) {
      throw new Error('Untrusted CDC missing-chunk request rejected');
    }
    const message = Buffer.alloc(REQUEST_LENGTH);
    message[0] = CDC_WIRE_REQUEST;
    Buffer.from(hash, 'hex').copy(message, 1);
    message.writeUInt32BE(bytes, 33);
    const frame = session.seal(message, now);
    ciphertextPayloadBytes += Buffer.from(frame.ciphertext, 'base64').length;
    const answer = await exchangeEncryptedFrame(frame);
    if (!answer || typeof answer.ciphertext !== 'string') {
      throw new Error('CDC encrypted reply absent');
    }
    ciphertextResponseBytes += Buffer.from(answer.ciphertext, 'base64').length;
    const data = session.open(answer, now);
    if (data.byteLength !== DATA_PREFIX + bytes || data[0] !== CDC_WIRE_DATA ||
        data.subarray(1, 33).toString('hex') !== hash) {
      throw new Error('CDC encrypted chunk response does not match requested content');
    }
    requests++;
    return Buffer.from(data.subarray(DATA_PREFIX));
  };
  const result = await reconstructCdcDelta({
    manifest: state, adapter: session.adapter,
    readLocalChunk, receiveMissingChunk: fetch, onReconstructed
  });
  return Object.freeze({
    ...result,
    signedCdcSessionEstablished: true,
    sourcePortId: session.peerPort, destinationPortId: session.localPort,
    encryptedMissingChunkRequests: requests,
    encryptedRequestCiphertextBytes: ciphertextPayloadBytes,
    encryptedResponseCiphertextBytes: ciphertextResponseBytes,
    encryptedPayloadBytesMeasuredAtSessionBoundary:
      ciphertextPayloadBytes + ciphertextResponseBytes,
    encryptedSessionFrameOverheadExcluded: true,
    independentlyVerifiedSecondPhysicalHost: false,
    globallyRouteFreeTransportProven: false
  });
}
