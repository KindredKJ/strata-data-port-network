import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CDC_PROFILE, prepareCdcState, verifyCdcManifest, planCdcDelta,
  reconstructCdcDelta
} from '../src/tesseract-cdc-delta.mjs';

const direct = { id: 'direct.pipe/v1', substrate: 'ANONYMOUS_PIPE',
  underlyingIp: false, underlyingRouting: false };
const routed = { id: 'compatibility.internet/v1', substrate: 'EXISTING_IP_NETWORK',
  underlyingIp: true, underlyingRouting: true };
function randomish(size, seed = 123) {
  const data = Buffer.alloc(size);
  let x = seed >>> 0;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    data[i] = x & 255;
  }
  return data;
}
const sha256 = b => createHash('sha256').update(b).digest('hex');
const resolve = map => async key => map.get(key);
const unavailable = async () => undefined;

test('content-defined boundaries survive shifted offsets and avoid full-file retransmission', async () => {
  const original = randomish(1024 * 1024, 187);
  const old = prepareCdcState(original);
  const added = randomish(257, 222);
  const changed = Buffer.concat([original.subarray(0, 12137), added, original.subarray(12137)]);
  const updated = prepareCdcState(changed);
  assert.equal(updated.manifest.totalBytes, changed.length);
  assert.equal(updated.manifest.sha256, sha256(changed));
  assert.ok(updated.manifest.chunks.length > 12);
  const availability = await planCdcDelta(updated.manifest,
    async h => old.uniqueChunks.has(h));
  assert.equal(availability.destinationStateVerified, false);
  assert.ok(availability.uniqueMissingBytes < changed.length * 0.45,
    'CDC should resynchronize rather than shift every subsequent chunk');
  let fetched = 0;
  const result = await reconstructCdcDelta({
    manifest: updated.manifest, adapter: direct,
    readLocalChunk: resolve(old.uniqueChunks),
    receiveMissingChunk: async (hash, bytes) => {
      fetched++;
      const chunk = updated.uniqueChunks.get(hash);
      assert.equal(chunk.length, bytes);
      return chunk;
    }
  });
  assert.deepEqual(result.reconstructed, changed);
  assert.equal(result.exactReconstructionVerified, true);
  assert.equal(result.stateSha256, sha256(changed));
  assert.equal(result.newlyDeliveredUniqueBytes, availability.uniqueMissingBytes);
  assert.equal(result.newlyFetchedUniqueChunks, fetched);
  assert.ok(result.payloadReductionPercent > 55);
  assert.equal(result.physicalRouteFreeTransportVerified, false);
  assert.equal(result.globalConnectivityVerified, false);
});

test('identical pre-existing state needs no new payload bytes, including empty state', async () => {
  for (const bytes of [Buffer.alloc(0), randomish(300_000), Buffer.alloc(500_000, 77)]) {
    const src = prepareCdcState(bytes);
    let fetched = 0;
    const result = await reconstructCdcDelta({
      manifest: src.manifest, adapter: direct,
      readLocalChunk: resolve(src.uniqueChunks),
      receiveMissingChunk: async () => { fetched++; throw new Error('must not fetch'); }
    });
    assert.deepEqual(result.reconstructed, bytes);
    assert.equal(result.newlyDeliveredUniqueBytes, 0);
    assert.equal(result.payloadReductionPercent, 100);
    assert.equal(fetched, 0);
  }
});

test('unknown destination state requires actual information and verifies every received byte', async () => {
  const bytes = randomish(150_000, 72);
  const src = prepareCdcState(bytes);
  const plan = await planCdcDelta(src.manifest, async () => false);
  assert.equal(plan.uniqueMissingBytes, bytes.length);
  const result = await reconstructCdcDelta({
    manifest: src.manifest, adapter: direct,
    readLocalChunk: unavailable,
    receiveMissingChunk: async h => src.uniqueChunks.get(h)
  });
  assert.deepEqual(result.reconstructed, bytes);
  assert.equal(result.newlyDeliveredUniqueBytes, bytes.length);
  assert.equal(result.payloadReductionPercent, 0);
  await assert.rejects(() => reconstructCdcDelta({
    manifest: src.manifest, adapter: direct,
    readLocalChunk: unavailable, receiveMissingChunk: unavailable
  }), /not delivered/);
});

