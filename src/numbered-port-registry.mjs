// Kindred Labs. Additive, signed numeric PORT registry; never a transport or routing layer.
import { canonicalBytes, digest, exactFields, portId, decodePublicKey, verifyEnvelope, signPeerRecord, verifyPeerRecord } from './native-port-identity.mjs';

export const NUMBERED_PORT_SCHEMA = 'kindred.sdpn.numbered-port-event.v1';
export const NUMBERED_PRESENCE_SCHEMA = 'kindred.sdpn.numbered-tesseract-presence.v1';
const PORT_ID = /^strata:port:ed25519:[a-f0-9]{64}$/;
const MAX_EVENTS = 100_000;
const EVENT_FIELDS = ['schema', 'action', 'sequence', 'number', 'portId', 'publicKey',
  'authorityPort', 'previousSha256', 'issuedAt'];

function validIdentity(identity) {
  if (!identity || typeof identity.sign !== 'function' ||
      typeof identity.publicKey !== 'string' ||
      identity.id !== portId(identity.publicKey)) throw new Error('Signing identity required');
  decodePublicKey(identity.publicKey, 'ed25519');
  return identity.id;
}
function validAnchor(id) {
  if (typeof id !== 'string' || !PORT_ID.test(id)) throw new Error('Explicit pinned founder Port 0 identity required');
  return id;
}
function validTime(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Event time rejected');
}
function copy(value) { return JSON.parse(canonicalBytes(value).toString('utf8')); }

export function verifyNumberedRegistry(events, expectedFounderPortId) {
  const pinned = validAnchor(expectedFounderPortId);
  if (!Array.isArray(events) || events.length < 1 || events.length > MAX_EVENTS) throw new Error('Registry event bounds');
  const founder = events[0]?.body;
  if (!founder || founder.authorityPort !== pinned || founder.portId !== pinned ||
      portId(founder.publicKey) !== pinned) throw new Error('Founder Port 0 anchor mismatch');
  decodePublicKey(founder.publicKey, 'ed25519');
  const byNumber = new Map();
  const seenIds = new Set();
  let nextNumber = 1, lastIssuedAt = -1, previousSha256 = null;
  for (let index = 0; index < events.length; index++) {
    const entry = events[index];
    const body = verifyEnvelope(entry, pinned, founder.publicKey);
    exactFields(body, EVENT_FIELDS);
    if (body.schema !== NUMBERED_PORT_SCHEMA || body.authorityPort !== pinned ||
        body.sequence !== index || body.previousSha256 !== previousSha256 ||
        !Number.isSafeInteger(body.number) || body.number < 0 ||
        typeof body.portId !== 'string' || body.portId !== portId(body.publicKey)) {
      throw new Error('Registry sequence, hash chain or identity rejected');
    }
    decodePublicKey(body.publicKey, 'ed25519');
    validTime(body.issuedAt);
    if (body.issuedAt < lastIssuedAt) throw new Error('Registry time rollback');
    lastIssuedAt = body.issuedAt;

    if (index === 0) {
      if (body.action !== 'reserve' || body.number !== 0 || body.portId !== pinned) {
        throw new Error('Port 0 founder reservation required');
      }
      byNumber.set(0, { number: 0, portId: pinned, publicKey: founder.publicKey, active: true });
      seenIds.add(pinned);
    } else if (body.action === 'assign') {
      if (body.number !== nextNumber || body.number >= Number.MAX_SAFE_INTEGER ||
          body.portId === pinned || seenIds.has(body.portId)) {
        throw new Error('Sequential port assignment or identity uniqueness rejected');
      }
      byNumber.set(body.number, { number: body.number, portId: body.portId,
        publicKey: body.publicKey, active: true });
      seenIds.add(body.portId);
      nextNumber++;
    } else if (body.action === 'revoke') {
      const prior = byNumber.get(body.number);
      if (body.number === 0 || !prior || !prior.active ||
          prior.portId !== body.portId || prior.publicKey !== body.publicKey) {
        throw new Error('Port revocation target rejected');
      }
      prior.active = false;
    } else throw new Error('Unknown registry event action');

    previousSha256 = digest(canonicalBytes(entry));
  }
  return Object.freeze({
    founderPortId: pinned, founderPublicKey: founder.publicKey,
    nextNumber, nextSequence: events.length, headSha256: previousSha256,
    registrations: Object.freeze([...byNumber.values()].map(record => Object.freeze({ ...record }))),
    nativeIpRouting: false, globallyReachable: false
  });
}

export function createFounderPortZero(founderIdentity, now = Date.now()) {
  const founder = validIdentity(founderIdentity);
  validTime(now);
  const body = { schema: NUMBERED_PORT_SCHEMA, action: 'reserve', sequence: 0, number: 0,
    portId: founder, publicKey: founderIdentity.publicKey,
    authorityPort: founder, previousSha256: null, issuedAt: now };
  const entries = [founderIdentity.sign(body)];
  verifyNumberedRegistry(entries, founder);
  return copy(entries);
}

