// Kindred Labs SDPN — signed endpoint presence coordination, never a payload router.
// A valid signed exchange proves a cryptographic response, NOT worldwide physical reach,
// carrier path, host location or arbitrary new-data reconstruction.
import { randomBytes } from 'node:crypto';
import { canonicalBytes, digest, exactFields, verifyEnvelope, portId } from './native-port-identity.mjs';
import { verifyNumberedRegistry } from './numbered-port-registry.mjs';
import { validateAdapterDescriptor } from './native-session.mjs';

export const PRESENCE_PROBE_SCHEMA = 'kindred.sdpn.presence.probe.v1';
export const PRESENCE_RESPONSE_SCHEMA = 'kindred.sdpn.presence.response.v1';
const PROBE_FIELDS = ['schema', 'nonce', 'challengerPort', 'challengedPort',
  'registryHeadSha256', 'issuedAt', 'expiresAt', 'adapter'];
const RESPONSE_FIELDS = ['schema', 'nonce', 'probeSha256', 'challengerPort',
  'responderPort', 'registryHeadSha256', 'respondedAt'];
const NONCE = /^[a-f0-9]{32}$/;
const MAX_TTL_MS = 30_000;

function checkTime(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Presence time rejected');
}
function checkIdentity(identity) {
  if (!identity || typeof identity.id !== 'string' || typeof identity.publicKey !== 'string' ||
      typeof identity.sign !== 'function' || portId(identity.publicKey) !== identity.id) {
    throw new Error('Authentic signing Port identity required');
  }
}
function activePort(view, portIdToFind) {
  const entry = view.registrations.find(p => p.portId === portIdToFind && p.active);
  if (!entry) throw new Error('Unknown or revoked numbered Port');
  return entry;
}
function strictAdapter(adapter) {
  validateAdapterDescriptor(adapter);
  if (adapter.underlyingIp !== false || adapter.underlyingRouting !== false) {
    throw new Error('Strict presence protocol rejects IP or routed adapters');
  }
  // A caller-supplied descriptor is not independently validated physical evidence.
  return adapter;
}
function strictProbe(probe, view, now) {
  checkTime(now);
  const body = probe?.body;
  exactFields(body, PROBE_FIELDS);
  if (body.schema !== PRESENCE_PROBE_SCHEMA || !NONCE.test(body.nonce) ||
      body.registryHeadSha256 !== view.headSha256 ||
      !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt) ||
      body.issuedAt > now || now >= body.expiresAt ||
      body.expiresAt - body.issuedAt < 1 ||
      body.expiresAt - body.issuedAt > MAX_TTL_MS) {
    throw new Error('Presence challenge expired, stale or malformed');
  }
  strictAdapter(body.adapter);
  const source = activePort(view, body.challengerPort);
  activePort(view, body.challengedPort);
  if (body.challengerPort === body.challengedPort) {
    throw new Error('Self-presence challenge cannot prove a remote Port');
  }
  verifyEnvelope(probe, source.portId, source.publicKey);
  return body;
}

export function createPresenceProbe({
  identity, events, founderPortId, targetPortNumber, adapter,
  now = Date.now(), ttlMs = 10_000
}) {
  checkIdentity(identity);
  checkTime(now);
  strictAdapter(adapter);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS ||
      now + ttlMs > Number.MAX_SAFE_INTEGER) throw new Error('Presence challenge TTL rejected');
  const view = verifyNumberedRegistry(events, founderPortId);
  const source = activePort(view, identity.id);
  if (source.publicKey !== identity.publicKey) throw new Error('Challenger key does not match assigned Port');
  if (!Number.isSafeInteger(targetPortNumber) || targetPortNumber < 0) {
    throw new Error('Destination Port number required');
  }
  const target = view.registrations.find(x => x.number === targetPortNumber && x.active);
  if (!target) throw new Error('Destination Port unregistered or revoked');
  if (source.portId === target.portId) throw new Error('Cannot challenge own Port');
  const body = {
    schema: PRESENCE_PROBE_SCHEMA,
    nonce: randomBytes(16).toString('hex'),
    challengerPort: identity.id, challengedPort: target.portId,
    registryHeadSha256: view.headSha256, issuedAt: now,
    expiresAt: now + ttlMs, adapter: JSON.parse(canonicalBytes(adapter))
  };
  const envelope = identity.sign(body);
  strictProbe(envelope, view, now);
  return envelope;
}

