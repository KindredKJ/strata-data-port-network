import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createStandaloneServer } from '../scripts/serve-standalone.mjs';

let server;
let origin;

before(async () => {
  server = createStandaloneServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('provider-independent health route describes static scope only', async () => {
  const result = await fetch(origin + '/healthz');
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    service: 'strata-data-port-network',
    status: 'ok',
    scope: 'static-web-only',
    network_status: 'not-asserted',
  });
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
});

test('serves independent public entrypoint without Vercel analytics', async () => {
  const result = await fetch(origin + '/');
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /^text\/html/);
  const html = await result.text();
  assert.match(html, /Strata Data Port Network/);
  assert.match(html, /app\.html/);
  assert.doesNotMatch(html, /_vercel\/speed-insights/);
  assert.match(result.headers.get('content-security-policy'), /connect-src 'none'/);
});

test('preserves the encrypted-package browser workspace offline CSP', async () => {
  const result = await fetch(origin + '/app.html');
  assert.equal(result.status, 200);
  assert.match(await result.text(), /app-ui\.mjs/);
  const csp = result.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test('only publishes the two existing browser module files', async () => {
  for (const filename of ['/app-core.mjs', '/app-ui.mjs']) {
    const result = await fetch(origin + filename);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-type'), /^text\/javascript/);
    assert.ok((await result.text()).length > 100);
  }
});

test('rejects filesystem traversal, unapproved routes and write methods', async () => {
  for (const path of ['/.git/config', '/docs/VERIFICATION.md', '/%2e%2e/.git/config', '/package.json', '//app.html']) {
    const result = await fetch(origin + path);
    assert.equal(result.status, 404, path);
  }
  const result = await fetch(origin + '/app.html', { method: 'POST' });
  assert.equal(result.status, 405);
  assert.equal(result.headers.get('allow'), 'GET, HEAD');
});

test('HEAD requests return metadata without a body', async () => {
  const result = await fetch(origin + '/healthz', { method: 'HEAD' });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), '');
});
