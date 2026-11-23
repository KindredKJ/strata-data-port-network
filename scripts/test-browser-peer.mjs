// Run with: npm run test:browser (after npx playwright install chromium).
// This validates two browser peers on one machine, NOT two physical hosts.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const allowed = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['connect.html', 'text/html; charset=utf-8'],
  ['connect.mjs', 'text/javascript; charset=utf-8'],
  ['peer-protocol.mjs', 'text/javascript; charset=utf-8'],
  ['app.html', 'text/html; charset=utf-8'],
  ['app-core.mjs', 'text/javascript; charset=utf-8'],
  ['app-ui.mjs', 'text/javascript; charset=utf-8']
]);
const server = createServer(async (req, res) => {
  const name = new URL(req.url || '/', 'http://localhost').pathname.replace(/^\//, '') || 'index.html';
  if (!allowed.has(name)) { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(new URL('../public/' + name, import.meta.url));
    res.writeHead(200, { 'Content-Type': allowed.get(name), 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(500).end('File error'); }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const origin = 'http://127.0.0.1:' + address.port;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const sender = await browser.newPage({ acceptDownloads: true });
  const receiver = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  for (const page of [sender, receiver]) page.on('pageerror', error => errors.push(error.message));
  await sender.goto(origin);
  assert.match(await sender.title(), /Strata.*Correspond.*Connect.*Create.*Call/);
  await sender.goto(origin + '/connect.html');
  await receiver.goto(origin + '/connect.html');

  await sender.locator('#peer-create').click();
  await sender.waitForFunction(() => document.querySelector('#peer-output')?.value.length > 0, null, { timeout: 45000 });
  const invite = await sender.locator('#peer-output').inputValue();
  assert.ok(invite.length > 100, 'invitation has ICE/SDP information');

  await receiver.locator('#peer-input').fill(invite);
  await receiver.locator('#peer-join').click();
  await receiver.waitForFunction(() => document.querySelector('#peer-output')?.value.length > 0, null, { timeout: 45000 });
  const answer = await receiver.locator('#peer-output').inputValue();
  assert.ok(answer.length > 100);

  await sender.locator('#peer-input').fill(answer);
  await sender.locator('#peer-confirm').click();
  await Promise.all([sender, receiver].map(page => page.locator('#connection-state')
    .getByText('Connected to peer').waitFor({ timeout: 45000 })));

  const fileBytes = Buffer.from('Strata two-browser transfer: cipher verified, exact bytes restored.');
  const passphrase = 'an independent reproducible browser test passphrase';
  await sender.locator('#peer-file').setInputFiles({
    name: 'browser-test.txt', mimeType: 'text/plain', buffer: fileBytes
  });
  await sender.locator('#peer-pass').fill(passphrase);
  await sender.locator('#peer-send').click();

  await receiver.waitForFunction(() => !document.querySelector('#peer-download')?.disabled, null, { timeout: 45000 });
  assert.match(await receiver.locator('#peer-status').innerText(), /SHA-256 verified/);

  const [encryptedDownload] = await Promise.all([
    receiver.waitForEvent('download'), receiver.locator('#peer-download').click()
  ]);
  const encryptedBytes = await readFile(await encryptedDownload.path());
  assert.ok(encryptedBytes.length > fileBytes.length);

  await receiver.goto(origin + '/app.html');
  await receiver.locator('#package-file').setInputFiles({
    name: 'received.strata', mimeType: 'application/json', buffer: encryptedBytes
  });
  await receiver.locator('#open-pass').fill(passphrase);
  const [originalDownload] = await Promise.all([
    receiver.waitForEvent('download'), receiver.locator('#open-form button').click()
  ]);
  const restored = await readFile(await originalDownload.path());
  assert.equal(originalDownload.suggestedFilename(), 'browser-test.txt');
  assert.deepEqual(restored, fileBytes);
  assert.equal(errors.length, 0, 'no uncaught browser page exceptions: ' + errors.join('; '));
  console.log('PASS: two-browser pairing, WebRTC transfer, encrypted package, SHA-256 receipt and original-file restoration');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
