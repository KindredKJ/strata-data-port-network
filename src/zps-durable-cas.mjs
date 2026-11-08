// Kindred Labs — ZPS/CAS-v1: Port-owned encrypted, durable, content-addressed chunks.
// The key is supplied by the caller and NEVER persisted, logged, transmitted or auto-generated.
// Writes are exclusive, temp-fsynced and immutable; no network, routing, or OS mount changes.
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { mkdir, lstat, stat, readdir, readFile, open, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { verifyCdcManifest } from './tesseract-cdc-delta.mjs';

const CHUNK_SCHEMA = 'kindred.sdpn.zps.cas.encrypted.v1';
const INDEX_SCHEMA = 'kindred.sdpn.zps.cas.state-index.v1';
const MAGIC = Buffer.from('SDPNZPS1');
const HEADER = 8 + 4 + 12 + 16;
const HASH = /^[a-f0-9]{64}$/;
const PORT = /^strata:port:ed25519:[a-f0-9]{64}$/;
const MAX_CHUNK = 64 * 1024;
const MAX_INDEX = 128 * 1024;
const MIN_LIMIT = 256 * 1024;
const MAX_LIMIT = 1024 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function closedError() { throw new Error('ZPS Port store closed'); }
async function ensurePrivateDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('ZPS root cannot be a symlink or non-directory');
  }
}
async function fsyncDirectory(dir) {
  let handle;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
    return true;
  } catch (error) {
    if (['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EPERM', 'EACCES'].includes(error?.code)) return false;
    throw error;
  } finally { await handle?.close(); }
}
async function readRegular(path, max) {
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > max || info.size < 1) {
    throw new Error('ZPS stored object not a bounded regular file');
  }
  return readFile(path);
}
async function immutableFile(path, bytes) {
  const dir = dirname(path);
  await ensurePrivateDir(dir);
  const tmp = join(dir, '.zps-' + randomBytes(16).toString('hex') + '.tmp');
  const handle = await open(tmp, 'wx', 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    let created = true;
    try { await link(tmp, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      created = false;
    }
    return { created, directoryFsyncSucceeded: await fsyncDirectory(dir) };
  } finally { await unlink(tmp).catch(() => {}); }
}

export class DurablePortChunkStore {
  #root; #objects; #states; #key; #portId; #maxStoredBytes; #closed = false;
  constructor() { throw new Error('Use DurablePortChunkStore.open(...)'); }
  static async open({
    directory, portId, encryptionKey, maxStoredBytes = 64 * 1024 * 1024
  }) {
    if (typeof directory !== 'string' || directory.length === 0 ||
        !PORT.test(portId) ||
        !(encryptionKey instanceof Uint8Array) || encryptionKey.byteLength !== 32 ||
        !Number.isSafeInteger(maxStoredBytes) || maxStoredBytes < MIN_LIMIT ||
        maxStoredBytes > MAX_LIMIT) {
      throw new Error('ZPS Port directory, cryptographic identity, 256-bit key and quota required');
    }
    const root = resolve(directory);
    const objects = join(root, 'objects');
    const states = join(root, 'states');
    await ensurePrivateDir(root);
    await ensurePrivateDir(objects);
    await ensurePrivateDir(states);
    const instance = Object.create(DurablePortChunkStore.prototype);
    instance.#root = root;
    instance.#objects = objects;
    instance.#states = states;
    instance.#key = Buffer.from(encryptionKey);
    instance.#portId = portId;
    instance.#maxStoredBytes = maxStoredBytes;
    return instance;
  }
  get portId() { return this.#portId; }
  get root() { return this.#root; }
  #assertOpen() { if (this.#closed) closedError(); }
  #chunkPath(hash) {
    if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('Invalid ZPS chunk hash');
    return join(this.#objects, hash.slice(0, 2), hash + '.zps');
  }
  #indexPath(hash) {
    if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('Invalid ZPS state hash');
    return join(this.#states, hash + '.json');
  }
  #aad(hash, bytes) {
    return Buffer.from(JSON.stringify({ schema: CHUNK_SCHEMA, portId: this.#portId,
      sha256: hash, bytes }), 'utf8');
  }
  async #exclusiveWrite(task) {
    this.#assertOpen();
    const lockName = join(this.#root, '.writer.lock');
    const lock = await open(lockName, 'wx', 0o600).catch(error => {
      if (error.code === 'EEXIST') throw new Error('ZPS writer lock already held; inspect previous writer');
      throw error;
    });
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid }) + '\n');
      await lock.sync();
      return await task();
    } finally {
      await lock.close();
      await unlink(lockName).catch(() => {});
    }
  }
  async usage() {
    this.#assertOpen();
    let bytes = 0, chunks = 0;
    const shards = await readdir(this.#objects, { withFileTypes: true });
    for (const shard of shards) {
      if (!shard.isDirectory() || !/^[a-f0-9]{2}$/.test(shard.name)) continue;
      const p = join(this.#objects, shard.name);
      for (const item of await readdir(p, { withFileTypes: true })) {
        if (!item.isFile() || !/^[a-f0-9]{64}\.zps$/.test(item.name) ||
            !item.name.startsWith(shard.name)) continue;
        const info = await stat(join(p, item.name));
        bytes += info.size;
        chunks++;
      }
    }
    return Object.freeze({ bytes, chunks, maxStoredBytes: this.#maxStoredBytes });
  }
  async readChunk(hash) {
    this.#assertOpen();
    const payload = await readRegular(this.#chunkPath(hash), HEADER + MAX_CHUNK);
    if (!payload) return undefined;
    if (payload.length < HEADER || !payload.subarray(0, 8).equals(MAGIC)) {
      throw new Error('ZPS encrypted chunk header rejected');
    }
    const size = payload.readUInt32BE(8);
    if (size < 1 || size > MAX_CHUNK || payload.length !== HEADER + size) {
      throw new Error('ZPS encrypted chunk length rejected');
    }
    const nonce = payload.subarray(12, 24);
    const tag = payload.subarray(24, 40);
    const ciphertext = payload.subarray(40);
    const decipher = createDecipheriv('aes-256-gcm', this.#key, nonce);
    decipher.setAAD(this.#aad(hash, size));
    decipher.setAuthTag(tag);
    let plain;
    try { plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]); }
    catch { throw new Error('ZPS encrypted chunk authentication rejected'); }
    if (sha256(plain) !== hash) {
      plain.fill(0);
      throw new Error('ZPS chunk integrity SHA-256 rejected');
    }
    return plain;
  }
  async putChunk(bytes, expectedHash = sha256(bytes)) {
    this.#assertOpen();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 ||
        bytes.byteLength > MAX_CHUNK || !HASH.test(expectedHash) ||
        sha256(bytes) !== expectedHash) {
      throw new Error('ZPS chunk input bounds or SHA-256 rejected');
    }
    const input = Buffer.from(bytes);
    return this.#exclusiveWrite(async () => {
      const already = await this.readChunk(expectedHash);
      if (already) {
        already.fill(0);
        return Object.freeze({ hash: expectedHash, written: false,
          encryptedAtRest: true, directoryFsyncSucceeded: true });
      }
      const used = await this.usage();
      if (used.bytes + HEADER + input.length > this.#maxStoredBytes) {
        throw new Error('ZPS encrypted storage quota exceeded');
      }
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
      cipher.setAAD(this.#aad(expectedHash, input.length));
      const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
      const record = Buffer.alloc(HEADER + encrypted.length);
      MAGIC.copy(record, 0);
      record.writeUInt32BE(input.length, 8);
      nonce.copy(record, 12);
      cipher.getAuthTag().copy(record, 24);
      encrypted.copy(record, HEADER);
      const result = await immutableFile(this.#chunkPath(expectedHash), record);
      if (!result.created) {
        const winner = await this.readChunk(expectedHash);
        if (!winner || !winner.equals(input)) throw new Error('ZPS existing chunk conflict/corruption');
        winner.fill(0);
      }
      return Object.freeze({ hash: expectedHash, written: result.created,
        encryptedAtRest: true, directoryFsyncSucceeded: result.directoryFsyncSucceeded });
    });
  }
  async importPrepared(prepared) {
    const manifest = verifyCdcManifest(prepared?.manifest);
    if (!(prepared.uniqueChunks instanceof Map)) {
      throw new Error('ZPS imported state requires local verified chunk map');
    }
    for (const [hash, chunk] of prepared.uniqueChunks) {
      await this.putChunk(chunk, hash);
    }
    return this.publishManifest(manifest);
  }
  async reconstruct(manifest) {
    const valid = verifyCdcManifest(manifest);
    this.#assertOpen();
    const out = Buffer.alloc(valid.totalBytes);
    let offset = 0;
    try {
      for (const item of valid.chunks) {
        const found = await this.readChunk(item.sha256);
        if (!found || found.length !== item.bytes) throw new Error('ZPS state chunk missing');
        found.copy(out, offset);
        offset += item.bytes;
        found.fill(0);
      }
      if (sha256(out) !== valid.sha256) throw new Error('ZPS exact state reconstruction rejected');
      return out;
    } catch (error) {
      out.fill(0);
      throw error;
    }
  }
  async publishManifest(manifest) {
    this.#assertOpen();
    const valid = verifyCdcManifest(manifest);
    const exact = await this.reconstruct(valid);
    exact.fill(0);
    const index = {
      schema: INDEX_SCHEMA,
      ownerPort: this.#portId,
      manifest: valid
    };
    const bytes = Buffer.from(JSON.stringify(index) + '\n');
    if (bytes.length > MAX_INDEX) throw new Error('ZPS state index size exceeded');
    return this.#exclusiveWrite(async () => {
      const file = this.#indexPath(valid.sha256);
      const result = await immutableFile(file, bytes);
      if (!result.created) {
        const original = await readRegular(file, MAX_INDEX);
        if (!original || !original.equals(bytes)) throw new Error('ZPS immutable state manifest conflict');
      }
      return Object.freeze({
        stateSha256: valid.sha256, ownerPort: this.#portId, published: true,
        indexCreated: result.created, encryptedChunkStorage: true,
        localOnly: true, directoryFsyncSucceeded: result.directoryFsyncSucceeded,
        physicalPowerLossTested: false
      });
    });
  }
  async readPublishedState(sha) {
    this.#assertOpen();
    const data = await readRegular(this.#indexPath(sha), MAX_INDEX);
    if (!data) return undefined;
    let index;
    try { index = JSON.parse(data.toString('utf8')); }
    catch { throw new Error('ZPS invalid published state index'); }
    if (!index || index.schema !== INDEX_SCHEMA ||
        index.ownerPort !== this.#portId || index.manifest?.sha256 !== sha ||
        Object.keys(index).sort().join(',') !== ['manifest','ownerPort','schema'].sort().join(',')) {
      throw new Error('ZPS owner/index integrity rejected');
    }
    return this.reconstruct(verifyCdcManifest(index.manifest));
  }
  close() {
    if (!this.#closed) this.#key.fill(0);
    this.#closed = true;
  }
}