function requireSigner(founderIdentity, events) {
  const founder = validIdentity(founderIdentity);
  const view = verifyNumberedRegistry(events, founder);
  if (founderIdentity.publicKey !== view.founderPublicKey) throw new Error('Founder signing key mismatch');
  return view;
}
function appendSigned(founderIdentity, events, view, event) {
  const last = events.at(-1).body.issuedAt;
  validTime(event.issuedAt);
  if (event.issuedAt < last) throw new Error('Registry time rollback');
  const body = { schema: NUMBERED_PORT_SCHEMA, authorityPort: view.founderPortId,
    sequence: view.nextSequence, previousSha256: view.headSha256, ...event };
  const result = [...events, founderIdentity.sign(body)];
  verifyNumberedRegistry(result, view.founderPortId);
  return copy(result);
}

export function assignNumberedPort(founderIdentity, events, candidatePublicKey, now = Date.now()) {
  const view = requireSigner(founderIdentity, events);
  decodePublicKey(candidatePublicKey, 'ed25519');
  const id = portId(candidatePublicKey);
  if (view.registrations.some(record => record.portId === id)) {
    throw new Error('Port already assigned or previously revoked; number never recycled');
  }
  return appendSigned(founderIdentity, events, view, {
    action: 'assign', number: view.nextNumber, portId: id,
    publicKey: candidatePublicKey, issuedAt: now
  });
}

export function revokeNumberedPort(founderIdentity, events, number, now = Date.now()) {
  const view = requireSigner(founderIdentity, events);
  const existing = view.registrations.find(record => record.number === number);
  if (!existing || !existing.active || number === 0) throw new Error('Only active nonzero ports may be revoked');
  return appendSigned(founderIdentity, events, view, {
    action: 'revoke', number, portId: existing.portId, publicKey: existing.publicKey,
    issuedAt: now
  });
}

export function resolveNumberedPort(events, expectedFounderPortId, number) {
  const view = verifyNumberedRegistry(events, expectedFounderPortId);
  const registration = view.registrations.find(record => record.number === number);
  if (!registration || !registration.active) throw new Error('Port number unknown or revoked');
  return Object.freeze({ ...registration, registryHeadSha256: view.headSha256,
    networkConnected: false, authorizationGranted: false, materializationVerified: false });
}

export function signNumberedTesseractPresence(identity, events, expectedFounderPortId, metadata, now = Date.now()) {
  validIdentity(identity);
  const view = verifyNumberedRegistry(events, expectedFounderPortId);
  const registration = view.registrations.find(record => record.portId === identity.id && record.active);
  if (!registration || registration.publicKey !== identity.publicKey) throw new Error('Unregistered or revoked port identity');
  if (!metadata?.capabilities?.includes('native.materialize.v1')) throw new Error('Tesseract native materialization capability required');
  const peerRecord = signPeerRecord(identity, { now, ...metadata });
  const body = { schema: NUMBERED_PRESENCE_SCHEMA, number: registration.number,
    portId: identity.id, registryHeadSha256: view.headSha256, peerRecord };
  const envelope = identity.sign(body);
  verifyNumberedTesseractPresence(envelope, events, expectedFounderPortId, now);
  return envelope;
}

export function verifyNumberedTesseractPresence(envelope, events, expectedFounderPortId, now = Date.now()) {
  const view = verifyNumberedRegistry(events, expectedFounderPortId);
  const body = envelope?.body;
  if (!body) throw new Error('Tesseract presence missing');
  exactFields(body, ['schema', 'number', 'portId', 'registryHeadSha256', 'peerRecord']);
  if (body.schema !== NUMBERED_PRESENCE_SCHEMA || body.registryHeadSha256 !== view.headSha256) {
    throw new Error('Presence registry head stale or invalid');
  }
  const registration = view.registrations.find(record => record.number === body.number && record.active);
  if (!registration || registration.portId !== body.portId) throw new Error('Presence port number mismatch or revoked');
  verifyEnvelope(envelope, registration.portId, registration.publicKey);
  const peer = verifyPeerRecord(body.peerRecord, now, registration.portId);
  if (peer.publicKey !== registration.publicKey || !peer.capabilities.includes('native.materialize.v1')) {
    throw new Error('Presence peer identity or capability mismatch');
  }
  return Object.freeze({
    number: registration.number, portId: registration.portId,
    tesseractEngine: Object.freeze({ ...peer.tesseractEngine }),
    boundWorker: Object.freeze({ ...peer.boundWorker }),
    capabilities: Object.freeze([...peer.capabilities]),
    expiresAt: peer.expiresAt, cryptographicPresenceVerified: true,
    nativeLogicalRouting: false, networkConnected: false,
    globallyReachable: false, materializationVerified: false
  });
}
