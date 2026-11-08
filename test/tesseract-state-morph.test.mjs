import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPortIdentity, signPeerRecord, canonicalBytes } from '../src/native-port-identity.mjs';
import { NativeSessionPolicy, offerNativeSession, acceptNativeSession } from '../src/native-session.mjs';
import { DurablePortChunkStore } from '../src/zps-durable-cas.mjs';
import { prepareCdcState, planCdcDelta } from '../src/tesseract-cdc-delta.mjs';
import { prepareMorphDelta, verifyMorphManifest, signMorphCoordinate,
  sealMorphInsert, reconstructMorphLocally, materializeMorphNative,
  verifyMorphReceipt } from '../src/tesseract-state-morph.mjs';

const now = 1_800_000_000_000;
const A = createPortIdentity({ testSeed: Buffer.alloc(32, 161) });
const B = createPortIdentity({ testSeed: Buffer.alloc(32, 162) });
const C = createPortIdentity({ testSeed: Buffer.alloc(32, 163) });
const direct = { id: 'direct.pipe/v1', substrate: 'ANONYMOUS_PIPE',
  underlyingIp: false, underlyingRouting: false };
const routed = { id: 'compatibility.internet/v1', substrate: 'EXISTING_IP_NETWORK',
  underlyingIp: true, underlyingRouting: true };
const metadata = {
  capabilities: ['native.materialize.v1'],
  tesseractEngine: { id: 'strata-tesseract-1', version: '1.0.0', evidenceStatus: 'DECLARED' },
  boundWorker: { id: 'kindred-port-worker', version: '1.0.0', evidenceStatus: 'DECLARED' }
};
function deterministic(length, seed) {
  const out = Buffer.alloc(length);
  let x = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; out[i] = x & 255;
  }
  return out;
}
function states() {
  const base = deterministic(1024 * 1024, 18467);
  const target = Buffer.concat([base.subarray(0, 14593),
    deterministic(173, 999), base.subarray(14593)]);
  return { base, target, morph: prepareMorphDelta(base, target) };
}
function nativeSession(stateSha, adapter = direct) {
  const ar = signPeerRecord(A, { now, ...metadata });
  const br = signPeerRecord(B, { now, ...metadata });
  const scope = { stateSha256: stateSha, maxBytes: 262144 };
  const ap = new NativeSessionPolicy({ authorizedPeers: [B.id],
    permittedStates: [stateSha], permittedAdapters: [adapter] });
  const bp = new NativeSessionPolicy({ authorizedPeers: [A.id],
    permittedStates: [stateSha], permittedAdapters: [adapter] });
  const offer = offerNativeSession(A, br, scope, adapter, ap, now);
  const accepted = acceptNativeSession(B, offer.envelope, ar, bp, adapter, now);
  return {
    ar, br, signedSessionOffer: offer.envelope,
    sourceSession: offer.finish(accepted.envelope, now),
    destinationSession: accepted.session
  };
}
test('MORPH instruction isolates signed coordination from new 173-byte payload', () => {
  const { base, target, morph } = states();
  assert.equal(morph.manifest.insertBytes, 173);
  assert.equal(morph.manifest.targetBytes, target.length);
  assert.equal(morph.manifest.baseBytes, base.length);
  assert.deepEqual(reconstructMorphLocally(morph.manifest, base, morph.insertedBytes), target);
  const signed = signMorphCoordinate({
    originIdentity: A, destinationPortId: B.id, manifest: morph.manifest, now
  });
  assert.equal(signed.body.originPort, A.id);
  assert.equal(signed.body.destinationPort, B.id);
  assert.equal('insertedBytes' in signed.body, false);
  assert.equal('payload' in signed.body, false);
  assert.equal(canonicalBytes(signed).includes(morph.insertedBytes), false);
  assert.ok(canonicalBytes(signed).length < 2048);
  const tampered = structuredClone(morph.manifest);
  tampered.insertBytes++;
  assert.throws(() => verifyMorphManifest(tampered), /sizes/);
  assert.throws(() => reconstructMorphLocally(morph.manifest,
    deterministic(base.length, 3), morph.insertedBytes), /matching verified base/);
});

test('Port A seals only novel bytes; Port B reconstructs from persistent encrypted base and signs receipt', async () => {
  const { base, target, morph } = states();
  const directory = await mkdtemp(join(tmpdir(), 'sdpn-morph-'));
  const encryptionKey = randomBytes(32);
  let store;
  try {
    store = await DurablePortChunkStore.open({
      directory, portId: B.id, encryptionKey
    });
    await store.importPrepared(prepareCdcState(base));
    const pair = nativeSession(morph.manifest.targetSha256);
    const coordinate = signMorphCoordinate({
      originIdentity: A, destinationPortId: B.id, manifest: morph.manifest, now
    });
    const encrypted = sealMorphInsert({
      sourceSession: pair.sourceSession, signedSessionOffer: pair.signedSessionOffer,
      coordinate, originRecord: pair.ar, insertedBytes: morph.insertedBytes, now
    });
    assert.equal(Buffer.from(encrypted.ciphertext, 'base64').length, 173);
    const result = await materializeMorphNative({
      coordinate, originRecord: pair.ar, signedSessionOffer: pair.signedSessionOffer,
      destinationIdentity: B, destinationSession: pair.destinationSession,
      destinationStore: store, encryptedInsertFrame: encrypted, now
    });
    assert.deepEqual(result.reconstructed, target);
    assert.deepEqual(await store.readPublishedState(morph.manifest.targetSha256), target);
    assert.equal(result.newlyDeliveredLogicalBytes, 173);
    assert.equal(result.exactReconstructionVerified, true);
    assert.equal(result.physicalRouteFreeVerified, false);
    assert.equal(result.globalReachVerified, false);
    const verified = verifyMorphReceipt({
      receipt: result.receipt, coordinate, signedSessionOffer: pair.signedSessionOffer,
      originRecord: pair.ar, destinationRecord: pair.br,
      expectedOriginPortId: A.id, expectedDestinationPortId: B.id, now: now + 60_000
    });
    assert.equal(verified.destinationSignatureVerified, true);
    assert.equal(verified.verifiedNewLogicalBytes, 173);
    assert.equal(verified.globalRouteFreeTransportProven, false);
    pair.sourceSession.close(); pair.destinationSession.close();
    store.close(); store = undefined;
    store = await DurablePortChunkStore.open({ directory, portId: B.id, encryptionKey });
    assert.deepEqual(await store.readPublishedState(morph.manifest.targetSha256), target);
  } finally {
    store?.close(); encryptionKey.fill(0);
    await rm(directory, { recursive: true, force: true });
  }
});

