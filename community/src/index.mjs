// Copyright 2026 Kindred Jermaine Cox and Kindred Labs.
// SPDX-License-Identifier: Apache-2.0
//
// Independently distributable SDPN Community identity, signed namespace, and URI primitives.
// No connection to Kindred Labs account servers, payment processors, central registries,
// proprietary runtimes, domain providers, or model inference services.
import {
  createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify,
} from 'node:crypto';

export const COMMUNITY_SCHEMA = 'kindred.sdpn.community-names.v1';
const PORT_PREFIX = 'strata:port:ed25519:';
const HEX64 = /^[0-9a-f]{64}$/;
const NAME_ATOM = /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const PORT_ID = /^strata:port:ed25519:[0-9a-f]{64}$/;

const isObject = object => object !== null && typeof object === 'object' &&
  !Array.isArray(object) && Object.getPrototypeOf(object) === Object.prototype;
function assertExact(value, keys) {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error('Unexpected community protocol fields');
  }
}
function ordered(input) {
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
  if (typeof input === 'number' && Number.isSafeInteger(input)) return input;
  if (Array.isArray(input)) return input.map(ordered);
  if (isObject(input)) return Object.fromEntries(Object.keys(input).sort().map(k => [k, ordered(input[k])]));
  throw new Error('Non-canonical community record');
}
export const canonical = value => Buffer.from(JSON.stringify(ordered(value)), 'utf8');
const sha256 = binary => createHash('sha256').update(binary).digest('hex');

function decodeKey(base64) {
  if (typeof base64 !== 'string' || base64.length > 128 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('Invalid public key encoding');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64 || bytes.length > 96) {
    throw new Error('Noncanonical public key encoding');
  }
  const publicKey = createPublicKey({ key: bytes, type: 'spki', format: 'der' });
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Only Ed25519 Port Zero keys accepted');
  return { publicKey, bytes };
}
export function portIdentifier(publicKeyDerBase64) {
  const { bytes } = decodeKey(publicKeyDerBase64);
  return PORT_PREFIX + sha256(bytes);
}

