import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortIdentity, signPeerRecord, digest, canonicalBytes } from '../src/native-port-identity.mjs';
import { NativeSessionPolicy, offerNativeSession, acceptNativeSession } from '../src/native-session.mjs';
import {
  NUMBERED_PORT_SCHEMA, createFounderPortZero, verifyNumberedRegistry,
  assignNumberedPort, revokeNumberedPort, resolveNumberedPort,
  signNumberedTesseractPresence, verifyNumberedTesseractPresence
} from '../src/numbered-port-registry.mjs';

const now = 1_800_000_000_000;
const founder = createPortIdentity({ testSeed: Buffer.alloc(32, 10) });
const alice = createPortIdentity({ testSeed: Buffer.alloc(32, 11) });
const bob = createPortIdentity({ testSeed: Buffer.alloc(32, 12) });
const stranger = createPortIdentity({ testSeed: Buffer.alloc(32, 13) });
const metadata = {
  capabilities: ['native.materialize.v1'],
  tesseractEngine: { id: 'strata-tesseract-1', version: '1.0.0', evidenceStatus: 'DECLARED' },
  boundWorker: { id: 'kindred-port-worker', version: '1.0.0', evidenceStatus: 'DECLARED' }
};
function registered() {
  return assignNumberedPort(founder,
    assignNumberedPort(founder, createFounderPortZero(founder, now), alice.publicKey, now + 1),
    bob.publicKey, now + 2);
}

test('Port Zero is cryptographically pinned to founder; registration starts at one', () => {
  const original = createFounderPortZero(founder, now);
  assert.equal(original[0].body.schema, NUMBERED_PORT_SCHEMA);
  assert.equal(original[0].body.number, 0);
  assert.equal(original[0].body.action, 'reserve');
  assert.equal(verifyNumberedRegistry(original, founder.id).nextNumber, 1);
  assert.throws(() => verifyNumberedRegistry(original, stranger.id), /anchor/);
  assert.throws(() => assignNumberedPort(stranger, original, alice.publicKey, now + 1), /anchor/);

  const entries = registered(), view = verifyNumberedRegistry(entries, founder.id);
  assert.deepEqual(view.registrations.map(r => [r.number, r.portId, r.active]),
    [[0, founder.id, true], [1, alice.id, true], [2, bob.id, true]]);
  assert.equal(view.nextNumber, 3);
  assert.equal(view.nextSequence, 3);
  assert.equal(view.globallyReachable, false);
  assert.equal(resolveNumberedPort(entries, founder.id, 0).portId, founder.id);
  assert.equal(resolveNumberedPort(entries, founder.id, 2).networkConnected, false);
});

test('duplicate identities, forged Port 0, skipped numbers and hash-chain tampering fail', () => {
  const entries = registered();
  assert.throws(() => assignNumberedPort(founder, entries, alice.publicKey, now + 3), /already assigned/);
  assert.throws(() => assignNumberedPort(founder, entries, founder.publicKey, now + 3), /already assigned/);
  assert.throws(() => assignNumberedPort(founder, entries, 'notbase64', now + 3));
  const corrupt = structuredClone(entries);
  corrupt[1].body.number = 7;
  assert.throws(() => verifyNumberedRegistry(corrupt, founder.id), /signature/);
  const swapped = structuredClone(entries);
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.throws(() => verifyNumberedRegistry(swapped, founder.id), /sequence|chain/);
  const forged = structuredClone(entries);
  forged[0] = stranger.sign({ ...forged[0].body, publicKey: stranger.publicKey });
  assert.throws(() => verifyNumberedRegistry(forged, founder.id), /anchor/);
  const extra = structuredClone(entries);
  extra[1].body.route = '127.0.0.1';
  assert.throws(() => verifyNumberedRegistry(extra, founder.id), /signature|fields/);
  assert.throws(() => assignNumberedPort(founder, entries, stranger.publicKey, now - 1), /rollback/);
});

