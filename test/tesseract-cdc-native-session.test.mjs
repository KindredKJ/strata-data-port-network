import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortIdentity, signPeerRecord } from '../src/native-port-identity.mjs';
import { NativeSessionPolicy, offerNativeSession, acceptNativeSession } from '../src/native-session.mjs';
import { prepareCdcState } from '../src/tesseract-cdc-delta.mjs';
import { makeCdcSourceResponder, reconstructCdcOverNativeSession } from '../src/tesseract-cdc-native-session.mjs';

const now = 1_800_000_000_000;
const A = createPortIdentity({ testSeed: Buffer.alloc(32, 112) });
const B = createPortIdentity({ testSeed: Buffer.alloc(32, 113) });
const direct = { id: 'direct.pipe/v1', substrate: 'ANONYMOUS_PIPE',
  underlyingIp: false, underlyingRouting: false };
const routed = { id: 'compatibility.internet/v1', substrate: 'EXISTING_IP_NETWORK',
  underlyingIp: true, underlyingRouting: true };
const metadata = {
  capabilities: ['native.materialize.v1'],
  tesseractEngine: { id: 'strata-tesseract-1', version: '1.0.0', evidenceStatus: 'DECLARED' },
  boundWorker: { id: 'kindred-port-worker', version: '1.0.0', evidenceStatus: 'DECLARED' }
};
function randomish(size, seed = 10) {
  const bytes = Buffer.alloc(size);
  let x = seed >>> 0;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; bytes[i] = x & 255;
  }
  return bytes;
}
function fixture(adapter = direct, source = randomish(384 * 1024, 10)) {
  const prior = prepareCdcState(source);
  const updatedBytes = Buffer.concat([
    source.subarray(0, 19237), randomish(191, 89), source.subarray(19237)
  ]);
  const next = prepareCdcState(updatedBytes);
  const state = {
    stateSha256: next.manifest.sha256,
    maxBytes: 65569
  };
  const ar = signPeerRecord(A, { now, ...metadata });
  const br = signPeerRecord(B, { now, ...metadata });
  const ap = new NativeSessionPolicy({ authorizedPeers: [B.id],
    permittedStates: [state.stateSha256], permittedAdapters: [adapter] });
  const bp = new NativeSessionPolicy({ authorizedPeers: [A.id],
    permittedStates: [state.stateSha256], permittedAdapters: [adapter] });
  const offered = offerNativeSession(A, br, state, adapter, ap, now);
  const accepted = acceptNativeSession(B, offered.envelope, ar, bp, adapter, now);
  return {
    state, prior, next, updatedBytes,
    originRecord: ar, destinationRecord: br,
    sourceSession: offered.finish(accepted.envelope, now),
    destinationSession: accepted.session,
    signedSessionOffer: offered.envelope, adapter
  };
}

test('Port A responds only with encrypted missing CDC chunks; Port B reconstructs exact bytes', async () => {
  const f = fixture();
  const responder = makeCdcSourceResponder({
    manifest: f.next.manifest, sourceChunks: f.next.uniqueChunks,
    session: f.sourceSession, signedSessionOffer: f.signedSessionOffer,
    originRecord: f.originRecord, now
  });
  const result = await reconstructCdcOverNativeSession({
    manifest: f.next.manifest, session: f.destinationSession,
    signedSessionOffer: f.signedSessionOffer, originRecord: f.originRecord,
    readLocalChunk: async hash => f.prior.uniqueChunks.get(hash),
    exchangeEncryptedFrame: encrypted => responder(encrypted, now), now
  });
  assert.deepEqual(result.reconstructed, f.updatedBytes);
  assert.equal(result.exactReconstructionVerified, true);
  assert.ok(result.encryptedMissingChunkRequests > 0);
  assert.equal(result.encryptedMissingChunkRequests, result.newlyFetchedUniqueChunks);
  assert.equal(result.encryptedResponseCiphertextBytes,
    result.newlyDeliveredUniqueBytes + 33 * result.encryptedMissingChunkRequests);
  assert.equal(result.encryptedRequestCiphertextBytes,
    37 * result.encryptedMissingChunkRequests);
  assert.ok(result.payloadReductionPercent > 50);
  assert.equal(result.signedCdcSessionEstablished, true);
  assert.equal(result.globallyRouteFreeTransportProven, false);
  assert.equal(result.independentlyVerifiedSecondPhysicalHost, false);
  f.sourceSession.close(); f.destinationSession.close();
});

