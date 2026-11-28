import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const operator = join(root, 'scripts', 'port-domain.mjs');
const publish = join(root, 'apps', 'portal', 'publish.mjs');
const open = join(root, 'apps', 'portal', 'open-port.mjs');

test('operator signs a real persisted Portal page and native PORT resolves HTML offline', async () => {
  const working = await mkdtemp(join(tmpdir(), 'sdpn-portal-publish-'));
  const data = join(working, 'portal');
  const environment = { ...process.env, SDPN_OPERATOR_DIR: working, PORTAL_DATA_DIR: data };
  try {
    const manifest = JSON.parse(execFileSync(process.execPath, [operator, 'init', '--dir', working],
      { encoding: 'utf8', env: environment }));
    assert.equal(manifest.globalDns, false);
    await mkdir(join(data, 'sites'), { recursive: true });
    await writeFile(join(data, 'sites', 'real-business.json'), JSON.stringify({
      slug: 'real-business', title: 'Owned Business', description: 'Independent SDPN site',
      body: 'Actual customer-facing content <script>malicious()</script>',
      createdAt: new Date().toISOString()
    }));
    const issued = JSON.parse(execFileSync(process.execPath, [publish, 'publish', 'real-business'],
      { encoding: 'utf8', env: environment }));
    assert.equal(issued.signedNamespace, true);
    assert.equal(issued.networkAuthorized, false);
    assert.equal(issued.publiclyReachable, false);
    assert.ok(issued.uri.startsWith('port://real-business.'));
    const rendered = JSON.parse(execFileSync(process.execPath, [open, issued.uri],
      { encoding: 'utf8', env: environment }));
    assert.equal(rendered.signedNameVerified, true);
    assert.equal(rendered.authorizedNetworkTransport, false);
    assert.match(rendered.html, /Owned Business/);
    assert.match(rendered.html, /&lt;script&gt;malicious\(\)&lt;\/script&gt;/);
    assert.ok(!rendered.html.includes('<script>malicious'));
    const second = JSON.parse(execFileSync(process.execPath, [publish, 'publish', 'real-business'],
      { encoding: 'utf8', env: environment }));
    assert.equal(second.uri, issued.uri);
    const notPublished = spawnSync(process.execPath, [open, issued.uri.replace('real-business.', 'not-published.')],
      { encoding: 'utf8', env: environment });
    assert.notEqual(notPublished.status, 0);
    assert.equal(notPublished.stdout, '');
    const malicious = spawnSync(process.execPath, [publish, 'publish', '../secrets'],
      { encoding: 'utf8', env: environment });
    assert.notEqual(malicious.status, 0);
  } finally {
    await rm(working, { recursive: true, force: true });
  }
});
