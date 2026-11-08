import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createPortIdentity } from '../src/native-port-identity.mjs';
import { prepareCdcState } from '../src/tesseract-cdc-delta.mjs';
import { DurablePortChunkStore } from '../src/zps-durable-cas.mjs';

const alice = createPortIdentity({ testSeed: Buffer.alloc(32, 132) });
const bob = createPortIdentity({ testSeed: Buffer.alloc(32, 133) });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function bytes(length, seed) {
  const v = Buffer.alloc(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    v[i] = x & 255;
  }
  return v;
}

test('encrypted ZPS store saves immutable state, survives close/reopen and verifies every byte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdpn-zps-cas-'));
  const encryptionKey = randomBytes(32);
  const input = bytes(240_001, 34);
  const prepared = prepareCdcState(input);
  try {
    const store = await DurablePortChunkStore.open({
      directory, portId: alice.id, encryptionKey
    });
    const published = await store.importPrepared(prepared);
    assert.equal(published.stateSha256, hash(input));
    assert.equal(published.ownerPort, alice.id);
    assert.equal(published.localOnly, true);
    assert.equal(published.physicalPowerLossTested, false);
    const usage = await store.usage();
    assert.ok(usage.chunks > 1);
    assert.ok(usage.bytes > 0);
    const first = prepared.manifest.chunks[0];
    const physical = await readFile(join(directory, 'objects', first.sha256.slice(0, 2), first.sha256 + '.zps'));
    assert.equal(physical.subarray(0, 8).toString('ascii'), 'SDPNZPS1');
    assert.equal(physical.includes(prepared.uniqueChunks.get(first.sha256)), false);
    assert.equal((await store.readChunk(first.sha256)).toString('hex'),
      prepared.uniqueChunks.get(first.sha256).toString('hex'));
    assert.deepEqual(await store.readPublishedState(prepared.manifest.sha256), input);
    const duplicate = await store.putChunk(prepared.uniqueChunks.get(first.sha256), first.sha256);
    assert.equal(duplicate.written, false);
    assert.equal((await store.usage()).chunks, usage.chunks);
    store.close();
    await assert.rejects(store.readChunk(first.sha256), /closed/);
    const reopened = await DurablePortChunkStore.open({
      directory, portId: alice.id, encryptionKey
    });
    assert.deepEqual(await reopened.readPublishedState(prepared.manifest.sha256), input);
    reopened.close();
  } finally { encryptionKey.fill(0); await rm(directory, { recursive: true, force: true }); }
});

test('wrong key, wrong Port ownership and tampered ciphertext never return plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdpn-zps-wrongkey-'));
  const key = randomBytes(32);
  const original = Buffer.from('Kindred Labs ZPS confidential encrypted local chunk bytes');
  const sha = hash(original);
  try {
    const store = await DurablePortChunkStore.open({ directory, portId: alice.id, encryptionKey: key });
    await store.putChunk(original);
    store.close();
    const wrong = await DurablePortChunkStore.open({
      directory, portId: alice.id, encryptionKey: randomBytes(32)
    });
    await assert.rejects(wrong.readChunk(sha), /authentication/);
    wrong.close();
    const foreign = await DurablePortChunkStore.open({
      directory, portId: bob.id, encryptionKey: key
    });
    await assert.rejects(foreign.readChunk(sha), /authentication/);
    foreign.close();
    const path = join(directory, 'objects', sha.slice(0, 2), sha + '.zps');
    const ciphertext = await readFile(path);
    ciphertext[40] ^= 0x80;
    await writeFile(path, ciphertext);
    const valid = await DurablePortChunkStore.open({
      directory, portId: alice.id, encryptionKey: key
    });
    await assert.rejects(valid.readChunk(sha), /authentication/);
    await assert.rejects(valid.putChunk(original, sha), /authentication/);
    valid.close();
  } finally { key.fill(0); await rm(directory, { recursive: true, force: true }); }
});

test('missing state cannot publish, and publisher never trusts a hash-only manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdpn-zps-absent-'));
  const key = randomBytes(32);
  const prepared = prepareCdcState(bytes(130_000, 88));
  try {
    const store = await DurablePortChunkStore.open({ directory, portId: alice.id, encryptionKey: key });
    await assert.rejects(store.publishManifest(prepared.manifest), /missing/);
    assert.equal(await store.readPublishedState(prepared.manifest.sha256), undefined);
    for (const [sha, chunk] of [...prepared.uniqueChunks].slice(0, 2)) await store.putChunk(chunk, sha);
    await assert.rejects(store.publishManifest(prepared.manifest), /missing/);
    assert.equal(await store.readPublishedState(prepared.manifest.sha256), undefined);
    store.close();
  } finally { key.fill(0); await rm(directory, { recursive: true, force: true }); }
});

test('store applies real encrypted disk quota to new content and retains earlier chunks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdpn-zps-quota-'));
  const key = randomBytes(32);
  const prepared = prepareCdcState(bytes(600_000, 72));
  try {
    const store = await DurablePortChunkStore.open({
      directory, portId: alice.id, encryptionKey: key, maxStoredBytes: 256 * 1024
    });
    await assert.rejects(store.importPrepared(prepared), /quota exceeded/);
    const before = await store.usage();
    assert.ok(before.bytes > 0 && before.bytes <= 256 * 1024);
    for (const [sha] of prepared.uniqueChunks) {
      const found = await store.readChunk(sha);
      if (found) assert.equal(hash(found), sha);
    }
    assert.equal(await store.readPublishedState(prepared.manifest.sha256), undefined);
    store.close();
  } finally { key.fill(0); await rm(directory, { recursive: true, force: true }); }
});

test('concurrent write lock fails explicitly rather than silently overwriting Port data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdpn-zps-lock-'));
  const key = randomBytes(32);
  try {
    const store = await DurablePortChunkStore.open({ directory, portId: alice.id, encryptionKey: key });
    await writeFile(join(directory, '.writer.lock'), 'another-writer');
    await assert.rejects(store.putChunk(Buffer.from('new chunk')), /writer lock/);
    store.close();
  } finally { key.fill(0); await rm(directory, { recursive: true, force: true }); }
});
