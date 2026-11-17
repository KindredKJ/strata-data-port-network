import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { portId } from '../src/native-port-identity.mjs';

const cli = resolve('scripts/numbered-port-registry.mjs');
const opts = { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } };
function run(args) {
  return spawnSync(process.execPath, [cli, ...args], opts);
}

test('CLI persists founder-signed sequential ledger with revocation and pinned identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kindred-ports-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const founderPublic = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const founder = portId(founderPublic);
    await writeFile(join(dir, 'port-owner-key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const { publicKey: firstPublic } = generateKeyPairSync('ed25519');
    const first = firstPublic.export({ type: 'spki', format: 'der' }).toString('base64');
    const a = ['--founder-id', founder, '--dir', dir];
    let outcome = run(['init', ...a]);
    assert.equal(outcome.status, 0, outcome.stderr);
    let data = JSON.parse(outcome.stdout);
    assert.equal(data.founderNumber, 0);
    assert.equal(data.nextNumber, 1);
    assert.equal(data.totalEvents, 1);
    assert.equal(data.conventionalRoutingAdded, false);

    outcome = run(['init', ...a]);
    assert.equal(outcome.status, 2, 'duplicate genesis must not overwrite original ledger');

    outcome = run(['enroll', ...a, '--public-key', first]);
    assert.equal(outcome.status, 0, outcome.stderr);
    data = JSON.parse(outcome.stdout);
    assert.equal(data.nextNumber, 2);
    assert.equal(data.registrations[1].number, 1);

    outcome = run(['enroll', ...a, '--public-key', first]);
    assert.equal(outcome.status, 2, 'replaying same identity must fail');
    outcome = run(['inspect', ...a]);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout).nextNumber, 2);

    outcome = run(['revoke', ...a, '--number', '1']);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout).registrations[1].active, false);

    outcome = run(['inspect', '--founder-id', portId(first), '--dir', dir]);
    assert.equal(outcome.status, 2, 'unknown founder trust anchor rejected');

    const lockPath = join(dir, 'port-number-registry.lock');
    await writeFile(lockPath, 'locked');
    outcome = run(['revoke', ...a, '--number', '1']);
    assert.equal(outcome.status, 2, 'concurrent writer lock required');
    await rm(lockPath);

    const ledger = join(dir, 'port-number-registry.jsonl');
    const written = await readFile(ledger, 'utf8');
    assert.equal(written.split('\n').filter(Boolean).length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
