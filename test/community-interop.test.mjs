// Integration verification: independently open-licensed SDPN Community SDK
// emits PORT/1 messages accepted by the existing SDPN native runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityIdentity, signCommunityNames, communityPortUri,
  resolveCommunityPort } from '../community/src/index.mjs';
import { portId } from '../src/native-port-identity.mjs';
import { makePortUri, verifyPortNames, resolvePortName } from '../src/port-names.mjs';

test('open-source community port namespaces interoperate with existing PORT/1', () => {
  const identity = createCommunityIdentity();
  const recipient = createCommunityIdentity();
  const now = 1_800_000_000_000;
  const record = signCommunityNames(identity, [
    { name: '', targetPort: identity.id },
    { name: 'portal', targetPort: identity.id },
    { name: 'business.shop', targetPort: recipient.id },
  ], { now, revision: 2, ttlMs: 90000 });
  assert.equal(portId(identity.publicKey), identity.id);
  assert.equal(verifyPortNames(record, now).ownerPort, identity.id);
  const address = communityPortUri(identity.id, 'business.shop', '/catalog');
  assert.equal(makePortUri(identity.id, 'business.shop', '/catalog'), address);
  assert.equal(resolvePortName(address, record, now).targetPort, recipient.id);
  assert.equal(resolveCommunityPort(address, record, now).targetPort, recipient.id);
});
