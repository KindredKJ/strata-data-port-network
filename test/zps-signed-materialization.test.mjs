import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPortIdentity, signPeerRecord } from '../src/native-port-identity.mjs';
import { NativeSessionPolicy, offerNativeSession, acceptNativeSession } from '../src/native-session.mjs';
import { prepareCdcState } from '../src/tesseract-cdc-delta.mjs';
import { makeCdcSourceResponder } from '../src/tesseract-cdc-native-session.mjs';
import { DurablePortChunkStore } from '../src/zps-durable-cas.mjs';
import { reconstructPublishAndReceipt, verifyZpsMaterializationReceipt } from '../src/zps-signed-materialization.mjs';

const when = 1_800_000_000_000;
const A = createPortIdentity({ testSeed: Buffer.alloc(32, 141) });
const B = createPortIdentity({ testSeed: Buffer.alloc(32, 142) });
const C = createPortIdentity({ testSeed: Buffer.alloc(32, 143) });
const adapter = { id: 'direct.pipe/v1', substrate: 'ANONYMOUS_PIPE',
  underlyingIp: false, underlyingRouting: false };
const metadata = {
  capabilities: ['native.materialize.v1'],
  tesseractEngine: { id: 'strata-tesseract-1', version: '1.0.0', evidenceStatus: 'DECLARED' },
  boundWorker: { id: 'kindred-port-worker', version: '1.0.0', evidenceStatus: 'DECLARED' }
};
function data(length, seed) {
  const out = Buffer.alloc(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    out[i] = x & 255;
  }
  return out;
}
function nativePair(stateSha) {
  const ar = signPeerRecord(A, { now: when, ...metadata });
  const br = signPeerRecord(B, { now: when, ...metadata });
  const scope = { stateSha256: stateSha, maxBytes: 65569 };
  const ap = new NativeSessionPolicy({ authorizedPeers: [B.id],
    permittedStates: [stateSha], permittedAdapters: [adapter] });
  const bp = new NativeSessionPolicy({ authorizedPeers: [A.id],
    permittedStates: [stateSha], permittedAdapters: [adapter] });
  const offered = offerNativeSession(A, br, scope, adapter, ap, when);
  const accepted = acceptNativeSession(B, offered.envelope, ar, bp, adapter, when);
  return { ar, br, signedSessionOffer: offered.envelope,
    sourceSession: offered.finish(accepted.envelope, when),
    destinationSession: accepted.session };
}
function responder(pair, prepared) {
  return makeCdcSourceResponder({
    manifest: prepared.manifest,
    sourceChunks: prepared.uniqueChunks,
    session: pair.sourceSession,
    signedSessionOffer: pair.signedSessionOffer,
    originRecord: pair.ar,
    now: when
  });
}

