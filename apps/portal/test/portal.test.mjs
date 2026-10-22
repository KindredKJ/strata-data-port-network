import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as rawRequest } from 'node:http';
import { createPortalServer } from '../server.mjs';

let server, origin, workspace, session, modelServer;
before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'sdpn-portal-tests-'));
  server = createPortalServer({
    dataDirectory: workspace,
    manifestPath: join(workspace, 'port-names.json'),
    model: ''
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  session = (await (await fetch(origin + '/api/session')).json()).intentToken;
});
after(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (modelServer?.listening) await new Promise(resolve => modelServer.close(resolve));
  if (workspace) await rm(workspace, { recursive: true, force: true });
});
const post = (path, body, valid = true) => fetch(origin + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json',
    Origin: valid ? origin : 'https://untrusted.example',
    'X-Portal-Intent': session },
  body: JSON.stringify(body)
});

test('Portal actually serves the independent accessible UI and asset files', async () => {
  const home = await fetch(origin + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(home.headers.get('x-frame-options'), /DENY/);
  const html = await home.text();
  assert.match(html, /A more useful way/);
  assert.match(html, /Make your own PORT/);
  assert.match(html, /Search SDPN knowledge/);
  assert.doesNotMatch(html, /_vercel|genesis\.sanctuary/);
  for (const asset of ['/app.js', '/styles.css']) {
    const result = await fetch(origin + asset);
    assert.equal(result.status, 200, asset);
    assert.ok((await result.text()).length > 1500, asset);
  }
});

test('Portal search uses real local source files, not an invented global web index', async () => {
  const status = await (await fetch(origin + '/api/status')).json();
  assert.equal(status.product, 'Portal');
  assert.equal(status.globalWebIndex, false);
  assert.equal(status.signedNamespaceVerified, false);
  assert.equal(status.localAIConfigured, false);
  assert.equal(status.networkPortSession, false);
  assert.ok(status.indexedDocuments >= 5);
  const data = await (await fetch(origin + '/api/search?q=Port%20Zero')).json();
  assert.equal(data.coverage, 'locally-indexed SDPN documents and owned sites only');
  assert.ok(data.results.length > 0);
  assert.ok(data.results.every(r => r.kind === 'documentation'));
  const document = await (await fetch(origin + data.results[0].href)).json();
  assert.ok(document.body.includes('Port') || document.body.includes('port'));
});

test('Portal free protocol plan is accessible without checkout or user accounts', async () => {
  const result = await fetch(origin + '/api/plans');
  assert.equal(result.status, 200);
  const catalog = await result.json();
  assert.equal(catalog.acceptsPayments, false);
  const community = catalog.plans.find(x => x.id === 'community');
  assert.equal(community.priceUsdMonthly, 0);
  assert.ok(community.capabilities.includes('identity.generate'));
  assert.ok(community.plannedFreeCapabilities.includes('port.data.transfer'));
  for(const product of catalog.plans.filter(x => x.id !== 'community')) {
    assert.equal(product.availability, 'planned');
    assert.equal(product.priceUsdMonthly, null);
  }
});

test('operator owns actual persisted sites; markup is rendered inert and searchable', async () => {
  const body = {
    slug: 'my-portal-site', title: 'My Port Website', description: 'Published locally',
    body: 'Real original research about Portal indexing. <script>window.hacked = true</script>'
  };
  const denied = await post('/api/sites', body, false);
  assert.equal(denied.status, 403);
  const created = await post('/api/sites', body);
  assert.equal(created.status, 201);
  const payload = await created.json();
  assert.equal(payload.signedPortPublished, false);
  assert.equal(payload.site.preview, '/p/my-portal-site');
  const page = await fetch(origin + payload.site.preview);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('&lt;script&gt;window.hacked = true&lt;/script&gt;'));
  assert.ok(!html.includes('<script>window.hacked'));
  const results = await (await fetch(origin + '/api/search?q=research%20indexing')).json();
  assert.ok(results.results.some(x => x.kind === 'owned-port-site' && x.href === payload.site.preview));
  const sites = await (await fetch(origin + '/api/sites')).json();
  assert.equal(sites.sites.length, 1);
  assert.equal(sites.sites[0].portUri, null);
  const duplicate = await post('/api/sites', body);
  assert.equal(duplicate.status, 409);
  assert.equal((await post('/api/sites', { ...body, slug: '../escape' })).status, 400);
  assert.equal((await post('/api/sites', { ...body, body: '<b>x</b>'.repeat(4000) })).status, 400);
});

test('unconfigured local AI fails truthfully and does not invent responses', async () => {
  const response = await post('/api/assist', { task: 'learn', prompt: 'Explain SDPN' });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.unavailable, true);
  assert.match(payload.reason, /No local model configured/);
  assert.equal((await post('/api/assist', { task: 'execute', prompt: 'Transfer funds' })).status, 400);
});

test('unsafe HTTP, unknown paths and hostile hosts cannot control Portal', async () => {
  assert.equal((await fetch(origin + '/package.json')).status, 404);
  assert.equal((await fetch(origin + '/.sdpn/port-owner-key.pem')).status, 404);
  assert.equal((await fetch(origin + '/api/sites', { method: 'DELETE' })).status, 405);
  const deniedHostStatus = await new Promise((resolve, reject) => {
    const req = rawRequest(origin + '/api/sites', { headers: { Host: 'untrusted.example' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(deniedHostStatus, 403);
});

test('configured real local HTTP model response is returned without an external provider', async () => {
  let observed = null;
  modelServer = createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    const pieces = [];
    for await (const piece of req) pieces.push(piece);
    observed = JSON.parse(Buffer.concat(pieces).toString());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'Verified response from a local compatible service.' } }] }));
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  const isolated = createPortalServer({ dataDirectory: workspace, manifestPath: join(workspace, 'not-found'),
    model: 'local-authorized-model',
    endpoint: 'http://127.0.0.1:' + modelServer.address().port + '/v1/chat/completions' });
  await new Promise(resolve => isolated.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + isolated.address().port;
    const token = (await (await fetch(base + '/api/session')).json()).intentToken;
    const answer = await fetch(base + '/api/assist', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, 'X-Portal-Intent': token },
      body: JSON.stringify({ task: 'learn', prompt: 'How do I use Portal?' }) });
    assert.equal(answer.status, 200);
    const body = await answer.json();
    assert.match(body.answer, /Verified response/);
    assert.equal(body.source, 'configured-local-model');
    assert.equal(observed.model, 'local-authorized-model');
    assert.equal(observed.stream, false);
    assert.equal(observed.messages[1].role, 'user');
  } finally { await new Promise(resolve => isolated.close(resolve)); }
});