test('duplicate blocks are transmitted at most once by the destination materializer', async () => {
  const bytes = Buffer.alloc(512 * 1024, 0x88);
  const src = prepareCdcState(bytes);
  assert.ok(src.manifest.chunks.length > 1);
  assert.ok(src.uniqueChunks.size < src.manifest.chunks.length);
  let fetchCount = 0;
  const result = await reconstructCdcDelta({
    manifest: src.manifest, adapter: direct, readLocalChunk: unavailable,
    receiveMissingChunk: async h => { fetchCount++; return src.uniqueChunks.get(h); }
  });
  assert.deepEqual(result.reconstructed, bytes);
  assert.equal(result.newlyFetchedUniqueChunks, src.uniqueChunks.size);
  assert.equal(fetchCount, src.uniqueChunks.size);
  assert.ok(result.reusedChunkReferences > 0);
  assert.ok(result.newlyDeliveredUniqueBytes < bytes.length);
});

test('false-positive inventory cannot prove availability; missing data must still be delivered', async () => {
  const bytes = randomish(220_000, 321);
  const src = prepareCdcState(bytes);
  const dishonest = await planCdcDelta(src.manifest, async () => true);
  assert.equal(dishonest.uniqueMissingBytes, 0);
  assert.equal(dishonest.destinationStateVerified, false);
  await assert.rejects(() => reconstructCdcDelta({
    manifest: src.manifest, adapter: direct, readLocalChunk: unavailable,
    receiveMissingChunk: unavailable
  }), /not delivered/);
});

test('corrupted missing and cached chunks fail before publication', async () => {
  const bytes = randomish(131_073, 555);
  const src = prepareCdcState(bytes);
  let published = false;
  await assert.rejects(() => reconstructCdcDelta({
    manifest: src.manifest, adapter: direct,
    readLocalChunk: async h => Buffer.alloc(src.uniqueChunks.get(h).length, 22),
    receiveMissingChunk: async h => Buffer.alloc(src.uniqueChunks.get(h).length, 77),
    onReconstructed: async () => { published = true; }
  }), /integrity verification/);
  assert.equal(published, false);
  const corrected = await reconstructCdcDelta({
    manifest: src.manifest, adapter: direct,
    readLocalChunk: async () => Buffer.alloc(4096, 0),
    receiveMissingChunk: async h => src.uniqueChunks.get(h),
    onReconstructed: async finished => {
      assert.equal(sha256(finished), src.manifest.sha256);
      published = true;
    }
  });
  assert.equal(published, true);
  assert.equal(corrected.exactReconstructionVerified, true);
});

test('strict native mode rejects IP/routed underlays before any data delivery callback runs', async () => {
  const src = prepareCdcState(randomish(40_000));
  let called = false;
  await assert.rejects(() => reconstructCdcDelta({
    manifest: src.manifest, adapter: routed,
    readLocalChunk: async () => { called = true; return undefined; },
    receiveMissingChunk: async () => { called = true; return undefined; }
  }), /rejects IP or routed/);
  assert.equal(called, false);
});

test('malformed manifests, chunks, bounds and unsupported binary input fail closed', () => {
  const src = prepareCdcState(randomish(200_000));
  const changed = structuredClone(src.manifest);
  changed.chunks[0].sha256 = 'f'.repeat(64);
  assert.throws(() => verifyCdcManifest({ ...changed, unexpected: 'route' }), /schema/);
  const badLength = structuredClone(src.manifest);
  badLength.chunks[0].bytes += 1;
  assert.throws(() => verifyCdcManifest(badLength), /length/);
  const invalidHash = structuredClone(src.manifest);
  invalidHash.sha256 = 'invalid';
  assert.throws(() => verifyCdcManifest(invalidHash), /schema/);
  assert.throws(() => prepareCdcState(Buffer.alloc(4 * 1024 * 1024 + 1)), /4 MiB/);
  assert.throws(() => prepareCdcState('not binary'), /binary bytes/);
  assert.equal(CDC_PROFILE.window, 48);
});