test('foreign or tampered ciphertext fails AEAD before any corrupt reconstruction', async () => {
  const f = fixture();
  const responder = makeCdcSourceResponder({
    manifest: f.next.manifest, sourceChunks: f.next.uniqueChunks,
    session: f.sourceSession, signedSessionOffer: f.signedSessionOffer,
    originRecord: f.originRecord, now
  });
  let published = false;
  await assert.rejects(() => reconstructCdcOverNativeSession({
    manifest: f.next.manifest, session: f.destinationSession,
    signedSessionOffer: f.signedSessionOffer, originRecord: f.originRecord,
    readLocalChunk: async h => f.prior.uniqueChunks.get(h),
    exchangeEncryptedFrame: async frame => {
      const answer = await responder(frame, now);
      const modified = structuredClone(answer);
      const bytes = Buffer.from(modified.ciphertext, 'base64');
      bytes[0] ^= 1;
      modified.ciphertext = bytes.toString('base64');
      return modified;
    },
    onReconstructed: () => { published = true; }, now
  }), /authentication/);
  assert.equal(published, false);
  f.sourceSession.close(); f.destinationSession.close();
});

test('source refuses out-of-manifest and replayed chunk requests in encrypted session', async () => {
  const f = fixture();
  const responder = makeCdcSourceResponder({
    manifest: f.next.manifest, sourceChunks: f.next.uniqueChunks,
    session: f.sourceSession, signedSessionOffer: f.signedSessionOffer,
    originRecord: f.originRecord, now
  });
  const bad = Buffer.alloc(37);
  bad[0] = 0x51; bad.fill(0xff, 1, 33); bad.writeUInt32BE(12000, 33);
  const request = f.destinationSession.seal(bad, now);
  await assert.rejects(() => responder(request, now), /outside signed manifest/);
  await assert.rejects(() => responder(request, now), /ordering/);
  f.sourceSession.close(); f.destinationSession.close();
});

test('corrupted source chunks fail; signed native offer must pin target state and exact Port', async () => {
  const f = fixture();
  const wrongSource = new Map(f.next.uniqueChunks);
  const key = [...wrongSource.keys()][0];
  wrongSource.set(key, Buffer.alloc(wrongSource.get(key).length, 4));
  const responder = makeCdcSourceResponder({
    manifest: f.next.manifest, sourceChunks: wrongSource,
    session: f.sourceSession, signedSessionOffer: f.signedSessionOffer,
    originRecord: f.originRecord, now
  });
  await assert.rejects(() => reconstructCdcOverNativeSession({
    manifest: f.next.manifest, session: f.destinationSession,
    signedSessionOffer: f.signedSessionOffer, originRecord: f.originRecord,
    readLocalChunk: async () => undefined,
    exchangeEncryptedFrame: encrypted => responder(encrypted, now), now
  }), /source chunk missing or corrupted/);
  const anotherState = prepareCdcState(Buffer.from('some other state'));
  assert.throws(() => makeCdcSourceResponder({
    manifest: anotherState.manifest, sourceChunks: anotherState.uniqueChunks,
    session: f.sourceSession, signedSessionOffer: f.signedSessionOffer,
    originRecord: f.originRecord, now
  }), /not scoped to exact CDC/);
  f.sourceSession.close(); f.destinationSession.close();
});

test('IP-routed native session is rejected by CDC/1 STRICT despite valid peer signatures', () => {
  const f = fixture(routed);
  assert.throws(() => makeCdcSourceResponder({
    manifest: f.next.manifest, sourceChunks: f.next.uniqueChunks,
    session: f.sourceSession, signedSessionOffer: f.signedSessionOffer,
    originRecord: f.originRecord, now
  }), /forbids routed\/IP/);
  f.sourceSession.close(); f.destinationSession.close();
});
