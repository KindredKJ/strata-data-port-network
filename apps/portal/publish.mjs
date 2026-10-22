#!/usr/bin/env node
// Explicit offline founder/operator publication of an existing Portal site as a signed port alias.
// Requires the local SDPN Ed25519 namespace private key and a saved site.
import { readFile, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPortNames, makePortUri, resolvePortName } from '../../src/port-names.mjs';

const slugPattern = /^[a-z][a-z0-9-]{1,47}$/;
const [action, slug] = process.argv.slice(2);
const operatorRoot = resolve(process.env.SDPN_OPERATOR_DIR || join(homedir(), '.sdpn'));
const portalRoot = resolve(process.env.PORTAL_DATA_DIR || join(operatorRoot, 'portal'));
if (action !== 'publish' || !slugPattern.test(slug ?? '')) {
  process.stderr.write('Usage: node apps/portal/publish.mjs publish SITE_SLUG\n');
  process.exit(2);
}
async function main() {
  const siteFile = join(portalRoot, 'sites', slug + '.json');
  const info = await lstat(siteFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 25000) {
    throw new Error('Saved Portal site missing or invalid');
  }
  const site = JSON.parse(await readFile(siteFile, 'utf8'));
  if (site.slug !== slug || typeof site.body !== 'string' || !site.body.trim()) {
    throw new Error('Existing site content is not publishable');
  }
  const manifest = join(operatorRoot, 'port-names.json');
  const before = verifyPortNames(JSON.parse(await readFile(manifest, 'utf8')));
  const beforeEntry = before.entries.find(e => e.name === slug);
  if (beforeEntry && beforeEntry.targetPort !== before.ownerPort) {
    throw new Error('Alias already delegates to another Port Zero; refusing takeover');
  }
  if (!beforeEntry) {
    // No shell expansion and no remote provider. The native operator signer enforces key permissions.
    execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/port-domain.mjs', import.meta.url)),
      'bind', slug, before.ownerPort, '--dir', operatorRoot], { stdio: 'pipe', timeout: 10000 });
  }
  const signed = JSON.parse(await readFile(manifest, 'utf8'));
  const after = verifyPortNames(signed);
  const uri = makePortUri(after.ownerPort, slug);
  const mapped = resolvePortName(uri, signed);
  if (mapped.targetPort !== after.ownerPort) throw new Error('Site alias points to another port');
  process.stdout.write(JSON.stringify({
    schema: 'kindred.sdpn.portal-publish.v1', slug, uri,
    localPreview: '/p/' + slug, signedNamespace: true,
    publiclyReachable: false, networkAuthorized: false
  }, null, 2) + '\n');
}
main().catch(error => { process.stderr.write('PORTAL PUBLISH DENIED: ' + error.message + '\n'); process.exitCode = 2; });
