import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createPortIdentity } from '../src/native-port-identity.mjs';
import { makePortUri, verifyPortNames } from '../src/port-names.mjs';

const domainCli = resolve('scripts/port-domain.mjs');
const resolveCli = resolve('scripts/port-resolve.mjs');

test('operator can issue durable local signed port addresses without subscriptions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdpn-port-'));
  try {
    const init = JSON.parse(execFileSync(process.execPath, [domainCli, 'init', '--dir', directory], { encoding: 'utf8' }));
    assert.equal(init.controlPlane, 'local-operator');
    assert.equal(init.globalDns, false);
    assert.equal(init.liveServices, false);
    assert.equal(init.addresses.length, 7);
    assert.ok(init.namespace.startsWith('port://'));
    const manifest = JSON.parse(await readFile(init.manifestPath, 'utf8'));
    assert.equal(verifyPortNames(manifest).ownerPort, init.ownerPort);
    if (process.platform !== 'win32') {
      assert.equal((await stat(join(directory, 'port-owner-key.pem'))).mode & 0o077, 0);
    }
    const portal = makePortUri(init.ownerPort, 'portal', '/dashboard');
    const resolved = JSON.parse(execFileSync(process.execPath,
      [resolveCli, portal, '--manifest', init.manifestPath], { encoding: 'utf8' }));
    assert.equal(resolved.targetPort, init.ownerPort);
    assert.equal(resolved.authorizationGranted, false);

    const peer = createPortIdentity({ testSeed: Buffer.alloc(32, 74) });
    const changed = JSON.parse(execFileSync(process.execPath,
      [domainCli, 'bind', 'clients.enterprise', peer.id, '--dir', directory], { encoding: 'utf8' }));
    assert.equal(changed.revision, 2);
    const client = JSON.parse(execFileSync(process.execPath,
      [resolveCli, makePortUri(init.ownerPort, 'clients.enterprise'), '--manifest', init.manifestPath],
      { encoding: 'utf8' }));
    assert.equal(client.targetPort, peer.id);
    const renewed = JSON.parse(execFileSync(process.execPath,
      [domainCli, 'renew', '--dir', directory], { encoding: 'utf8' }));
    assert.equal(renewed.revision, 3);
    assert.equal(renewed.ownerPort, init.ownerPort);
    const duplicate = spawnSync(process.execPath, [domainCli, 'init', '--dir', directory], { encoding: 'utf8' });
    assert.notEqual(duplicate.status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('malicious unregistered port addresses never dispatch to a network or OS shell', async () => {
  const bad = spawnSync(process.execPath,
    [resolveCli, 'port://localhost/payload', '--manifest', '/missing/nonexistent.json'],
    { encoding: 'utf8', timeout: 3000 });
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /SDPN PORT DENIED/);
});