test('revoke nonzero ports without ever recycling numbers or changing Port Zero', () => {
  const entries = registered();
  const revoked = revokeNumberedPort(founder, entries, 1, now + 3);
  const view = verifyNumberedRegistry(revoked, founder.id);
  assert.equal(view.registrations.find(r => r.number === 1).active, false);
  assert.equal(view.nextNumber, 3);
  assert.equal(view.nextSequence, 4);
  assert.throws(() => resolveNumberedPort(revoked, founder.id, 1), /revoked/);
  assert.throws(() => revokeNumberedPort(founder, revoked, 0, now + 4), /nonzero/);
  assert.throws(() => revokeNumberedPort(founder, revoked, 1, now + 4), /active/);
  assert.throws(() => assignNumberedPort(founder, revoked, alice.publicKey, now + 4), /never recycled/);
  const extended = assignNumberedPort(founder, revoked, stranger.publicKey, now + 4);
  assert.equal(verifyNumberedRegistry(extended, founder.id).registrations.at(-1).number, 3);
});

test('signed Tesseract presence is bound to a registered number and registry head, not reachability', () => {
  const entries = registered();
  const presence = signNumberedTesseractPresence(alice, entries, founder.id, metadata, now + 3);
  const verified = verifyNumberedTesseractPresence(presence, entries, founder.id, now + 4);
  assert.equal(verified.portId, alice.id);
  assert.equal(verified.number, 1);
  assert.equal(verified.tesseractEngine.id, 'strata-tesseract-1');
  assert.equal(verified.cryptographicPresenceVerified, true);
  assert.equal(verified.globallyReachable, false);
  assert.equal(verified.networkConnected, false);
  assert.equal(verified.materializationVerified, false);
  assert.equal(verified.nativeLogicalRouting, false);
  assert.throws(() => signNumberedTesseractPresence(stranger, entries, founder.id, metadata, now + 3), /Unregistered/);
  assert.throws(() => verifyNumberedTesseractPresence(presence, entries, stranger.id, now + 4), /anchor/);
  assert.throws(() => verifyNumberedTesseractPresence(presence, entries, founder.id, now + 60_004), /lifetime/);

  const tampered = structuredClone(presence);
  tampered.body.number = 0;
  assert.throws(() => verifyNumberedTesseractPresence(tampered, entries, founder.id, now + 4), /mismatch/);

  const revoked = revokeNumberedPort(founder, entries, 1, now + 5);
  assert.throws(() => verifyNumberedTesseractPresence(presence, revoked, founder.id, now + 6), /stale/);
  assert.throws(() => signNumberedTesseractPresence(alice, revoked, founder.id, metadata, now + 6), /revoked/);
});

test('numeric registration does not replace native cryptographic sessions or conceal IP underlay', () => {
  const entries = registered();
  const aad = signNumberedTesseractPresence(alice, entries, founder.id, metadata, now + 3);
  const bbd = signNumberedTesseractPresence(bob, entries, founder.id, metadata, now + 3);
  const a = verifyNumberedTesseractPresence(aad, entries, founder.id, now + 4);
  const b = verifyNumberedTesseractPresence(bbd, entries, founder.id, now + 4);
  const ar = signPeerRecord(alice, { now: now + 3, ...metadata });
  const br = signPeerRecord(bob, { now: now + 3, ...metadata });
  const adapter = { id: 'compatibility.internet/v1', substrate: 'EXISTING_IP_NETWORK',
    underlyingIp: true, underlyingRouting: true };
  const state = { stateSha256: digest(Buffer.from('hello')), maxBytes: 64 };
  const ap = new NativeSessionPolicy({ authorizedPeers: [b.portId],
    permittedStates: [state.stateSha256], permittedAdapters: [adapter] });
  const bp = new NativeSessionPolicy({ authorizedPeers: [a.portId],
    permittedStates: [state.stateSha256], permittedAdapters: [adapter] });
  const offer = offerNativeSession(alice, br, state, adapter, ap, now + 3);
  const accepted = acceptNativeSession(bob, offer.envelope, ar, bp, adapter, now + 3);
  const sender = offer.finish(accepted.envelope, now + 3);
  assert.equal(sender.logicalRouting, false);
  assert.equal(sender.adapter.underlyingRouting, true);
  assert.equal(accepted.session.open(sender.seal(Buffer.from('hello'), now + 3), now + 3).toString(), 'hello');
  sender.close(); accepted.session.close();
  assert.equal(digest(canonicalBytes(entries.at(-1))), verifyNumberedRegistry(entries, founder.id).headSha256);
});
