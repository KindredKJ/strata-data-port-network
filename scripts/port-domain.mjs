#!/usr/bin/env node
// Founder-controlled local Port Zero naming. Keys are generated on the operator machine,
// never in CI fixtures, public source, hosted analytics, URLs, or GitHub repositories.
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { canonicalBytes, portId, verifyEnvelope } from '../src/native-port-identity.mjs';
import { makePortUri, signPortNames } from '../src/port-names.mjs';

const DEFAULT_NAMES = ['', 'portal', 'api', 'memory', 'storage', 'interconnect', 'enterprise.api'];

function argumentsFor(argv) {
  const [action, ...rest] = argv;
  const index = rest.indexOf('--dir');
  const directory = index < 0 ? join(homedir(), '.sdpn') : rest[index + 1];
  if (index >= 0 && (index !== rest.length - 2 || !directory)) throw new Error('Invalid --dir option');
  const positionals = index < 0 ? rest : rest.slice(0, index);
  if (!['init', 'renew', 'bind'].includes(action) ||
      (action !== 'bind' && positionals.length !== 0) || (action === 'bind' && positionals.length !== 2)) {
    throw new Error('Usage: node scripts/port-domain.mjs init|renew|bind NAME TARGET_PORT_ID [--dir PRIVATE_DIRECTORY]');
  }
  return { action, directory: resolve(directory), positionals };
}

function signer(privateKey) {
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 Port Zero private key required');
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  return Object.freeze({ id: portId(publicKey), publicKey,
    sign(body) { const copied = JSON.parse(canonicalBytes(body)); return {
      body: copied, signature: sign(null, canonicalBytes(copied), privateKey).toString('base64')
    }; }
  });
}
async function getSigner(keyPath) {
  const info = await stat(keyPath);
  if (!info.isFile() || info.size > 8192 ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
    throw new Error('Private key file ownership/permissions rejected; require owner-only access');
  }
  return signer(createPrivateKey(await readFile(keyPath, 'utf8')));
}
async function writeAtomic(path, payload) {
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, payload, { flag: 'wx', mode: 0o600 });
  try { await rename(temp, path); }
  catch (err) { const { unlink } = await import('node:fs/promises'); await unlink(temp).catch(() => {}); throw err; }
}
function output(identity, record, location) {
  process.stdout.write(JSON.stringify({
    schema: 'kindred.sdpn.operator-names.v1',
    ownerPort: identity.id,
    namespace: makePortUri(identity.id),
    addresses: record.body.entries.map(entry => ({
      name: entry.name || '(root)', uri: makePortUri(identity.id, entry.name), targetPort: entry.targetPort
    })),
    manifestPath: location, expiresAt: record.body.expiresAt, revision: record.body.revision,
    controlPlane: 'local-operator', globalDns: false, liveServices: false
  }, null, 2) + '\n');
}
async function main(argv) {
  const { action, directory, positionals } = argumentsFor(argv);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const keyPath = join(directory, 'port-owner-key.pem');
  const manifestPath = join(directory, 'port-names.json');
  let identity, record;
  if (action === 'init') {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    await writeFile(keyPath, pem, { flag: 'wx', mode: 0o600 });
    identity = signer(privateKey);
    record = signPortNames(identity, DEFAULT_NAMES.map(name => ({ name, targetPort: identity.id })));
    await writeFile(manifestPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } else {
    identity = await getSigner(keyPath);
    const bytes = await readFile(manifestPath);
    if (bytes.length > 32768) throw new Error('Manifest file size rejected');
    const existing = JSON.parse(bytes.toString('utf8'));
    const body = verifyEnvelope(existing, identity.id, identity.publicKey);
    if (body.schema !== 'kindred.sdpn.port-names.v1' || !Number.isSafeInteger(body.revision) ||
        body.revision < 1 || body.revision >= Number.MAX_SAFE_INTEGER || !Array.isArray(body.entries)) {
      throw new Error('Existing signed Port Zero namespace rejected');
    }
    let entries = body.entries;
    if (action === 'bind') {
      const [name, targetPort] = positionals;
      if (name === '') throw new Error('Root mapping is immutable in bind operation');
      entries = body.entries.filter(entry => entry.name !== name).concat([{ name, targetPort }]);
    }
    record = signPortNames(identity, entries, { revision: body.revision + 1 });
    await writeAtomic(manifestPath, JSON.stringify(record, null, 2) + '\n');
  }
  output(identity, record, manifestPath);
}
main(process.argv.slice(2)).catch(error => {
  process.stderr.write('SDPN OPERATOR DENIED: ' + String(error?.message ?? error) + '\n');
  process.exitCode = 2;
});