test('encrypted CDC Port A → Port B publishes to real ZPS disk and signs a verifiable receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sdpn-zps-receipt-'));
  const key = randomBytes(32);
  const first = data(450_007, 777);
  const changed = Buffer.concat([first.subarray(0, 9207), data(173, 111), first.subarray(9207)]);
  const original = prepareCdcState(first), target = prepareCdcState(changed);
  let store;
  try {
    store = await DurablePortChunkStore.open({
      directory: root, portId: B.id, encryptionKey: key
    });
    await store.importPrepared(original); // Receiver independently held initial state.
    const pair = nativePair(target.manifest.sha256);
    const server = responder(pair, target);
    const finalized = await reconstructPublishAndReceipt({
      destinationIdentity: B, store, manifest: target.manifest,
      session: pair.destinationSession, signedSessionOffer: pair.signedSessionOffer,
      originRecord: pair.ar, exchangeEncryptedFrame: encrypted => server(encrypted, when),
      now: when
    });
    assert.deepEqual(finalized.result.reconstructed, changed);
    assert.equal(finalized.published.stateSha256, target.manifest.sha256);
    assert.equal(finalized.published.encryptedChunkStorage, true);
    assert.deepEqual(await store.readPublishedState(target.manifest.sha256), changed);
    assert.ok(finalized.result.newlyDeliveredUniqueBytes > 0);
    assert.ok(finalized.result.newlyDeliveredUniqueBytes < changed.length * 0.5);
    const verdict = verifyZpsMaterializationReceipt({
      receipt: finalized.receipt, signedSessionOffer: pair.signedSessionOffer,
      originRecord: pair.ar, destinationRecord: pair.br,
      expectedOriginPortId: A.id, expectedDestinationPortId: B.id,
      now: when + 90_000 // offline verification after offer expiry
    });
    assert.equal(verdict.exactReconstructionAcknowledged, true);
    assert.equal(verdict.localStateIndexAcknowledged, true);
    assert.equal(verdict.atRestEncryptionAcknowledged, true);
    assert.equal(verdict.physicalPowerLossTested, false);
    assert.equal(verdict.globallyReachable, false);
    assert.equal(verdict.physicalRoutingIndependentlyVerified, false);
    const forged = structuredClone(finalized.receipt);
    forged.body.newlyDeliveredUniqueBytes++;
    assert.throws(() => verifyZpsMaterializationReceipt({
      receipt: forged, signedSessionOffer: pair.signedSessionOffer,
      originRecord: pair.ar, destinationRecord: pair.br,
      expectedOriginPortId: A.id, expectedDestinationPortId: B.id, now: when + 90_000
    }), /signature/);
    assert.throws(() => verifyZpsMaterializationReceipt({
      receipt: finalized.receipt, signedSessionOffer: pair.signedSessionOffer,
      originRecord: pair.ar, destinationRecord: pair.br,
      expectedOriginPortId: A.id, expectedDestinationPortId: C.id, now: when + 90_000
    }), /identity|scope/);
    pair.sourceSession.close(); pair.destinationSession.close();
    store.close();
    store = await DurablePortChunkStore.open({ directory: root, portId: B.id, encryptionKey: key });
    assert.deepEqual(await store.readPublishedState(target.manifest.sha256), changed);

    // New mutually authenticated session: all destination chunks are now present.
    const again = nativePair(target.manifest.sha256);
    let fetched = 0;
    const baseResponder = responder(again, target);
    const second = await reconstructPublishAndReceipt({
      destinationIdentity: B, store, manifest: target.manifest,
      session: again.destinationSession, signedSessionOffer: again.signedSessionOffer,
      originRecord: again.ar,
      exchangeEncryptedFrame: async request => { fetched++; return baseResponder(request, when); },
      now: when
    });
    assert.deepEqual(second.result.reconstructed, changed);
    assert.equal(second.result.newlyDeliveredUniqueBytes, 0);
    assert.equal(second.result.encryptedMissingChunkRequests, 0);
    assert.equal(fetched, 0);
    assert.equal(second.published.indexCreated, false);
    again.sourceSession.close(); again.destinationSession.close();
  } finally {
    store?.close(); key.fill(0);
    await rm(root, { recursive: true, force: true });
  }
});

test('wrong Port cannot publish another Port state or sign receipt for it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sdpn-zps-scope-'));
  const key = randomBytes(32);
  const source = prepareCdcState(data(100_000, 193));
  let store;
  try {
    store = await DurablePortChunkStore.open({ directory: root, portId: C.id, encryptionKey: key });
    const pair = nativePair(source.manifest.sha256);
    await assert.rejects(reconstructPublishAndReceipt({
      destinationIdentity: B, store, manifest: source.manifest,
      session: pair.destinationSession, signedSessionOffer: pair.signedSessionOffer,
      originRecord: pair.ar, exchangeEncryptedFrame: async () => {
        throw new Error('Must not execute a transport callback');
      }, now: when
    }), /ownership/);
    pair.sourceSession.close(); pair.destinationSession.close();
  } finally { store?.close(); key.fill(0); await rm(root, { recursive: true, force: true }); }
});
