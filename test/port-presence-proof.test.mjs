import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortIdentity, canonicalBytes } from '../src/native-port-identity.mjs';
import { createFounderPortZero, assignNumberedPort, revokeNumberedPort } from '../src/numbered-port-registry.mjs';
import { createPresenceProbe, answerPresenceProbe, verifyPresenceResponse,
  PendingPresenceProbes } from '../src/port-presence-proof.mjs';

const at = 1_800_000_000_000;
const founder = createPortIdentity({ testSeed: Buffer.alloc(32, 51) });
const alice = createPortIdentity({ testSeed: Buffer.alloc(32, 52) });
const bob = createPortIdentity({ testSeed: Buffer.alloc(32, 53) });
const eve = createPortIdentity({ testSeed: Buffer.alloc(32, 54) });
const direct = { id: 'direct.pipe/v1', substrate: 'ANONYMOUS_PIPE',
  underlyingIp: false, underlyingRouting: false };
const routed = { id: 'compatibility.internet/v1', substrate: 'EXISTING_IP_NETWORK',
  underlyingIp: true, underlyingRouting: true };
function registry() {
  return assignNumberedPort(founder,
    assignNumberedPort(founder, createFounderPortZero(founder, at), alice.publicKey, at + 1),
    bob.publicKey, at + 2);
}
function challenge(events = registry()) {
  return createPresenceProbe({
    identity: alice, events, founderPortId: founder.id, targetPortNumber: 2,
    adapter: direct, now: at + 10, ttlMs: 15000
  });
}

test('two numbered ports authenticate an exact signed challenge-response without routing or payload', () => {
  const events = registry();
  const track = new PendingPresenceProbes();
  const probe = track.issue({
    identity: alice, events, founderPortId: founder.id,
    targetPortNumber: 2, adapter: direct, now: at + 10
  });
  const reply = answerPresenceProbe({
    identity: bob, events, founderPortId: founder.id, probe, now: at + 11
  });
  const proof = track.consume({
    events, founderPortId: founder.id, probe, response: reply, now: at + 12
  });
  assert.equal(proof.challengerPort, alice.id);
  assert.equal(proof.responderPort, bob.id);
  assert.equal(proof.responderNumber, 2);
  assert.equal(proof.cryptographicResponseVerified, true);
  assert.equal(proof.payloadBytesTransportedByPresenceProtocol, 0);
  assert.equal(proof.reportedAdapter.underlyingRouting, false);
  assert.equal(proof.routeFreePhysicalTransportVerified, false);
  assert.equal(proof.globalReachabilityVerified, false);
  assert.equal(proof.destinationTesseractReconstructionVerified, false);
  assert.equal(track.pendingCount, 0);
  assert.throws(() => track.consume({
    events, founderPortId: founder.id, probe, response: reply, now: at + 12
  }), /replay/);
});

test('every assigned port can respond and founder Port 0 remains uniquely pinned', () => {
  const events = registry();
  const probe = createPresenceProbe({
    identity: bob, events, founderPortId: founder.id,
    targetPortNumber: 0, adapter: direct, now: at + 10
  });
  const reply = answerPresenceProbe({
    identity: founder, events, founderPortId: founder.id, probe, now: at + 11
  });
  const result = verifyPresenceResponse({
    events, founderPortId: founder.id, probe, response: reply, now: at + 12
  });
  assert.equal(result.responderNumber, 0);
  assert.equal(result.responderPort, founder.id);
  assert.equal(result.globalReachabilityVerified, false);
  assert.throws(() => verifyPresenceResponse({
    events, founderPortId: eve.id, probe, response: reply, now: at + 12
  }), /anchor/);
  assert.throws(() => createPresenceProbe({
    identity: eve, events, founderPortId: founder.id,
    targetPortNumber: 2, adapter: direct, now: at + 10
  }), /Unknown or revoked/);
});

