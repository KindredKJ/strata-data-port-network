#!/usr/bin/env node
// Local, single-writer, founder-signed registry. No network listener, transport or route changes.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { open, mkdir, readFile, lstat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { canonicalBytes, portId } from '../src/native-port-identity.mjs';
import { createFounderPortZero, verifyNumberedRegistry, assignNumberedPort,
  revokeNumberedPort } from '../src/numbered-port-registry.mjs';

function parse(argv) {
  const [action, ...rest] = argv;
  if (!['init', 'enroll', 'revoke', 'inspect'].includes(action)) throw new Error('Usage: init|enroll|revoke|inspect --founder-id ID [--dir PATH] [--public-key BASE64 | --number INTEGER]');
  const args = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1];
    if (!['--founder-id', '--dir', '--public-key', '--number'].includes(flag) ||
        value === undefined || value.startsWith('--') || args[flag] !== undefined) {
      throw new Error('Registry command arguments rejected');
    }
    args[flag] = value;
  }
  if (!args['--founder-id'] || !/^strata:port:ed25519:[a-f0-9]{64}$/.test(args['--founder-id'])) {
    throw new Error('An explicit, trusted --founder-id is mandatory');
  }
  if (action !== 'enroll' && args['--public-key'] !== undefined ||
      action !== 'revoke' && args['--number'] !== undefined ||
      action === 'enroll' && !args['--public-key'] ||
      action === 'revoke' && !/^(?:0|[1-9][0-9]*)$/.test(args['--number'] ?? '')) {
    throw new Error('Command-specific registry arguments rejected');
  }
  return {
    action, args, founderId: args['--founder-id'],
    dir: resolve(args['--dir'] ?? join(homedir(), '.sdpn'))
  };
}
async function loadSigner(path, expectedId) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 8192 ||
      process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw new Error('Founder signing key must be a private, owner-only regular file');
  }
  const key = createPrivateKey(await readFile(path, 'utf8'));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Founder key must be Ed25519');
  const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64');
  const id = portId(publicKey);
  if (id !== expectedId) throw new Error('Founder Port 0 trust anchor mismatch');
  return Object.freeze({ id, publicKey, sign(body) {
    const canonical = JSON.parse(canonicalBytes(body).toString('utf8'));
    return { body: canonical, signature: sign(null, canonicalBytes(canonical), key).toString('base64') };
  } });
}
async function readLedger(path, founderId) {
  const bytes = await readFile(path);
  if (bytes.length === 0 || bytes.length > 32 * 1024 * 1024 ||
      bytes[bytes.length - 1] !== 10) throw new Error('Registry ledger missing, incomplete, or too large');
  const lines = bytes.toString('utf8').trimEnd().split('\n');
  const entries = lines.map(line => JSON.parse(line));
  const view = verifyNumberedRegistry(entries, founderId);
  return { entries, view };
}
async function appendDurable(path, entry, create = false) {
  const handle = await open(path, create ? 'wx' : 'a', 0o600);
  try {
    await handle.writeFile(JSON.stringify(entry) + '\n', 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
}
async function exclusive(dir, fn) {
  const lockFile = join(dir, 'port-number-registry.lock');
  const lock = await open(lockFile, 'wx', 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }) + '\n');
    await lock.sync();
    return await fn();
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}
async function main(argv) {
  const { action, args, founderId, dir } = parse(argv);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const ledgerPath = join(dir, 'port-number-registry.jsonl');
  if (action === 'inspect') {
    const { view } = await readLedger(ledgerPath, founderId);
    process.stdout.write(JSON.stringify({ ...view, ledgerPath,
      globalPresenceServiceDeployed: false, networkConnected: false }, null, 2) + '\n');
    return;
  }
  await exclusive(dir, async () => {
    const signer = await loadSigner(join(dir, 'port-owner-key.pem'), founderId);
    if (action === 'init') {
      const entries = createFounderPortZero(signer);
      await appendDurable(ledgerPath, entries[0], true);
    } else {
      const { entries } = await readLedger(ledgerPath, founderId);
      const next = action === 'enroll'
        ? assignNumberedPort(signer, entries, args['--public-key'])
        : revokeNumberedPort(signer, entries, Number(args['--number']));
      await appendDurable(ledgerPath, next.at(-1));
    }
    const { view } = await readLedger(ledgerPath, founderId);
    process.stdout.write(JSON.stringify({ action, founderNumber: 0,
      nextNumber: view.nextNumber, totalEvents: view.nextSequence,
      headSha256: view.headSha256, registrations: view.registrations,
      ledgerPath, globalPresenceServiceDeployed: false,
      networkConnected: false, conventionalRoutingAdded: false }, null, 2) + '\n');
  });
}
main(process.argv.slice(2)).catch(error => {
  process.stderr.write('SDPN NUMBERED REGISTRY: ' + (error?.message ?? String(error)) + '\n');
  process.exitCode = 2;
});
