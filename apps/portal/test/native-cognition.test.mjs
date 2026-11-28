import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPortalServer } from '../server.mjs';

test('Portal routes authorized AI work to first-party SDPN local cognition with no hosted model', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sdpn-portal-native-cognition-'));
  const calls = [];
  const cognition = createServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/cognition');
    let data = '';
    for await (const chunk of req) data += chunk;
    calls.push(JSON.parse(data));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      schema: 'kindred.sdpn.cognition.v1',
      output: 'Native SDPN assistance without external providers',
      engine: 'offline-rules',
      generative: false
    }));
  });
  await new Promise(resolve => cognition.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + cognition.address().port + '/v1/cognition';
  const portal = createPortalServer({
    dataDirectory: workspace,
    manifestPath: join(workspace, 'no-port-names.json'),
    model: '',
    nativeCognitionEndpoint: endpoint
  });
  try {
    await new Promise(resolve => portal.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + portal.address().port;
    const token = (await (await fetch(origin + '/api/session')).json()).intentToken;
    const status = await (await fetch(origin + '/api/status')).json();
    assert.equal(status.localAIConfigured, true);
    assert.equal(status.nativeCognitionConfigured, true);
    const denied = await fetch(origin + '/api/assist', {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example', 'X-Portal-Intent': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'build', prompt: 'Build SDPN transport' })
    });
    assert.equal(denied.status, 403);
    const accepted = await fetch(origin + '/api/assist', {
      method: 'POST',
      headers: { Origin: origin, 'X-Portal-Intent': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'build', prompt: 'Build SDPN transport' })
    });
    assert.equal(accepted.status, 200);
    const answer = await accepted.json();
    assert.equal(answer.source, 'sdpn-native-cognition');
    assert.equal(answer.engine, 'offline-rules');
    assert.equal(answer.generative, false);
    assert.equal(answer.answer, 'Native SDPN assistance without external providers');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source, 'sdpn-portal');
    assert.match(calls[0].input, /Build SDPN transport/);
  } finally {
    if (portal.listening) await new Promise(resolve => portal.close(resolve));
    await new Promise(resolve => cognition.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  }
});
