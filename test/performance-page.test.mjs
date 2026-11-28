import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../public/performance.html', import.meta.url), 'utf8');
const home = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('home page exposes live operations', () => {
  assert.match(home, /href="\/performance\.html"/);
  assert.match(page, /<title>SDPN Live Operations \| Kindred Labs<\/title>/);
});

test('dashboard checks live public proof status, not synthetic fixture data', () => {
  assert.match(page, /fetch\('\/api\/proof\/status\?live='/);
  assert.match(page, /cache:'no-store'/);
  assert.match(page, /AbortController/);
  assert.match(page, /setInterval\(\(\)=>\{/);
});

test('dashboard states the full p95 and recovery evidence requirements', () => {
  assert.match(page, /40% lower p95/);
  assert.match(page, /60% of baseline p95/);
  assert.match(page, /three consecutive, non-overlapping five-minute windows/);
  assert.match(page, /at least 60 successful paired baseline\/candidate samples/);
  assert.match(page, /p99 latency and packet loss must be no worse/);
  assert.match(page, /failed active window or restart returns the session to baseline/);
  assert.match(page, /Fresh verified evidence from distinct physical endpoints/);
});

test('dashboard does not mistake reachability for a physical-host performance proof', () => {
  assert.match(page, /Browser-to-API p95/);
  assert.match(page, /Not SDPN transport p95/);
  assert.match(page, /40% network improvement/);
  assert.match(page, /Unverified/);
  assert.match(page, /No trusted live physical-host data feed connected/);
  assert.match(page, /0 \/ 3 verified/);
});

test('inline module is syntactically valid JavaScript', () => {
  const script = page.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(script, 'dashboard browser module must exist');
  assert.doesNotThrow(() => new vm.Script(script[1]));
});