function identityFromPrivate(privateKey) {
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 key required');
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  const id = portIdentifier(publicKey);
  return Object.freeze({
    id, publicKey,
    exportPrivateKeyPem() {
      // Only call locally. Never send secret material to a server, public log or PORT URI.
      return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    },
    signRecord(body) {
      return Object.freeze({ body: JSON.parse(canonical(body)), signature:
        sign(null, canonical(body), privateKey).toString('base64') });
    },
  });
}
export function createCommunityIdentity() {
  return identityFromPrivate(generateKeyPairSync('ed25519').privateKey);
}
export function importCommunityIdentity(privateKeyPem) {
  if (typeof privateKeyPem !== 'string' || privateKeyPem.length > 8192) {
    throw new Error('Private identity key PEM rejected');
  }
  return identityFromPrivate(createPrivateKey(privateKeyPem));
}
function validateName(name) {
  if (typeof name !== 'string' || name.length > 170) throw new Error('SDPN alias name length');
  const parts = name === '' ? [] : name.split('.');
  if (parts.length > 5 || parts.some(x => !NAME_ATOM.test(x))) throw new Error('SDPN alias syntax');
  return parts;
}
function validateId(id) {
  if (typeof id !== 'string' || !PORT_ID.test(id)) throw new Error('Target is not a Port Zero identity');
  return id;
}
export function communityPortUri(ownerPort, name = '', path = '/') {
  validateId(ownerPort);
  const parts = validateName(name);
  if (typeof path !== 'string' || path.length > 512 ||
      !/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(path)) throw new Error('Unsafe port resource path');
  const digest = ownerPort.slice(PORT_PREFIX.length);
  const host = [...parts, digest.slice(0, 32), digest.slice(32), 'sdpn'].join('.');
  return 'port://' + host + (path || '/');
}
export function parseCommunityPortUri(uri) {
  if (typeof uri !== 'string' || uri.length > 1024 ||
      !/^port:\/\/[a-z0-9.-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(uri)) {
    throw new Error('Invalid native port URI');
  }
  const parsed = new URL(uri);
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error('Port authority or query denied');
  }
  const labels = parsed.hostname.split('.');
  if (labels.length < 3 || labels.at(-1) !== 'sdpn') throw new Error('Not an SDPN overlay');
  const [a, b] = labels.slice(-3, -1);
  if (!/^[a-f0-9]{32}$/.test(a) || !/^[a-f0-9]{32}$/.test(b)) {
    throw new Error('Missing self-certifying owner ID');
  }
  const ownerPort = PORT_PREFIX + a + b;
  const name = labels.slice(0, -3).join('.');
  validateName(name);
  if (communityPortUri(ownerPort, name, parsed.pathname) !== uri &&
      communityPortUri(ownerPort, name, parsed.pathname).replace(/\/$/, '') !== uri) {
    throw new Error('Noncanonical port URI');
  }
  return Object.freeze({ uri, ownerPort, name, path: parsed.pathname });
}
function validateBindings(body, now) {
  assertExact(body, ['schema', 'ownerPort', 'ownerPublicKey', 'revision', 'issuedAt', 'expiresAt', 'bindings']);
  if (body.schema !== COMMUNITY_SCHEMA || portIdentifier(body.ownerPublicKey) !== body.ownerPort ||
      !Number.isSafeInteger(body.revision) || body.revision < 1 ||
      !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt) ||
      body.issuedAt > now || body.expiresAt <= now || body.expiresAt <= body.issuedAt ||
      body.expiresAt - body.issuedAt > 3600000) throw new Error('Invalid community namespace lifetime');
  if (!Array.isArray(body.bindings) || body.bindings.length < 1 || body.bindings.length > 128) {
    throw new Error('Community namespace binding quota');
  }
  const seen = new Set();
  for (const binding of body.bindings) {
    assertExact(binding, ['name', 'targetPort']);
    validateName(binding.name);
    validateId(binding.targetPort);
    if (seen.has(binding.name)) throw new Error('Duplicate community alias');
    seen.add(binding.name);
  }
  if (canonical(body).byteLength > 32768) throw new Error('Manifest is too large');
}
export function signCommunityNames(identity, bindings, { revision = 1, now = Date.now(), ttlMs = 300000 } = {}) {
  if (!identity || typeof identity.signRecord !== 'function' || typeof identity.publicKey !== 'string' ||
      identity.id !== portIdentifier(identity.publicKey)) throw new Error('Signing identity required');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 3600000) throw new Error('Invalid community namespace TTL');
  const body = { schema: COMMUNITY_SCHEMA, ownerPort: identity.id, ownerPublicKey: identity.publicKey,
    revision, issuedAt: now, expiresAt: now + ttlMs, bindings };
  validateBindings(body, now);
  return identity.signRecord(body);
}
export function verifyCommunityNames(envelope, now = Date.now()) {
  assertExact(envelope, ['body', 'signature']);
  if (!isObject(envelope.body)) throw new Error('Signed record absent');
  const body = JSON.parse(canonical(envelope.body));
  validateBindings(body, now);
  const { publicKey } = decodeKey(body.ownerPublicKey);
  if (typeof envelope.signature !== 'string' || envelope.signature.length !== 88) {
    throw new Error('Signature encoding');
  }
  const signature = Buffer.from(envelope.signature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== envelope.signature ||
      !verify(null, canonical(body), publicKey, signature)) {
    throw new Error('Community namespace signature invalid');
  }
  return body;
}
export function resolveCommunityPort(uri, envelope, now = Date.now()) {
  const address = parseCommunityPortUri(uri);
  const body = verifyCommunityNames(envelope, now);
  if (address.ownerPort !== body.ownerPort) throw new Error('Different Port Zero authority');
  const match = body.bindings.find(x => x.name === address.name);
  if (!match) throw new Error('Unassigned PORT alias');
  return Object.freeze({
    address: uri, ownerPort: body.ownerPort, targetPort: match.targetPort,
    alias: address.name, resourcePath: address.path, expiresAt: body.expiresAt,
    signedIdentityVerified: true, connected: false, authorized: false, nameFeeRequired: false,
  });
}