test('route-free strict mode never treats Wi-Fi TCP/IP as a native direct connection', () => {
  const events = registry();
  assert.throws(() => createPresenceProbe({
    identity: alice, events, founderPortId: founder.id,
    targetPortNumber: 2, adapter: routed, now: at + 10
  }), /rejects IP or routed/);
  const falseRouteFree = { ...direct, underlyingRouting: true };
  assert.throws(() => createPresenceProbe({
    identity: alice, events, founderPortId: founder.id,
    targetPortNumber: 2, adapter: falseRouteFree, now: at + 10
  }), /rejects IP or routed/);
  assert.throws(() => createPresenceProbe({
    identity: alice, events, founderPortId: founder.id,
    targetPortNumber: 1, adapter: direct, now: at + 10
  }), /Cannot challenge own/);
});

test('signed presence rejects forgery, wrong recipient, stale registry, expiry and revocation', () => {
  const events = registry();
  const probe = challenge(events);
  const signed = answerPresenceProbe({
    identity: bob, events, founderPortId: founder.id, probe, now: at + 11
  });
  assert.throws(() => answerPresenceProbe({
    identity: eve, events, founderPortId: founder.id, probe, now: at + 11
  }), /identity does not match/);
  const invalid = structuredClone(signed);
  invalid.body.responderPort = eve.id;
  assert.throws(() => verifyPresenceResponse({
    events, founderPortId: founder.id, probe, response: invalid, now: at + 12
  }), /binding/);
  const alteredChallenge = structuredClone(probe);
  alteredChallenge.body.challengedPort = eve.id;
  assert.throws(() => verifyPresenceResponse({
    events, founderPortId: founder.id, probe: alteredChallenge, response: signed, now: at + 12
  }), /Unknown or revoked|signature/);
  assert.throws(() => verifyPresenceResponse({
    events, founderPortId: founder.id, probe, response: signed, now: at + 15_010
  }), /expired/);
  const revoked = revokeNumberedPort(founder, events, 2, at + 12);
  assert.throws(() => verifyPresenceResponse({
    events: revoked, founderPortId: founder.id, probe, response: signed, now: at + 13
  }), /stale/);
});

test('unsolicited presence responses and pending quotas cannot inflate online status', () => {
  const events = registry();
  const tracker = new PendingPresenceProbes({ maxPending: 1 });
  const one = tracker.issue({
    identity: alice, events, founderPortId: founder.id,
    targetPortNumber: 2, adapter: direct, now: at + 10
  });
  assert.throws(() => tracker.issue({
    identity: alice, events, founderPortId: founder.id,
    targetPortNumber: 2, adapter: direct, now: at + 11
  }), /quota/);
  const reply = answerPresenceProbe({
    identity: bob, events, founderPortId: founder.id, probe: one, now: at + 12
  });
  const unsolicited = challenge(events);
  assert.throws(() => tracker.consume({
    events, founderPortId: founder.id, probe: unsolicited, response: reply, now: at + 13
  }), /unsolicited/);
  assert.equal(tracker.pendingCount, 1);
  const observed = tracker.consume({
    events, founderPortId: founder.id, probe: one, response: reply, now: at + 13
  });
  assert.equal(observed.cryptographicResponseVerified, true);
  assert.equal(tracker.pendingCount, 0);
});

test('challenge contains only signed control metadata, never data, transport endpoints or keys', () => {
  const offer = challenge();
  assert.deepEqual(Object.keys(offer.body).sort(), [
    'schema', 'nonce', 'challengerPort', 'challengedPort',
    'registryHeadSha256', 'issuedAt', 'expiresAt', 'adapter'
  ].sort());
  const bytes = canonicalBytes(offer);
  assert.equal(bytes.includes(Buffer.from('192.168.')), false);
  assert.equal('payload' in offer.body, false);
  assert.equal('ip' in offer.body, false);
  assert.equal('privateKey' in offer.body, false);
});
