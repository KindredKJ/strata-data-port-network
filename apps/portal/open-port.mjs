#!/usr/bin/env node
// Local-only SDPN native PORT website reader. Verified alias + owner target + operator-managed files.
// No Internet fetch, no arbitrary file paths, no network transport authorization.
import { readFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parsePortUri, resolvePortName } from '../../src/port-names.mjs';

const escapeHtml = text => String(text).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function readPublishedPort(uri, { manifestPath = join(homedir(), '.sdpn', 'port-names.json'),
  dataDirectory = join(homedir(), '.sdpn', 'portal') } = {}) {
  const address = parsePortUri(uri);
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(address.name) || address.path !== '/') {
    throw new Error('Native website requires a signed top-level PORT alias');
  }
  const raw = await readFile(resolve(manifestPath));
  if (raw.length > 32768) throw new Error('Manifest too large');
  const signed = JSON.parse(raw.toString('utf8'));
  const result = resolvePortName(uri, signed);
  if (result.targetPort !== result.ownerPort) {
    throw new Error('Delegated remote port requires explicit authenticated transport');
  }
  const siteFile = join(resolve(dataDirectory), 'sites', address.name + '.json');
  const fileInfo = await lstat(siteFile);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size > 25000) {
    throw new Error('Native port website not present as an owned local site');
  }
  const site = JSON.parse(await readFile(siteFile, 'utf8'));
  if (site.slug !== address.name || typeof site.title !== 'string' ||
      site.title.length > 100 || typeof site.description !== 'string' ||
      site.description.length > 250 || typeof site.body !== 'string' || site.body.length > 20000) {
    throw new Error('Native website content rejected');
  }
  return {
    uri: result.address, title: site.title, signedNameVerified: true,
    authorizedNetworkTransport: false, globalDnsRegistration: false,
    html: '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; connect-src &#39;none&#39;; img-src data:; form-action &#39;none&#39;">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escapeHtml(site.title) + ' · PORT</title>' +
      '<style>body{margin:0;background:#08131c;color:#edf7fa;font:18px/1.7 system-ui,sans-serif;padding:8vw;overflow-wrap:anywhere}' +
      'main{max-width:860px;margin:auto}h1{font-size:clamp(36px,6vw,70px);letter-spacing:-.05em;line-height:1.1;color:#86efd5}' +
      'small{color:#a2c5d1;font-size:13px}article{white-space:pre-wrap;margin-top:28px;border-top:1px solid #315063;padding-top:25px}</style></head>' +
      '<body><main><small>PORTAL · SIGNED LOCAL SDPN ADDRESS: ' + escapeHtml(result.address) + '</small><h1>' +
      escapeHtml(site.title) + '</h1><p>' + escapeHtml(site.description) + '</p><article>' +
      escapeHtml(site.body) + '</article></main></body></html>'
  };
}
async function main(argv) {
  if (argv.length !== 1) throw new Error('Usage: node apps/portal/open-port.mjs port://SIGNED.LOCAL.SDPN/');
  const resolved = await readPublishedPort(argv[0]);
  process.stdout.write(JSON.stringify(resolved) + '\n');
}
if (process.argv[1] && process.argv[1].endsWith('open-port.mjs')) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write('PORTAL OPEN DENIED: ' + error.message + '\n');
    process.exitCode = 2;
  });
}
