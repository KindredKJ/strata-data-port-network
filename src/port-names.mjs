// Founder: Kindred Jermaine Cox. SDPN port:// identity-bound overlay names.
// A signed name is NOT a transport, access grant, DNS registration, or identity attestation.
import { canonicalBytes, digest, exactFields, portId, verifyEnvelope } from './native-port-identity.mjs';

export const PORT_NAMES_SCHEMA = 'kindred.sdpn.port-names.v1';
export const PORT_URI_SCHEME = 'port';
const fullPortId = /^strata:port:ed25519:([a-f0-9]{64})$/;
const atom = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$|^[a-z]$/;
const MAX_MANIFEST_BYTES = 32768;

function validPortId(value) {
  if (typeof value !== 'string' || !fullPortId.test(value)) throw new Error('SDPN Port Zero identity required');
  return value;
}
function nameParts(name) {
  if (typeof name !== 'string' || name.length > 170) throw new Error('Port name bounds');
  const labels = name === '' ? [] : name.split('.');
  if (labels.length > 5 || labels.some(label => !atom.test(label))) throw new Error('Port subdomain rejected');
  return labels;
}
function safePath(path) {
  if (typeof path !== 'string' || path.length > 512 ||
      !/^(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(path)) throw new Error('Port resource path rejected');
  return path || '/';
}
export function portNamespaceHost(ownerPort) {
  const hash = validPortId(ownerPort).match(fullPortId)[1];
  return hash.slice(0, 32) + '.' + hash.slice(32) + '.sdpn';
}
export function makePortUri(ownerPort, name = '', path = '/') {
  const parts = nameParts(name);
  const host = [...parts, portNamespaceHost(ownerPort)].join('.');
  return 'port://' + host + safePath(path);
}
export function parsePortUri(uri) {
  if (typeof uri !== 'string' || uri.length > 1024 || !/^port:\/\/[a-z0-9.-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(uri)) {
    throw new Error('Noncanonical port:// URI');
  }
  const parsed = new URL(uri);
  if (parsed.protocol !== 'port:' || parsed.username || parsed.password || parsed.port ||
      parsed.search || parsed.hash) throw new Error('Port URI authority rejected');
  const labels = parsed.hostname.split('.');
  if (labels.length < 3 || labels.at(-1) !== 'sdpn') throw new Error('SDPN overlay suffix required');
  const [first, second] = labels.slice(-3, -1);
  if (!/^[a-f0-9]{32}$/.test(first) || !/^[a-f0-9]{32}$/.test(second)) {
    throw new Error('Self-certifying namespace missing');
  }
  const name = labels.slice(0, -3).join('.');
  nameParts(name);
  const path = safePath(parsed.pathname);
  const ownerPort = 'strata:port:ed25519:' + first + second;
  if (makePortUri(ownerPort, name, path) !== uri && makePortUri(ownerPort, name, path).replace(/\/$/, '') !== uri) {
    throw new Error('Noncanonical port address');
  }
  return Object.freeze({ scheme: PORT_URI_SCHEME, uri: makePortUri(ownerPort, name, path),
    name, ownerPort, path, namespaceHost: portNamespaceHost(ownerPort) });
}
function verifyBody(body, now) {
  exactFields(body, ['schema', 'ownerPort', 'ownerPublicKey', 'revision', 'issuedAt', 'expiresAt', 'entries']);
  if (body.schema !== PORT_NAMES_SCHEMA || portId(body.ownerPublicKey) !== body.ownerPort ||
      !Number.isSafeInteger(body.revision) || body.revision < 1 ||
      !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt) ||
      body.issuedAt > now || body.expiresAt <= now || body.expiresAt <= body.issuedAt ||
      body.expiresAt - body.issuedAt > 3_600_000) throw new Error('Port name authority or lifetime rejected');
  if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 128) {
    throw new Error('Port name record count rejected');
  }
  const seen = new Set();
  for (const entry of body.entries) {
    exactFields(entry, ['name', 'targetPort']);
    nameParts(entry.name);
    validPortId(entry.targetPort);
    if (seen.has(entry.name)) throw new Error('Duplicate port name');
    seen.add(entry.name);
  }
  if (canonicalBytes(body).length > MAX_MANIFEST_BYTES) throw new Error('Port name manifest size exceeded');
}
export function signPortNames(identity, entries, { revision = 1, now = Date.now(), ttlMs = 300_000 } = {}) {
  if (!identity || typeof identity.sign !== 'function' || typeof identity.id !== 'string') {
    throw new Error('Native signing identity required');
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 3_600_000) throw new Error('Port name TTL rejected');
  const body = { schema: PORT_NAMES_SCHEMA, ownerPort: identity.id,
    ownerPublicKey: identity.publicKey, revision, issuedAt: now, expiresAt: now + ttlMs, entries };
  verifyBody(body, now);
  return identity.sign(body);
}
export function verifyPortNames(record, now = Date.now()) {
  if (!record || !record.body) throw new Error('Port name record absent');
  const body = verifyEnvelope(record, record.body.ownerPort, record.body.ownerPublicKey);
  verifyBody(body, now);
  return body;
}
export function resolvePortName(uri, record, now = Date.now()) {
  const address = parsePortUri(uri);
  const body = verifyPortNames(record, now);
  if (address.ownerPort !== body.ownerPort) throw new Error('Untrusted Port Zero namespace');
  const entry = body.entries.find(item => item.name === address.name);
  if (!entry) throw new Error('Port name not registered');
  // The caller still MUST validate receiver peer records and explicit owner policy.
  return Object.freeze({
    schema: 'kindred.sdpn.port-resolution.v1', address: address.uri,
    ownerPort: body.ownerPort, targetPort: entry.targetPort, name: address.name,
    path: address.path, signedRevision: body.revision, expiresAt: body.expiresAt,
    nameSignatureVerified: true, networkConnected: false, authorizationGranted: false,
    physicalZeroCopyVerified: false, dnsRegistration: false,
  });
}
export class SignedPortNameDirectory {
  #records = new Map();
  #revoked = new Set();
  constructor({ capacity = 256 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error('Directory capacity');
    this.capacity = capacity;
  }
  ingest(record, now = Date.now()) {
    const body = verifyPortNames(record, now);
    if (this.#revoked.has(body.ownerPort)) throw new Error('Port namespace revoked');
    const current = this.#records.get(body.ownerPort);
    if (current && (current.body.revision > body.revision ||
        current.body.revision === body.revision &&
        digest(canonicalBytes(current)) !== digest(canonicalBytes(record)))) {
      throw new Error('Port namespace rollback/conflict');
    }
    for (const [id, existing] of this.#records) if (existing.body.expiresAt <= now) this.#records.delete(id);
    if (!current && this.#records.size >= this.capacity) throw new Error('Port directory capacity exceeded');
    this.#records.set(body.ownerPort, JSON.parse(canonicalBytes(record)));
    return body.ownerPort;
  }
  resolve(uri, now = Date.now()) {
    const parsed = parsePortUri(uri);
    if (this.#revoked.has(parsed.ownerPort)) throw new Error('Port namespace revoked');
    const record = this.#records.get(parsed.ownerPort);
    if (!record) throw new Error('Unknown signed port namespace');
    return resolvePortName(uri, record, now);
  }
  revoke(ownerPort) {
    validPortId(ownerPort);
    this.#revoked.add(ownerPort);
    this.#records.delete(ownerPort);
  }
}
