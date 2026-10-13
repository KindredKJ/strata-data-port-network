// Kindred Jermaine Cox / Kindred Labs. All rights reserved.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

export function canonicalBytes(value) {
  function ordered(v) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
    if (Array.isArray(v)) return v.map(ordered);
    if (v && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])]));
    }
    throw new TypeError('Native control values must be canonical JSON primitives');
  }
  return Buffer.from(JSON.stringify(ordered(value)));
}
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function exactFields(value, fields) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join('|') !== [...fields].sort().join('|')) throw new Error('Native schema fields rejected');
}
export function decodePublicKey(encoded, type) {
  if (typeof encoded !== 'string' || encoded.length > 128) throw new Error('Public key bounds');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error('Noncanonical public key');
  const key = createPublicKey({ key: bytes, type: 'spki', format: 'der' });
  if (key.asymmetricKeyType !== type) throw new Error('Public key algorithm rejected');
  return key;
}
export const portId = publicKey => 'strata:port:ed25519:' + digest(Buffer.from(publicKey, 'base64'));

export function createPortIdentity({ testSeed } = {}) {
  let privateKey;
  if (testSeed !== undefined) {
    if (!(testSeed instanceof Uint8Array) || testSeed.length !== 32) throw new Error('Test seed must contain 32 bytes');
    privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(testSeed)]), type: 'pkcs8', format: 'der' });
  } else privateKey = generateKeyPairSync('ed25519').privateKey;
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  return Object.freeze({
    id: portId(publicKey), publicKey,
    sign(body) {
      const copy = JSON.parse(canonicalBytes(body));
      return { body: copy, signature: sign(null, canonicalBytes(copy), privateKey).toString('base64') };
    }
  });
}

export function verifyEnvelope(envelope, expectedId, publicKey) {
  exactFields(envelope, ['body', 'signature']);
  if (portId(publicKey) !== expectedId || typeof envelope.signature !== 'string' || envelope.signature.length !== 88) throw new Error('Port identity/signature rejected');
  const signature = Buffer.from(envelope.signature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== envelope.signature ||
      !verify(null, canonicalBytes(envelope.body), decodePublicKey(publicKey, 'ed25519'), signature)) throw new Error('Port signature rejected');
  return JSON.parse(canonicalBytes(envelope.body));
}

function assertRecord(body, now) {
  exactFields(body, ['schema', 'portId', 'publicKey', 'revision', 'issuedAt', 'expiresAt', 'capabilities', 'tesseractEngine', 'boundWorker']);
  if (body.schema !== 'kindred.sdpn.peer-record.v1' || body.portId !== portId(body.publicKey) ||
      !Number.isSafeInteger(body.revision) || body.revision < 1 ||
      !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt) ||
      body.issuedAt > now || body.expiresAt <= now || body.expiresAt - body.issuedAt > 300_000 ||
      body.expiresAt <= body.issuedAt) throw new Error('Peer record lifetime/version rejected');
  if (!Array.isArray(body.capabilities) || body.capabilities.length < 1 || body.capabilities.length > 16 ||
      new Set(body.capabilities).size !== body.capabilities.length || body.capabilities.some(x => typeof x !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(x))) throw new Error('Peer capabilities rejected');
  for (const field of ['tesseractEngine', 'boundWorker']) {
    exactFields(body[field], ['id', 'version', 'evidenceStatus']);
    if (!/^[a-z][a-z0-9.-]{0,63}$/.test(body[field].id) || !/^\d+\.\d+\.\d+$/.test(body[field].version) ||
        body[field].evidenceStatus !== 'DECLARED') throw new Error('Component binding rejected');
  }
  decodePublicKey(body.publicKey, 'ed25519');
}

export function signPeerRecord(identity, { revision = 1, now = Date.now(), ttlMs = 60_000, capabilities, tesseractEngine, boundWorker }) {
  const body = { schema: 'kindred.sdpn.peer-record.v1', portId: identity.id, publicKey: identity.publicKey,
    revision, issuedAt: now, expiresAt: now + ttlMs, capabilities, tesseractEngine, boundWorker };
  assertRecord(body, now);
  return identity.sign(body);
}
export function verifyPeerRecord(record, now = Date.now(), expectedId) {
  const body = record?.body;
  if (!body) throw new Error('Peer record absent');
  const verified = verifyEnvelope(record, expectedId ?? body.portId, body.publicKey);
  assertRecord(verified, now);
  return verified;
}

// A self-signed identity is not consent, device attestation, reachability or authorization.
export class SignedPeerDirectory {
  #records = new Map(); #revoked = new Set();
  constructor({ capacity = 256 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error('Directory capacity');
    this.capacity = capacity;
    Object.freeze(this);
  }
  ingest(record, now = Date.now()) {
    const body = verifyPeerRecord(record, now);
    if (this.#revoked.has(body.portId)) throw new Error('Peer revoked');
    const prior = this.#records.get(body.portId);
    if (prior && (body.revision < prior.body.revision ||
        (body.revision === prior.body.revision && digest(canonicalBytes(record)) !== digest(canonicalBytes(prior))))) throw new Error('Peer revision rollback/conflict');
    for (const [id, value] of this.#records) if (value.body.expiresAt <= now) this.#records.delete(id);
    if (!this.#records.has(body.portId) && this.#records.size >= this.capacity) throw new Error('Directory capacity exceeded');
    this.#records.set(body.portId, JSON.parse(canonicalBytes(record)));
    return body.portId;
  }
  get(id, now = Date.now()) {
    if (this.#revoked.has(id)) throw new Error('Peer revoked');
    const record = this.#records.get(id);
    if (!record) throw new Error('Peer unknown');
    verifyPeerRecord(record, now, id);
    return JSON.parse(canonicalBytes(record));
  }
  revoke(id) {
    if (this.#revoked.size >= 4096 && !this.#revoked.has(id)) throw new Error('Revocation capacity exceeded');
    this.#revoked.add(id); this.#records.delete(id);
  }
}
