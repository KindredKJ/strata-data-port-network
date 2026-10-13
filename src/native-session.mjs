// Kindred Jermaine Cox / Kindred Labs. All rights reserved.
import { generateKeyPairSync, diffieHellman, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { canonicalBytes, digest, exactFields, decodePublicKey, verifyEnvelope, verifyPeerRecord } from './native-port-identity.mjs';

const suite = 'ED25519_X25519_HKDF_SHA256_AES256GCM_V1';
const frameCap = 4 * 1024 * 1024;
function scope(value) {
  exactFields(value, ['stateSha256', 'maxBytes']);
  if (!/^[a-f0-9]{64}$/.test(value.stateSha256) || !Number.isSafeInteger(value.maxBytes) || value.maxBytes < 1 || value.maxBytes > frameCap) throw new Error('Session state scope rejected');
}
export function validateAdapterDescriptor(adapter) {
  exactFields(adapter, ['id', 'substrate', 'underlyingIp', 'underlyingRouting']);
  if (!/^[a-z][a-z0-9./-]{0,63}$/.test(adapter.id) || !/^[A-Z][A-Z0-9_]{0,63}$/.test(adapter.substrate) ||
      typeof adapter.underlyingIp !== 'boolean' || typeof adapter.underlyingRouting !== 'boolean') throw new Error('Adapter dependency disclosure rejected');
}

// Independent owner policy. A worker/discovery record cannot authorize itself.
export class NativeSessionPolicy {
  #peers; #revoked = new Set(); #used = new Map();
  constructor({ authorizedPeers, permittedStates, replayCapacity = 256 }) {
    if (!Array.isArray(authorizedPeers) || !Array.isArray(permittedStates) ||
        authorizedPeers.length > 4096 || permittedStates.length > 4096 ||
        authorizedPeers.some(id => typeof id !== 'string' || !/^strata:port:ed25519:[a-f0-9]{64}$/.test(id)) ||
        permittedStates.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) ||
        !Number.isInteger(replayCapacity) || replayCapacity < 1 || replayCapacity > 4096) throw new Error('Explicit owner policy required');
    this.#peers = new Set(authorizedPeers); this.states = Object.freeze([...permittedStates]);
    this.capacity = replayCapacity;
    Object.freeze(this);
  }
  authorize(peer, state) {
    scope(state);
    if (!this.#peers.has(peer) || this.#revoked.has(peer) || !this.states.includes(state.stateSha256)) throw new Error('Deterministic owner policy denied');
  }
  revoke(peer) { if (!this.#peers.has(peer)) throw new Error('Unknown policy peer'); this.#revoked.add(peer); }
  consume(id, expiresAt, now) {
    for (const [key, expiry] of this.#used) if (expiry <= now) this.#used.delete(key);
    if (this.#used.has(id) || this.#used.size >= this.capacity) throw new Error('Session replay/capacity rejected');
    this.#used.set(id, expiresAt);
  }
}
Object.freeze(NativeSessionPolicy.prototype);
function deterministicPolicy(policy) {
  if (Object.getPrototypeOf(policy) !== NativeSessionPolicy.prototype) throw new Error('Independent deterministic policy required');
}
function control(body, now, kind) {
  const base = ['schema', 'suite', 'sessionId', 'fromPort', 'toPort', 'issuedAt', 'expiresAt', 'ephemeralKey', 'scope', 'adapter'];
  exactFields(body, kind === 'accept' ? [...base, 'offerSha256'] : base);
  if (body.schema !== 'kindred.sdpn.session-' + kind + '.v1' || body.suite !== suite ||
      !/^[a-f0-9]{32}$/.test(body.sessionId) || !Number.isSafeInteger(body.issuedAt) ||
      !Number.isSafeInteger(body.expiresAt) || body.issuedAt > now || body.expiresAt <= now ||
      body.expiresAt - body.issuedAt > 30_000 || body.expiresAt <= body.issuedAt) throw new Error('Native session control rejected');
  scope(body.scope); validateAdapterDescriptor(body.adapter); decodePublicKey(body.ephemeralKey, 'x25519');
}
function ephemeral() {
  const pair = generateKeyPairSync('x25519');
  return { privateKey: pair.privateKey, publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}
function connected(privateKey, peerKey, offer, accept, policy, local, peer) {
  // Snapshot signed controls so caller/worker mutation cannot change an active grant.
  offer = JSON.parse(canonicalBytes(offer)); accept = JSON.parse(canonicalBytes(accept));
  const shared = diffieHellman({ privateKey, publicKey: decodePublicKey(peerKey, 'x25519') });
  const binding = Buffer.from(digest(Buffer.concat([canonicalBytes(offer), canonicalBytes(accept)])), 'hex');
  const keys = {};
  try {
    for (const [name, from, to] of [['send', local, peer], ['receive', peer, local]]) keys[name] = Buffer.from(hkdfSync('sha256', shared, binding, Buffer.from(suite + '|' + from + '|' + to), 32));
  } finally { shared.fill(0); }
  let tx = 0, rx = 0, closed = false;
  const sessionId = offer.body.sessionId;
  function active(now) {
    if (closed || now >= Math.min(offer.body.expiresAt, accept.body.expiresAt)) throw new Error('Native session closed/expired');
    policy.authorize(peer, offer.body.scope);
  }
  function nonce(n) { const bytes = Buffer.alloc(12); bytes.writeBigUInt64BE(BigInt(n), 4); return bytes; }
  function aad(from, to, sequence) { return canonicalBytes({ schema: 'kindred.sdpn.native-frame.v1', sessionId, from, to, sequence, stateSha256: offer.body.scope.stateSha256 }); }
  return Object.freeze({
    id: sessionId, localPort: local, peerPort: peer,
    adapter: Object.freeze({ ...offer.body.adapter }), logicalIp: false, logicalRouting: false,
    seal(bytes, now = Date.now()) {
      active(now);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > offer.body.scope.maxBytes || tx >= 1024) throw new Error('Native frame quota');
      const cipher = createCipheriv('aes-256-gcm', keys.send, nonce(tx)); cipher.setAAD(aad(local, peer, tx));
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return { schema: 'kindred.sdpn.native-frame.v1', sessionId, sequence: tx++, ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    },
    open(frame, now = Date.now()) {
      active(now); exactFields(frame, ['schema', 'sessionId', 'sequence', 'ciphertext', 'tag']);
      if (frame.schema !== 'kindred.sdpn.native-frame.v1' || frame.sessionId !== sessionId || frame.sequence !== rx || rx >= 1024 ||
          typeof frame.ciphertext !== 'string' || frame.ciphertext.length > Math.ceil(offer.body.scope.maxBytes / 3) * 4 || typeof frame.tag !== 'string') throw new Error('Native frame ordering/bounds rejected');
      const ciphertext = Buffer.from(frame.ciphertext, 'base64'), tag = Buffer.from(frame.tag, 'base64');
      if (ciphertext.byteLength > offer.body.scope.maxBytes || ciphertext.toString('base64') !== frame.ciphertext || tag.length !== 16 || tag.toString('base64') !== frame.tag) throw new Error('Native frame encoding rejected');
      const cipher = createDecipheriv('aes-256-gcm', keys.receive, nonce(rx)); cipher.setAAD(aad(peer, local, rx)); cipher.setAuthTag(tag);
      let candidate;
      try { candidate = cipher.update(ciphertext); const tail = cipher.final(); const result = Buffer.concat([candidate, tail]); candidate.fill(0); tail.fill(0); rx++; return result; }
      catch { candidate?.fill(0); closed = true; keys.send.fill(0); keys.receive.fill(0); throw new Error('Native frame authentication rejected'); }
    },
    close() { closed = true; keys.send.fill(0); keys.receive.fill(0); }
  });
}

export function offerNativeSession(identity, peerRecord, state, adapter, policy, now = Date.now()) {
  deterministicPolicy(policy);
  const peer = verifyPeerRecord(peerRecord, now); policy.authorize(peer.portId, state); validateAdapterDescriptor(adapter);
  let key = ephemeral();
  const envelope = identity.sign({ schema: 'kindred.sdpn.session-offer.v1', suite, sessionId: randomBytes(16).toString('hex'),
    fromPort: identity.id, toPort: peer.portId, issuedAt: now, expiresAt: now + 30_000, ephemeralKey: key.publicKey, scope: state, adapter });
  let finished = false;
  return Object.freeze({ envelope,
    finish(accept, at = Date.now()) {
      if (finished) throw new Error('Native offer already consumed');
      const body = verifyEnvelope(accept, peer.portId, peer.publicKey); control(body, at, 'accept');
      if (body.fromPort !== peer.portId || body.toPort !== identity.id || body.sessionId !== envelope.body.sessionId ||
          body.offerSha256 !== digest(canonicalBytes(envelope)) || body.expiresAt !== envelope.body.expiresAt ||
          digest(canonicalBytes(body.scope)) !== digest(canonicalBytes(state)) || digest(canonicalBytes(body.adapter)) !== digest(canonicalBytes(adapter))) throw new Error('Native acceptance binding rejected');
      policy.authorize(peer.portId, state); finished = true;
      try { return connected(key.privateKey, body.ephemeralKey, envelope, accept, policy, identity.id, peer.portId); }
      finally { key = undefined; }
    },
    cancel() { finished = true; key = undefined; }
  });
}
export function acceptNativeSession(identity, offer, peerRecord, policy, adapter, now = Date.now()) {
  deterministicPolicy(policy);
  const peer = verifyPeerRecord(peerRecord, now);
  const body = verifyEnvelope(offer, peer.portId, peer.publicKey); control(body, now, 'offer');
  if (body.fromPort !== peer.portId || body.toPort !== identity.id || digest(canonicalBytes(body.adapter)) !== digest(canonicalBytes(adapter))) throw new Error('Native destination/adapter binding rejected');
  policy.authorize(peer.portId, body.scope); policy.consume(body.sessionId, body.expiresAt, now);
  const key = ephemeral();
  const envelope = identity.sign({ ...body, schema: 'kindred.sdpn.session-accept.v1', fromPort: identity.id, toPort: peer.portId,
    issuedAt: now, ephemeralKey: key.publicKey, offerSha256: digest(canonicalBytes(offer)) });
  return { envelope, session: connected(key.privateKey, body.ephemeralKey, offer, envelope, policy, identity.id, peer.portId) };
}