test('signed coordinate and encrypted novel bytes reject tampering, mismatch and replay', async () => {
  const { base, morph } = states();
  const directory = await mkdtemp(join(tmpdir(), 'sdpn-morph-bad-'));
  const key = randomBytes(32);
  let store;
  try {
    store = await DurablePortChunkStore.open({ directory, portId: B.id, encryptionKey: key });
    await store.importPrepared(prepareCdcState(base));
    const pair = nativeSession(morph.manifest.targetSha256);
    const coordinate = signMorphCoordinate({
      originIdentity: A, destinationPortId: B.id, manifest: morph.manifest, now
    });
    const forged = structuredClone(coordinate);
    forged.body.destinationPort = C.id;
    assert.throws(() => sealMorphInsert({
      sourceSession: pair.sourceSession, signedSessionOffer: pair.signedSessionOffer,
      coordinate: forged, originRecord: pair.ar, insertedBytes: morph.insertedBytes, now
    }), /signature/);
    assert.throws(() => sealMorphInsert({
      sourceSession: pair.sourceSession, signedSessionOffer: pair.signedSessionOffer,
      coordinate, originRecord: pair.ar, insertedBytes: Buffer.alloc(173, 1), now
    }), /digest/);
    const frame = sealMorphInsert({
      sourceSession: pair.sourceSession, signedSessionOffer: pair.signedSessionOffer,
      coordinate, originRecord: pair.ar, insertedBytes: morph.insertedBytes, now
    });
    const damaged = structuredClone(frame);
    const bytes = Buffer.from(damaged.ciphertext, 'base64'); bytes[0] ^= 64;
    damaged.ciphertext = bytes.toString('base64');
    await assert.rejects(materializeMorphNative({
      coordinate, originRecord: pair.ar, signedSessionOffer: pair.signedSessionOffer,
      destinationIdentity: B, destinationSession: pair.destinationSession,
      destinationStore: store, encryptedInsertFrame: damaged, now
    }), /authentication/);
    assert.equal(await store.readPublishedState(morph.manifest.targetSha256), undefined);
    pair.sourceSession.close(); pair.destinationSession.close();
  } finally {
    store?.close(); key.fill(0); await rm(directory, { recursive: true, force: true });
  }
});

test('absent historical state and expensive edits cannot be disguised as zero-byte reconstruction', async () => {
  const { morph } = states();
  const directory = await mkdtemp(join(tmpdir(), 'sdpn-morph-missing-'));
  const key = randomBytes(32);
  let store;
  try {
    store = await DurablePortChunkStore.open({ directory, portId: B.id, encryptionKey: key });
    const pair = nativeSession(morph.manifest.targetSha256);
    const coordinate = signMorphCoordinate({
      originIdentity: A, destinationPortId: B.id, manifest: morph.manifest, now
    });
    const frame = sealMorphInsert({
      sourceSession: pair.sourceSession, signedSessionOffer: pair.signedSessionOffer,
      coordinate, originRecord: pair.ar, insertedBytes: morph.insertedBytes, now
    });
    await assert.rejects(materializeMorphNative({
      coordinate, originRecord: pair.ar, signedSessionOffer: pair.signedSessionOffer,
      destinationIdentity: B, destinationSession: pair.destinationSession,
      destinationStore: store, encryptedInsertFrame: frame, now
    }), /base state unavailable/);
    pair.sourceSession.close(); pair.destinationSession.close();
    assert.throws(() => prepareMorphDelta(deterministic(700000, 50),
      deterministic(700000, 51)), /fall back to CDC/);
  } finally {
    store?.close(); key.fill(0); await rm(directory, { recursive: true, force: true });
  }
});

test('MORPH beats CDC on a shifted high-entropy insertion when base is locally verified', async () => {
  const { base, target, morph } = states();
  const old = prepareCdcState(base);
  const updated = prepareCdcState(target);
  const plan = await planCdcDelta(updated.manifest,
    async h => old.uniqueChunks.has(h));
  assert.ok(plan.uniqueMissingBytes > morph.manifest.insertBytes * 10);
  assert.ok(morph.manifest.insertBytes < 200);
  assert.ok(morph.manifest.insertBytes < updated.manifest.totalBytes / 5000);
});

test('routed/IP adapters are rejected even if a native encrypted Port session is valid', () => {
  const { morph } = states();
  const pair = nativeSession(morph.manifest.targetSha256, routed);
  const coordinate = signMorphCoordinate({
    originIdentity: A, destinationPortId: B.id, manifest: morph.manifest, now
  });
  assert.throws(() => sealMorphInsert({
    sourceSession: pair.sourceSession, signedSessionOffer: pair.signedSessionOffer,
    coordinate, originRecord: pair.ar, insertedBytes: morph.insertedBytes, now
  }), /STRICT rejects IP\/routed/);
  pair.sourceSession.close(); pair.destinationSession.close();
});
