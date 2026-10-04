import test from 'node:test';
import assert from 'node:assert/strict';
import { sealFile, openPackage, MAX_FILE_BYTES } from './app-core.mjs';

const file = (bytes, name = 'report.txt') => ({ name, type: 'text/plain', size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer });

test('seals and verifies exact bytes with concealed metadata', async () => {
  const input = new TextEncoder().encode('Kindred Strata\0data\n');
  const { package: sealed, receipt } = await sealFile(file(input), 'a very long private passphrase');
  assert.equal(receipt.classification, 'PORTABLE_BUFFERED_ENCRYPTED_PACKAGE');
  assert.equal(receipt.networkTransportProven, false);
  assert.equal(JSON.stringify(sealed).includes('report.txt'), false);
  const output = await openPackage(JSON.stringify(sealed), 'a very long private passphrase');
  assert.equal(output.name, 'report.txt');
  assert.deepEqual(output.bytes, input);
  assert.equal(output.sha256, receipt.sha256);
});

test('rejects wrong passphrase, altered ciphertext, unknown formats and unsafe names', async () => {
  const { package: sealed } = await sealFile(file([1, 2, 3]), 'a very long private passphrase');
  await assert.rejects(openPackage(JSON.stringify(sealed), 'an incorrect long passphrase'), /wrong passphrase or altered data/);
  const altered = { ...sealed, ciphertext: sealed.ciphertext.replace(/^./, sealed.ciphertext[0] === 'A' ? 'B' : 'A') };
  await assert.rejects(openPackage(JSON.stringify(altered), 'a very long private passphrase'), /altered data/);
  await assert.rejects(openPackage(JSON.stringify({ ...sealed, version: 'v2' }), 'a very long private passphrase'), /Unsupported/);
  await assert.rejects(sealFile(file([1], '../outside'), 'a very long private passphrase'), /Invalid file name/);
});

test('enforces input and package bounds', async () => {
  await assert.rejects(sealFile({ name: 'big', size: MAX_FILE_BYTES + 1, arrayBuffer() {} }, 'a very long private passphrase'), /16 MiB/);
  await assert.rejects(sealFile(file([1]), 'short'), /at least 12/);
  await assert.rejects(openPackage('x'.repeat(24 * 1024 * 1024 + 1), 'a very long private passphrase'), /too large/);
});
