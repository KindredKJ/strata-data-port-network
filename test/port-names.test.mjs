import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPortIdentity } from '../src/native-port-identity.mjs';
import {
  PORT_NAMES_SCHEMA, portNamespaceHost, makePortUri, parsePortUri,
  signPortNames, verifyPortNames, resolvePortName, SignedPortNameDirectory
} from '../src/port-names.mjs';

const owner = createPortIdentity({ testSeed: Buffer.alloc(32, 27) });
const target = createPortIdentity({ testSeed: Buffer.alloc(32, 28) });
const now = 1_800_000_000_000;
const names = [{ name: '', targetPort: owner.id },
  { name: 'portal', targetPort: owner.id },
  { name: 'memory.agent', targetPort: target.id },
  { name: 'enterprise.api', targetPort: target.id }];
const signed = () => signPortNames(owner, names, { now, revision: 3, ttlMs: 60_000 });

test('port:// is a canonical owner-identity-bound overlay namespace, not DNS', () => {
  const host = portNamespaceHost(owner.id);
  assert.equal(host.split('.').length, 3);
  assert.ok(host.endsWith('.sdpn'));
  const uri = makePortUri(owner.id, 'memory.agent', '/objects/alpha_1');
  assert.equal(uri, 'port://memory.agent.' + host + '/objects/alpha_1');
  assert.deepEqual(parsePortUri(uri), {
    scheme: 'port', uri, name: 'memory.agent', ownerPort: owner.id,
    path: '/objects/alpha_1', namespaceHost: host,
  });
  assert.equal(parsePortUri(makePortUri(owner.id)).path, '/');
});

test('signed subdomains resolve only to signer-authorized Port Zero targets', () => {
  const record = signed();
  assert.equal(record.body.schema, PORT_NAMES_SCHEMA);
  assert.deepEqual(verifyPortNames(record, now), record.body);
  const uri = makePortUri(owner.id, 'memory.agent', '/objects/alpha_1');
  const result = resolvePortName(uri, record, now);
  assert.equal(result.targetPort, target.id);
  assert.equal(result.ownerPort, owner.id);
  assert.equal(result.nameSignatureVerified, true);
  for (const key of ['networkConnected', 'authorizationGranted', 'physicalZeroCopyVerified', 'dnsRegistration']) {
    assert.equal(result[key], false, key);
  }
  assert.throws(() => resolvePortName(makePortUri(target.id, 'memory.agent'), record, now), /Untrusted/);
  assert.throws(() => resolvePortName(makePortUri(owner.id, 'missing'), record, now), /not registered/);
});

test('name collisions, replay, version rollback, and revocation are denied', () => {
  const d = new SignedPortNameDirectory({ capacity: 1 });
  const record = signed();
  assert.equal(d.ingest(record, now), owner.id);
  assert.equal(d.resolve(makePortUri(owner.id, 'portal'), now).targetPort, owner.id);
  const older = signPortNames(owner, names, { now, revision: 2 });
  assert.throws(() => d.ingest(older, now), /rollback/);
  const conflicting = signPortNames(owner, [...names.slice(0, 1)], { now, revision: 3 });
  assert.throws(() => d.ingest(conflicting, now), /rollback\/conflict/);
  assert.throws(() => d.ingest(signPortNames(target, [{ name: '', targetPort: target.id }], { now }), now), /capacity/);
  d.revoke(owner.id);
  assert.throws(() => d.resolve(makePortUri(owner.id), now), /revoked/);
  assert.throws(() => d.ingest(record, now), /revoked/);
});

test('tampered signatures, expired records, and unapproved keys are denied', () => {
  const record = signed();
  const changed = structuredClone(record);
  changed.body.entries[1].targetPort = target.id;
  assert.throws(() => verifyPortNames(changed, now), /signature/);
  assert.throws(() => verifyPortNames(record, now + 60_000), /lifetime/);
  assert.throws(() => signPortNames(owner, names, { now, ttlMs: 3_600_001 }), /TTL/);
  assert.throws(() => signPortNames(owner, [names[0], names[0]], { now }), /Duplicate/);
  assert.throws(() => signPortNames(owner, [{ name: '*.portal', targetPort: target.id }], { now }), /subdomain/);
  assert.throws(() => signPortNames(owner, [{ name: 'api', targetPort: 'port://example' }], { now }), /identity/);
});

test('rejects unsafe custom URL syntax without ever connecting to a host', () => {
  const domain = portNamespaceHost(owner.id);
  const rejected = [
    'https://' + domain + '/', 'PORT://' + domain + '/', 'port://unknown/',
    'port://user@' + domain + '/', 'port://' + domain + ':443/',
    'port://' + domain + '/safe?token=secret', 'port://' + domain + '/#fragment',
    'port://' + domain + '/%2e%2e/secret', 'port://' + domain + '/../secret',
    'port://' + domain + '/a//b', 'port://a..' + domain + '/',
    'port://localhost/', 'port://127.0.0.1/', 'port://portal.' + domain + '/a%2fb',
    'port://portal.' + domain + '/a;rm', 'port://' + domain + '/a\\b',
  ];
  for (const bad of rejected) assert.throws(() => parsePortUri(bad), Error, bad);
});
