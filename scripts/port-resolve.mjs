#!/usr/bin/env node
// Offline SDPN port:// activation/resolution boundary; no remote fetch, dispatch or OS shell.
import { readFile } from 'node:fs/promises';
import { resolvePortName } from '../src/port-names.mjs';

async function main(args) {
  if (args.length !== 3 || args[1] !== '--manifest' ||
      typeof args[0] !== 'string' || typeof args[2] !== 'string' || args[2].length > 4096) {
    throw new Error('Usage: node scripts/port-resolve.mjs port://NAME.<owner-namespace>.sdpn/PATH --manifest /path/to/port-names.json');
  }
  const fd = await readFile(args[2]);
  if (fd.byteLength > 32768) throw new Error('Port manifest exceeds 32 KiB');
  const record = JSON.parse(fd.toString('utf8'));
  const result = resolvePortName(args[0], record);
  process.stdout.write(JSON.stringify(result) + '\n');
}
main(process.argv.slice(2)).catch(error => {
  process.stderr.write('SDPN PORT DENIED: ' + String(error?.message ?? error) + '\n');
  process.exitCode = 2;
});
