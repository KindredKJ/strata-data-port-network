import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortIdentity, signPeerRecord, verifyPeerRecord, SignedPeerDirectory, canonicalBytes, digest } from '../src/native-port-identity.mjs';
import { NativeSessionPolicy, offerNativeSession, acceptNativeSession } from '../src/native-session.mjs';

const now = 1_000_000;
const state = { stateSha256: 'a'.repeat(64), maxBytes: 1024 };
const adapter = { id: 'direct.pipe/v1', substrate: 'ANONYMOUS_PIPE', underlyingIp: false, underlyingRouting: false };
const metadata = { capabilities: ['native.materialize.v1'],
  tesseractEngine: { id: 'strata-tesseract-1', version: '1.0.0', evidenceStatus: 'DECLARED' },
  boundWorker: { id: 'kindred-port-worker', version: '1.0.0', evidenceStatus: 'DECLARED' } };
function pair(selectedAdapter = adapter) {
  const a = createPortIdentity(), b = createPortIdentity();
  const ar = signPeerRecord(a, { now, ...metadata }), br = signPeerRecord(b, { now, ...metadata });
  const ap = new NativeSessionPolicy({ authorizedPeers: [b.id], permittedStates: [state.stateSha256] });
  const bp = new NativeSessionPolicy({ authorizedPeers: [a.id], permittedStates: [state.stateSha256] });
  const offer = offerNativeSession(a, br, state, selectedAdapter, ap, now);
  const accept = acceptNativeSession(b, offer.envelope, ar, bp, selectedAdapter, now);
  return { a, b, ar, br, ap, bp, offer, accept, as: offer.finish(accept.envelope, now), bs: accept.session };
}