export function answerPresenceProbe({
  identity, events, founderPortId, probe, now = Date.now()
}) {
  checkIdentity(identity);
  const view = verifyNumberedRegistry(events, founderPortId);
  const request = strictProbe(probe, view, now);
  if (identity.id !== request.challengedPort ||
      activePort(view, identity.id).publicKey !== identity.publicKey) {
    throw new Error('Responder identity does not match challenged Port');
  }
  const body = {
    schema: PRESENCE_RESPONSE_SCHEMA, nonce: request.nonce,
    probeSha256: digest(canonicalBytes(probe)),
    challengerPort: request.challengerPort, responderPort: identity.id,
    registryHeadSha256: view.headSha256, respondedAt: now
  };
  return identity.sign(body);
}

export function verifyPresenceResponse({
  events, founderPortId, probe, response, now = Date.now()
}) {
  checkTime(now);
  const view = verifyNumberedRegistry(events, founderPortId);
  const request = strictProbe(probe, view, now);
  const body = response?.body;
  exactFields(body, RESPONSE_FIELDS);
  if (body.schema !== PRESENCE_RESPONSE_SCHEMA ||
      body.nonce !== request.nonce ||
      body.probeSha256 !== digest(canonicalBytes(probe)) ||
      body.challengerPort !== request.challengerPort ||
      body.responderPort !== request.challengedPort ||
      body.registryHeadSha256 !== view.headSha256 ||
      !Number.isSafeInteger(body.respondedAt) ||
      body.respondedAt < request.issuedAt ||
      body.respondedAt > now || body.respondedAt >= request.expiresAt) {
    throw new Error('Presence response binding, timing or identity rejected');
  }
  const responder = activePort(view, request.challengedPort);
  verifyEnvelope(response, responder.portId, responder.publicKey);
  return Object.freeze({
    schema: 'kindred.sdpn.presence.observation.v1',
    challengerPort: request.challengerPort,
    responderPort: request.challengedPort,
    responderNumber: responder.number,
    probeSha256: digest(canonicalBytes(probe)),
    responseSha256: digest(canonicalBytes(response)),
    reportedAdapter: Object.freeze({ ...request.adapter }),
    cryptographicResponseVerified: true,
    payloadBytesTransportedByPresenceProtocol: 0,
    physicalHostAttestationProven: false,
    physicalCarrierIndependentlyAudited: false,
    globalReachabilityVerified: false,
    routeFreePhysicalTransportVerified: false,
    destinationTesseractReconstructionVerified: false
  });
}

// Tracks locally-issued, one-time challenges. It does NOT open sockets, discover
// or register public endpoints, or authorize remote work. Record nonces durably in
// a future managed deployment to prevent replay after process restart.
export class PendingPresenceProbes {
  #pending = new Map();
  constructor({ maxPending = 256 } = {}) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 4096) {
      throw new Error('Pending presence capacity rejected');
    }
    this.maxPending = maxPending;
  }
  issue(params) {
    const now = params?.now ?? Date.now();
    checkTime(now);
    for (const [nonce, state] of this.#pending) {
      if (state.expiresAt <= now) this.#pending.delete(nonce);
    }
    if (this.#pending.size >= this.maxPending) throw new Error('Presence pending quota exceeded');
    const probe = createPresenceProbe(params);
    this.#pending.set(probe.body.nonce, {
      probeSha256: digest(canonicalBytes(probe)),
      expiresAt: probe.body.expiresAt
    });
    return probe;
  }
  consume({ events, founderPortId, probe, response, now = Date.now() }) {
    const match = probe?.body?.nonce && this.#pending.get(probe.body.nonce);
    if (!match || match.probeSha256 !== digest(canonicalBytes(probe))) {
      throw new Error('Presence response replay or unsolicited challenge rejected');
    }
    const observation = verifyPresenceResponse({ events, founderPortId, probe, response, now });
    this.#pending.delete(probe.body.nonce);
    return observation;
  }
  get pendingCount() { return this.#pending.size; }
}
