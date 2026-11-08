import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortIdentity, signPeerRecord, digest, canonicalBytes } from '../src/native-port-identity.mjs';
import { NativeSessionPolicy } from '../src/native-session.mjs';
import { prepareReferenceState, reconstructFromLocalState, verifyReferenceManifest,
  createReferenceCoordinationOffer, fulfillReferenceCoordinationOffer,
  verifyReferenceReconstructionReceipt } from '../src/tesseract-reference-coordination.mjs';

const now = 1_800_000_000_000;
const A = createPortIdentity({ testSeed: Buffer.alloc(32, 91) });
const B = createPortIdentity({ testSeed: Buffer.alloc(32, 92) });
const C = createPortIdentity({ testSeed: Buffer.alloc(32, 93) });
const metadata = {
  capabilities: ['native.materialize.v1'],
  tesseractEngine: { id: 'strata-tesseract-1', version: '1.0.0', evidenceStatus: 'DECLARED' },
  boundWorker: { id: 'kindred-port-worker', version: '1.0.0', evidenceStatus: 'DECLARED' }
};
const direct = { id: 'direct.pipe/v1', substrate: 'ANONYMOUS_PIPE',
  underlyingIp: false, underlyingRouting: false };
function policy(peer, hash, adapter = direct) {
  return new NativeSessionPolicy({ authorizedPeers: [peer.id],
    permittedStates: [hash], permittedAdapters: [adapter] });
}
function records() {
  return { ar: signPeerRecord(A, { now, ...metadata }),
    br: signPeerRecord(B, { now, ...metadata }) };
}
function state() {
  const source = Buffer.alloc(180_007);
  for (let i = 0; i < source.length; i++) source[i] = (i * 31 + 79) & 255;
  const prepared = prepareReferenceState(source);
  // Independently provision destination before control exchange (not over SDPN).
  const B_local = new Map([...prepared.localChunks].map(([k, v]) => [k, Buffer.from(v)]));
  return { source, manifest: prepared.manifest, B_local };
}

test('destination reconstructs exact binary bytes with signed coordination-only exchange', async () => {
  const { source, manifest, B_local } = state();
  const { ar, br } = records();
  const offer = createReferenceCoordinationOffer({
    originIdentity: A, destinationRecord: br, manifest,
    policy: policy(B, manifest.sha256), adapter: direct, now
  });
  assert.equal(offer.body.toPort, B.id);
  assert.equal(offer.body.fromPort, A.id);
  assert.equal(offer.body.adapter.underlyingRouting, false);
  assert.equal(offer.body.adapter.underlyingIp, false);
  assert.equal(offer.body.manifest.totalBytes, source.length);
  assert.ok(canonicalBytes(offer).length < source.length);
  assert.equal('payload' in offer.body, false);
  assert.equal('data' in offer.body, false);
  const result = await fulfillReferenceCoordinationOffer({
    destinationIdentity: B, offer, originRecord: ar,
    policy: policy(A, manifest.sha256), adapter: direct,
    resolveLocalChunk: async hash => B_local.get(hash), now
  });
  assert.deepEqual(result.reconstructed, source);
  assert.equal(result.newlyDeliveredPayloadBytes, 0);
  assert.equal(result.globallyRoutelessTransferProven, false);
  const receipt = verifyReferenceReconstructionReceipt({
    offer, receipt: result.receipt, originRecord: ar, destinationRecord: br, now
  });
  assert.equal(receipt.exactReconstructionAcknowledged, true);
  assert.equal(receipt.deliveryMode, 'DESTINATION_PREEXISTING_STATE');
  assert.equal(receipt.globallyRoutelessTransferProven, false);
});

test('unknown fresh state cannot reconstruct from a hash or signed manifest alone', async () => {
  const { manifest } = state();
  const { ar, br } = records();
  const offer = createReferenceCoordinationOffer({
    originIdentity: A, destinationRecord: br, manifest,
    policy: policy(B, manifest.sha256), adapter: direct, now
  });
  await assert.rejects(() => fulfillReferenceCoordinationOffer({
    destinationIdentity: B, offer, originRecord: ar,
    policy: policy(A, manifest.sha256), adapter: direct,
    resolveLocalChunk: async () => undefined, now
  }), /missing or corrupted/);
});

test('corrupt destination chunks and falsified manifest hashes fail exact verification', async () => {
  const { manifest, B_local } = state();
  const one = manifest.chunks[0];
  B_local.get(one.sha256)[0] ^= 1;
  await assert.rejects(() => reconstructFromLocalState(manifest,
    async hash => B_local.get(hash)), /missing or corrupted/);
  const bad = structuredClone(manifest);
  bad.chunks[0].bytes++;
  assert.throws(() => verifyReferenceManifest(bad), /manifest total size/);
});

test('source, destination and control tampering or replay never grant reconstruction', async () => {
  const { manifest, B_local } = state();
  const { ar, br } = records();
  const base = createReferenceCoordinationOffer({
    originIdentity: A, destinationRecord: br, manifest,
    policy: policy(B, manifest.sha256), adapter: direct, now
  });
  const receiverPolicy = policy(A, manifest.sha256);
  const args = { destinationIdentity: B, originRecord: ar, policy: receiverPolicy,
    adapter: direct, resolveLocalChunk: async hash => B_local.get(hash), now };
  const tampered = structuredClone(base);
  tampered.body.manifest.chunks[0].sha256 = 'f'.repeat(64);
  await assert.rejects(() => fulfillReferenceCoordinationOffer({ ...args, offer: tampered }),
    /signature/);
  const wrongDestination = structuredClone(base);
  wrongDestination.body.toPort = C.id;
  await assert.rejects(() => fulfillReferenceCoordinationOffer({
    ...args, offer: wrongDestination
  }), /signature/);
  const result = await fulfillReferenceCoordinationOffer({ ...args, offer: base });
  await assert.rejects(() => fulfillReferenceCoordinationOffer({
    ...args, offer: base
  }), /replay/);
  assert.throws(() => verifyReferenceReconstructionReceipt({
    offer: base, receipt: result.receipt, originRecord: ar, destinationRecord: signPeerRecord(C, { now, ...metadata }), now
  }), /identity/);
  assert.throws(() => verifyReferenceReconstructionReceipt({
    offer: base, receipt: result.receipt, originRecord: ar, destinationRecord: br, now: now + 30_000
  }), /expired|lifetime/);
});

test('strict route-free coordination rejects an IP routed adapter, even if encrypted', () => {
  const { manifest } = state();
  const { br } = records();
  const routed = { id: 'compatibility.internet/v1', substrate: 'EXISTING_IP_NETWORK',
    underlyingIp: true, underlyingRouting: true };
  assert.throws(() => createReferenceCoordinationOffer({
    originIdentity: A, destinationRecord: br, manifest,
    policy: policy(B, manifest.sha256, routed), adapter: routed, now
  }), /Routed\/IP adapter rejected/);
});

test('empty state reconstructs without bytes and oversized state is rejected', async () => {
  const empty = prepareReferenceState(Buffer.alloc(0));
  assert.deepEqual(empty.manifest.chunks, []);
  const result = await reconstructFromLocalState(empty.manifest, async () => {
    throw Error('Should not resolve any chunk');
  });
  assert.equal(result.length, 0);
  assert.equal(result.toString('hex'), digest(Buffer.alloc(0)).slice(0, 0));
  assert.throws(() => prepareReferenceState(Buffer.alloc(4 * 1024 * 1024 + 1)), /size cap/);
});
