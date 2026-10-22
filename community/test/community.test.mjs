// Copyright 2026 Kindred Jermaine Cox and Kindred Labs.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMMUNITY_SCHEMA, createCommunityIdentity, importCommunityIdentity, portIdentifier,
  signCommunityNames, verifyCommunityNames, resolveCommunityPort, communityPortUri,
  parseCommunityPortUri,
} from '../src/index.mjs';
import { communityCatalog, capabilityIsFree, evaluateAccess,
  COMMUNITY_CAPABILITIES } from '../src/access.mjs';

// Existing proprietary PORT/1 is imported ONLY in integration tests to verify interoperability.
// The standalone community distribution itself has no proprietary imports.
import { portId, verifyPeerRecord } from '../../src/native-port-identity.mjs';
import { verifyPortNames, resolvePortName, makePortUri } from '../../src/port-names.mjs';

test('free identities are generated offline with portable recoverable private key', () => {
  const identity = createCommunityIdentity();
  assert.match(identity.id, /^strata:port:ed25519:[a-f0-9]{64}$/);
  assert.equal(portId(identity.publicKey), identity.id);
  assert.equal(portIdentifier(identity.publicKey), identity.id);
  const pem = identity.exportPrivateKeyPem();
  assert.match(pem, /^-----BEGIN PRIVATE KEY-----/);
  const imported = importCommunityIdentity(pem);
  assert.equal(imported.id, identity.id);
  assert.equal(imported.publicKey, identity.publicKey);
  assert.throws(() => importCommunityIdentity('not a key'), Error);
});

test('community owner can issue a signed, portable, interoperable Port/1 namespace', () => {
  const identity = createCommunityIdentity();
  const recipient = createCommunityIdentity();
  const now = 1_800_000_000_000;
  const signed = signCommunityNames(identity, [
    { name: '', targetPort: identity.id },
    { name: 'portal', targetPort: identity.id },
    { name: 'workspace.community', targetPort: recipient.id },
  ], { now, ttlMs: 90_000, revision: 7 });
  assert.equal(signed.body.schema, COMMUNITY_SCHEMA);
  assert.equal(verifyCommunityNames(signed, now).ownerPort, identity.id);
  assert.equal(verifyPortNames(signed, now).ownerPort, identity.id);
  const address = communityPortUri(identity.id, 'workspace.community', '/documents/current');
  assert.equal(address, makePortUri(identity.id, 'workspace.community', '/documents/current'));
  const result = resolveCommunityPort(address, signed, now);
  assert.equal(result.targetPort, recipient.id);
  assert.equal(resolvePortName(address, signed, now).targetPort, recipient.id);
  assert.equal(result.signedIdentityVerified, true);
  assert.equal(result.connected, false);
  assert.equal(result.authorized, false);
  assert.equal(result.nameFeeRequired, false);
  assert.deepEqual(parseCommunityPortUri(address), {
    uri: address, ownerPort: identity.id, name: 'workspace.community', path: '/documents/current',
  });
  assert.equal(verifyPeerRecord ? typeof verifyPeerRecord : 'function', 'function');
});

test('community public signatures reject invalid data, replay/expiry and false ownership', () => {
  const owner = createCommunityIdentity();
  const other = createCommunityIdentity();
  const now = 1_800_000_000_000;
  const entries = [{ name: '', targetPort: owner.id }, { name: 'api', targetPort: other.id }];
  const signed = signCommunityNames(owner, entries, { now, ttlMs: 1000 });
  const altered = structuredClone(signed);
  altered.body.entries[1].targetPort = owner.id;
  assert.throws(() => verifyCommunityNames(altered, now), /signature/);
  assert.throws(() => verifyCommunityNames(signed, now + 1000), /lifetime/);
  assert.throws(() => resolveCommunityPort(communityPortUri(other.id, 'api'), signed, now), /authority/);
  assert.throws(() => signCommunityNames(owner, [entries[0], entries[0]], { now }), /Duplicate/);
  assert.throws(() => signCommunityNames(owner, [{ name: '*', targetPort: owner.id }], { now }), /alias syntax/);
  assert.throws(() => signCommunityNames(owner, entries, { now, ttlMs: 3_600_001 }), /TTL/);
});

test('private URL credentials, local hostnames and unsafe paths are rejected', () => {
  const owner = createCommunityIdentity();
  const signed = signCommunityNames(owner, [{ name: '', targetPort: owner.id }]);
  const good = communityPortUri(owner.id);
  const invalid = [
    'https://example.com', 'port://localhost/', 'port://user@' + good.slice(7),
    good + '?secret=key', good + '#fragment', good + '../owner',
    good + '%2e%2e', good.slice(0,-1) + ':443/', good + 'x//y',
    good + 'a/b%2fc', good.replace('port://', 'PORT://'),
  ];
  for(const uri of invalid) assert.throws(() => parseCommunityPortUri(uri), Error, uri);
  assert.throws(() => resolveCommunityPort(communityPortUri(owner.id, 'not-signed'), signed), /Unassigned/);
});

test('community network is never paywalled and paid services are not falsely activated', () => {
  const catalog = communityCatalog();
  assert.equal(catalog.schema, 'kindred.sdpn.community-catalog.v1');
  assert.equal(catalog.acceptsPayments, false);
  const free = catalog.plans.find(plan => plan.id === 'community');
  assert.equal(free.priceUsdMonthly, 0);
  assert.equal(free.availability, 'open-source-software');
  assert.ok(COMMUNITY_CAPABILITIES.length >= 9);
  for(const capability of COMMUNITY_CAPABILITIES){
    assert.equal(capabilityIsFree(capability), true);
    const verdict = evaluateAccess(capability);
    assert.deepEqual(verdict, { capability, allowed: true, basis: 'free-open-protocol',
      subscriptionRequired: false, paymentRequired: false });
  }
  for (const plan of catalog.plans.filter(plan => plan.id !== 'community')) {
    assert.equal(plan.availability, 'planned');
    assert.equal(plan.priceUsdMonthly, null);
    for(const capability of plan.services){
      const result = evaluateAccess(capability);
      assert.equal(result.allowed, false);
      assert.equal(result.paymentRequired, false);
      assert.equal(result.subscriptionRequired, false);
      assert.equal(result.basis, 'service-not-deployed');
    }
  }
  assert.equal(evaluateAccess('unknown.admin.override').allowed, false);
});