test('native identity is cryptographic, stable for RFC8032 seed, and not an IP address', () => {
  const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
  const identity = createPortIdentity({ testSeed: seed });
  assert.match(identity.id, /^strata:port:ed25519:[a-f0-9]{64}$/);
  assert.equal(Buffer.from(identity.publicKey, 'base64').subarray(-32).toString('hex'), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  assert.equal(createPortIdentity({ testSeed: seed }).id, identity.id);
  const record = signPeerRecord(identity, { now, ...metadata });
  assert.equal(verifyPeerRecord(record, now, identity.id).portId, identity.id);
  assert.equal('privateKey' in identity, false);
});
test('signed discovery rejects tampering, impersonation, expiry and undocumented fields', () => {
  const { ar, b } = pair();
  const bad = structuredClone(ar); bad.body.boundWorker.id = 'malicious-worker';
  assert.throws(() => verifyPeerRecord(bad, now), /signature/);
  assert.throws(() => verifyPeerRecord(ar, now, b.id), /identity/);
  assert.throws(() => verifyPeerRecord(ar, now + 60_001), /lifetime/);
  const unknown = structuredClone(ar); unknown.body.ip = '127.0.0.1';
  assert.throws(() => verifyPeerRecord(unknown, now));
});
test('directory bounds, revocation and revision rollback are deterministic', () => {
  const { a, ar, br } = pair();
  const directory = new SignedPeerDirectory({ capacity: 1 });
  directory.ingest(ar, now);
  assert.throws(() => directory.ingest(br, now), /capacity/);
  const next = signPeerRecord(a, { revision: 2, now, ...metadata });
  directory.ingest(next, now);
  assert.throws(() => directory.ingest(ar, now), /rollback/);
  directory.revoke(a.id);
  assert.throws(() => directory.get(a.id, now), /revoked/);
  assert.throws(() => directory.ingest(next, now), /revoked/);
});
test('peer sessions negotiate without any Strata Cloud dependency', () => {
  const p = pair();
  assert.equal(p.as.peerPort, p.b.id);
  assert.equal(p.bs.peerPort, p.a.id);
  assert.equal(p.as.logicalIp, false); assert.equal(p.as.logicalRouting, false);
  const forward = p.as.seal(Buffer.from('forward binary\0\xff', 'latin1'), now);
  const reverse = p.bs.seal(Buffer.from('reverse binary\0\xff', 'latin1'), now);
  assert.equal(p.bs.open(forward, now).toString('latin1'), 'forward binary\0\xff');
  assert.equal(p.as.open(reverse, now).toString('latin1'), 'reverse binary\0\xff');
  assert.equal(forward.sequence, 0); assert.equal(reverse.sequence, 0);
  p.as.close(); p.bs.close();
});
test('internet adapter dependencies are explicit without changing native port identity', () => {
  const network = { id: 'compatibility.internet/v1', substrate: 'EXISTING_IP_NETWORK', underlyingIp: true, underlyingRouting: true };
  const p = pair(network);
  assert.equal(p.as.adapter.underlyingIp, true); assert.equal(p.as.adapter.underlyingRouting, true);
  assert.equal(p.as.logicalIp, false); assert.equal(p.as.logicalRouting, false);
  assert.match(p.as.peerPort, /^strata:port:ed25519:/);
  p.as.close(); p.bs.close();
});
test('self-signed advertisements do not grant authorization', () => {
  const { a, br } = pair();
  const denied = new NativeSessionPolicy({ authorizedPeers: [], permittedStates: [state.stateSha256] });
  assert.throws(() => offerNativeSession(a, br, state, adapter, denied, now), /policy denied/);
  assert.throws(() => new NativeSessionPolicy({ authorizedPeers: ['127.0.0.1'], permittedStates: [] }), /owner policy/);
  assert.throws(() => offerNativeSession(a, br, state, adapter, { authorize() {} }, now), /deterministic policy/);
  class WorkerOverride extends NativeSessionPolicy { authorize() {} }
  const override = new WorkerOverride({ authorizedPeers: [], permittedStates: [] });
  assert.throws(() => offerNativeSession(a, br, state, adapter, override, now), /deterministic policy/);
});
test('offer replay, signature corruption and adapter substitution are rejected', () => {
  const p = pair();
  assert.throws(() => acceptNativeSession(p.b, p.offer.envelope, p.ar, p.bp, adapter, now), /replay/);
  const bad = structuredClone(p.accept.envelope); bad.body.ephemeralKey = p.offer.envelope.body.ephemeralKey;
  const fresh = offerNativeSession(p.a, p.br, state, adapter, p.ap, now);
  assert.throws(() => fresh.finish(bad, now), /signature/);
  const wrongAdapter = { ...adapter, underlyingIp: true };
  assert.throws(() => acceptNativeSession(p.b, fresh.envelope, p.ar, p.bp, wrongAdapter, now), /adapter binding/);
  fresh.cancel(); p.as.close(); p.bs.close();
});
test('frame corruption, replay, reordering and cross-session frames fail closed', () => {
  const p = pair(); const frame = p.as.seal(Buffer.from('protected'), now);
  assert.equal(p.bs.open(frame, now).toString(), 'protected');
  assert.throws(() => p.bs.open(frame, now), /ordering/);
  const q = pair(); const altered = q.as.seal(Buffer.from('protected'), now);
  altered.ciphertext = Buffer.from('corrupted').toString('base64');
  assert.throws(() => q.bs.open(altered, now), /authentication/);
  assert.throws(() => q.bs.open(q.as.seal(Buffer.from('later'), now), now), /closed/);
  const cross = pair(); assert.throws(() => cross.bs.open(frame, now), /ordering/);
  p.as.close(); q.as.close(); cross.as.close(); cross.bs.close();
});
test('expiry, revocation, quotas and caller mutation cannot bypass policy', () => {
  const p = pair();
  p.offer.envelope.body.expiresAt = now + 999_999;
  assert.throws(() => p.as.seal(Buffer.from('expired'), now + 30_001), /expired/);
  const q = pair();
  assert.throws(() => q.as.seal(Buffer.alloc(1025), now), /quota/);
  q.ap.revoke(q.b.id);
  assert.throws(() => q.as.seal(Buffer.from('revoked'), now), /policy denied/);
  assert.throws(() => { q.ap.states = ['b'.repeat(64)]; }, TypeError);
  assert.throws(() => q.as.open({ schema: 'v2' }, now), /policy denied/);
  p.as.close(); p.bs.close(); q.as.close(); q.bs.close();
});
test('native protocol suite reports deterministic public record vector', () => {
  const seed = Buffer.alloc(32, 7), identity = createPortIdentity({ testSeed: seed });
  const record = signPeerRecord(identity, { now, ...metadata });
  assert.equal(digest(canonicalBytes(record)), digest(canonicalBytes(signPeerRecord(createPortIdentity({ testSeed: seed }), { now, ...metadata }))));
});
