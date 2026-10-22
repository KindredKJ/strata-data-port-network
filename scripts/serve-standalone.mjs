import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const publicDirectory = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.html', ['app.html', 'text/html; charset=utf-8']],
  ['/app-core.mjs', ['app-core.mjs', 'text/javascript; charset=utf-8']],
  ['/app-ui.mjs', ['app-ui.mjs', 'text/javascript; charset=utf-8']],
]);

const baseHeaders = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const workspaceCsp = "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'";
const landingCsp = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'";

function respond(request, response, status, type, bytes, extraHeaders = {}) {
  response.writeHead(status, {
    ...baseHeaders,
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(bytes),
    ...extraHeaders,
  });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

export function createStandaloneServer() {
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      respond(request, response, 405, 'text/plain; charset=utf-8', 'Method not allowed\n', { Allow: 'GET, HEAD' });
      return;
    }

    // Match an explicit raw path allowlist; never resolve arbitrary user-supplied filesystem paths.
    const rawPath = (request.url ?? '').split('?', 1)[0];
    if (rawPath === '/healthz') {
      respond(request, response, 200, 'application/json; charset=utf-8',
        JSON.stringify({ service: 'strata-data-port-network', status: 'ok', scope: 'static-web-only', network_status: 'not-asserted' }) + '\n');
      return;
    }

    const asset = assets.get(rawPath);
    if (!asset) {
      respond(request, response, 404, 'text/plain; charset=utf-8', 'Not found\n');
      return;
    }

    const [filename, contentType] = asset;
    const headers = contentType.startsWith('text/html')
      ? { 'Content-Security-Policy': filename === 'app.html' ? workspaceCsp : landingCsp }
      : {};
    try {
      const bytes = await readFile(join(publicDirectory, filename));
      respond(request, response, 200, contentType, bytes, headers);
    } catch {
      respond(request, response, 503, 'text/plain; charset=utf-8', 'Static asset unavailable\n');
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const host = process.env.SDPN_HOST || '127.0.0.1';
  const portText = process.env.SDPN_PORT || '8787';
  if (!/^\\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new Error('SDPN_PORT must be an integer from 1 to 65535');
  }
  const server = createStandaloneServer();
  server.listen(Number(portText), host, () => {
    process.stdout.write(`SDPN static workspace: http://${host}:${portText}/ (network protocol not started)\n`);
  });
}
