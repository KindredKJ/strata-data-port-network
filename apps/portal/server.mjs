// PORTAL/1: sovereign SDPN discovery, learning, local-model AI and owned-site workspace.
// Founder: Kindred Jermaine Cox / Kindred Labs.
// Loopback-only by design; this service does not grant Port Zero sessions or run a public crawler.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, mkdir, open, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyPortNames, makePortUri } from '../../src/port-names.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = fileURLToPath(new URL('./public/', import.meta.url));
const defaultData = join(homedir(), '.sdpn', 'portal');
const defaultManifest = join(homedir(), '.sdpn', 'port-names.json');
const allowedTasks = new Set(['learn', 'research', 'create', 'build', 'plan']);
const slugPattern = /^[a-z][a-z0-9-]{1,47}$/;
const security = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
});
const staticAssets = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
});
function reply(req, res, code, data, type = 'application/json; charset=utf-8', additional = {}) {
  const bytes = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
  res.writeHead(code, { ...security, ...additional, 'Content-Type': type, 'Content-Length': String(bytes.length) });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
function error(req, res, code, message) { reply(req, res, code, { error: message }); }
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function validateSite(source) {
  if (!source || Object.getPrototypeOf(source) !== Object.prototype ||
    Object.keys(source).some(key => !['slug', 'title', 'description', 'body'].includes(key))) {
    throw new Error('Unrecognized site payload');
  }
  const { slug, title, description, body } = source;
  if (typeof slug !== 'string' || !slugPattern.test(slug) ||
    typeof title !== 'string' || title.trim().length < 2 || title.length > 100 ||
    typeof description !== 'string' || description.length > 250 ||
    typeof body !== 'string' || body.trim().length < 1 || body.length > 20000) {
    throw new Error('Site name, title, description or content rejected');
  }
  return { slug, title: title.trim(), description: description.trim(), body: body.trim() };
}
async function readRequest(req, max = 24576) {
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > max) throw new Error('Request exceeds local maximum');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function listSites(directory) {
  let names;
  try { names = await readdir(join(directory, 'sites'), { withFileTypes: true }); }
  catch (cause) { if (cause.code === 'ENOENT') return []; throw cause; }
  const sites = [];
  for (const entry of names) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const slug = entry.name.slice(0, -5);
    if (!slugPattern.test(slug)) continue;
    const path = join(directory, 'sites', entry.name);
    try {
      const info = await stat(path);
      if (info.size > 25000) continue;
      const raw = JSON.parse(await readFile(path, 'utf8'));
      const site = validateSite(raw);
      if (site.slug === slug && typeof raw.createdAt === 'string') {
        sites.push({ ...site, createdAt: raw.createdAt });
      }
    } catch { /* Corrupt or incomplete drafts are never displayed as published facts. */ }
    if (sites.length >= 300) break;
  }
  return sites.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function saveSite(directory, source) {
  const site = validateSite(source);
  const existing = await listSites(directory);
  if (existing.length >= 300) throw new Error('Site capacity reached');
  const folder = join(directory, 'sites');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const created = { ...site, createdAt: new Date().toISOString() };
  const file = await open(join(folder, site.slug + '.json'), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(created) + '\n', 'utf8'); await file.sync(); }
  finally { await file.close(); }
  return created;
}
async function docsIndex() {
  const sources = [{ path: join(root, 'README.md'), name: 'README.md' }];
  const base = join(root, 'docs');
  const names = await readdir(base, { withFileTypes: true });
  for (const entry of names) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      sources.push({ path: join(base, entry.name), name: 'docs/' + entry.name });
    }
  }
  const docs = [];
  for (const source of sources) {
    try {
      const info = await stat(source.path);
      if (info.size > 512000) continue;
      const body = await readFile(source.path, 'utf8');
      const heading = body.match(/^#\s+(.+)$/m);
      docs.push({ id: source.name, title: (heading?.[1] ?? source.name).slice(0, 120),
        body: body.slice(0, 300000), kind: 'documentation', href: '/api/document?id=' + encodeURIComponent(source.name) });
    } catch { /* source genuinely unavailable */ }
  }
  return docs;
}
const tokenize = input => (input.toLocaleLowerCase('en').match(/[a-z0-9]{2,}/g) ?? []).slice(0, 20000);
function searchDocuments(documents, q) {
  if (typeof q !== 'string' || q.trim().length < 2 || q.length > 120) return [];
  const terms = [...new Set(tokenize(q))].slice(0, 10);
  if (!terms.length) return [];
  const freq = documents.map(doc => {
    const tokens = tokenize(doc.body);
    const count = new Map();
    for (const token of tokens) count.set(token, (count.get(token) ?? 0) + 1);
    return { ...doc, count, length: tokens.length || 1 };
  });
  const corpusSize = freq.length;
  const df = new Map(terms.map(term => [term, freq.filter(doc => doc.count.has(term)).length]));
  return freq.map(doc => {
    let score = 0;
    const title = doc.title.toLocaleLowerCase('en');
    for (const term of terms) {
      const n = doc.count.get(term) ?? 0;
      if (!n && !title.includes(term)) continue;
      const idf = Math.log(1 + (corpusSize - df.get(term) + 0.5) / (df.get(term) + 0.5));
      score += idf * ((n * 2.2) / (n + 1.2 * (0.25 + 0.75 * doc.length / 1800))) +
        (title.includes(term) ? 2.5 : 0);
    }
    const match = terms.map(term => doc.body.toLowerCase().indexOf(term)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, match - 110);
    const snippet = doc.body.slice(start, start + 310).replace(/\s+/g, ' ').trim();
    return { id: doc.id, title: doc.title, kind: doc.kind, href: doc.href, score, snippet };
  }).filter(doc => doc.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 20);
}
async function signedNamespace(manifestPath) {
  try {
    const info = await stat(manifestPath);
    if (info.size > 32768) throw new Error('Namespace too large');
    const record = JSON.parse(await readFile(manifestPath, 'utf8'));
    const body = verifyPortNames(record);
    return { verified: true, ownerPort: body.ownerPort, expiresAt: body.expiresAt,
      entries: body.entries.map(entry => ({
        name: entry.name, uri: makePortUri(body.ownerPort, entry.name), targetPort: entry.targetPort
      })) };
  } catch {
    return { verified: false, ownerPort: null, expiresAt: null, entries: [] };
  }
}
async function localAI({ task, prompt }, { model, endpoint }) {
  if (typeof task !== 'string' || !allowedTasks.has(task) ||
      typeof prompt !== 'string' || prompt.trim().length < 3 || prompt.length > 3500) {
    throw new Error('AI task or question rejected');
  }
  if (!model) return { unavailable: true, reason: 'No local model configured. Set PORTAL_LOCAL_MODEL to a running OpenAI-compatible local model identifier.' };
  let uri;
  try { uri = new URL(endpoint); } catch { throw new Error('Invalid local model endpoint'); }
  if (uri.protocol !== 'http:' || uri.hostname !== '127.0.0.1' ||
      uri.pathname !== '/v1/chat/completions' || uri.username || uri.password || uri.search || uri.hash) {
    throw new Error('Model endpoint must be local 127.0.0.1 /v1/chat/completions');
  }
  const directives = {
    learn: 'Explain clearly, give a concrete worked sequence, and identify prerequisites.',
    research: 'Separate observed evidence from inference, surface uncertainty and do not fabricate citations.',
    create: 'Produce an actionable and useful finished result with no invented external execution.',
    build: 'Offer runnable implementation steps, deployment gates and honest verification requirements.',
    plan: 'Sequence practical actions by value, dependencies and owner-approved authority.'
  };
  let response;
  try {
    response = await fetch(endpoint, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, max_tokens: 900, temperature: 0.3,
        messages: [{ role: 'system', content: 'You are Portal, SDPN local-first AI assistance. ' +
          directives[task] + ' Never claim a live port transfer or web fact without evidence. No remote actions.' },
          { role: 'user', content: prompt.trim() }] }),
      signal: AbortSignal.timeout(30000), redirect: 'error'
    });
  } catch { return { unavailable: true, reason: 'Local model server could not be reached or timed out.' }; }
  if (!response.ok) return { unavailable: true, reason: 'Local model returned HTTP ' + response.status };
  let completion;
  try {
    const raw = await response.text();
    if (raw.length > 262144) throw new Error('Model output too large');
    completion = JSON.parse(raw);
  } catch { return { unavailable: true, reason: 'Local model returned invalid or oversized content.' }; }
  const answer = completion?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) return { unavailable: true, reason: 'Local model supplied no usable answer.' };
  return { answer: answer.slice(0, 14000), source: 'configured-local-model', model };
}
function siteHtml(site) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><title>' + escapeHtml(site.title) +
    ' · PORTAL</title><link rel="stylesheet" href="/styles.css"></head><body class="published-site">' +
    '<main class="site-content"><p class="eyebrow">SDPN · LOCAL PORT SITE</p><h1>' + escapeHtml(site.title) +
    '</h1><p class="lead">' + escapeHtml(site.description) + '</p><article class="site-text">' +
    escapeHtml(site.body) + '</article><p><a href="/">Back to Portal</a></p></main></body></html>';
}
async function respondApi(req, res, url, opts, csrf) {
  if (req.method === 'GET' && url.pathname === '/api/session') {
    return reply(req, res, 200, { intentToken: csrf });
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const [sites, documents, names] = await Promise.all([listSites(opts.dataDirectory), docsIndex(),
      signedNamespace(opts.manifestPath)]);
    return reply(req, res, 200, {
      product: 'Portal', schema: 'kindred.sdpn.portal.v1', scope: 'local-only',
      searchCoverage: 'local-SDPN-documents-and-owned-sites',
      indexedDocuments: documents.length + sites.length, ownedSites: sites.length,
      signedNamespaceVerified: names.verified, localAIConfigured: Boolean(opts.model),
      networkPortSession: false, globalWebIndex: false, paidProviderRequired: false,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/ports') {
    return reply(req, res, 200, await signedNamespace(opts.manifestPath));
  }
  if (req.method === 'GET' && url.pathname === '/api/sites') {
    const sites = await listSites(opts.dataDirectory);
    const names = await signedNamespace(opts.manifestPath);
    return reply(req, res, 200, { sites: sites.map(({ body, ...site }) => ({
      ...site, preview: '/p/' + site.slug,
      portUri: names.entries.some(e => e.name === site.slug) && names.ownerPort
        ? makePortUri(names.ownerPort, site.slug) : null
    })) });
  }
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const [docs, sites] = await Promise.all([docsIndex(), listSites(opts.dataDirectory)]);
    const all = docs.concat(sites.map(s => ({ id: 'site:' + s.slug, title: s.title, kind: 'owned-port-site',
      href: '/p/' + s.slug, body: s.description + '\n' + s.body })));
    return reply(req, res, 200, { coverage: 'locally-indexed SDPN documents and owned sites only',
      results: searchDocuments(all, url.searchParams.get('q') ?? ''), indexed: all.length });
  }
  if (req.method === 'GET' && url.pathname === '/api/document') {
    const id = url.searchParams.get('id');
    const docs = await docsIndex();
    const doc = docs.find(item => item.id === id);
    if (!doc) return error(req, res, 404, 'Document not indexed');
    return reply(req, res, 200, { id: doc.id, title: doc.title, body: doc.body });
  }
  if (req.method === 'POST' && (url.pathname === '/api/sites' || url.pathname === '/api/assist')) {
    const actualOrigin = 'http://127.0.0.1:' + opts.port();
    const supplied = req.headers['x-portal-intent'];
    if (req.headers.origin !== actualOrigin || typeof supplied !== 'string' ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(csrf) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(csrf))) return error(req, res, 403, 'Operator intent required');
    let source;
    try { source = await readRequest(req); }
    catch { return error(req, res, 400, 'Invalid bounded JSON request'); }
    if (url.pathname === '/api/sites') {
      try { const site = await saveSite(opts.dataDirectory, source); return reply(req, res, 201,
        { site: { ...site, preview: '/p/' + site.slug }, signedPortPublished: false }); }
      catch (cause) {
        return error(req, res, cause.code === 'EEXIST' ? 409 : 400,
          cause.code === 'EEXIST' ? 'Port site name already exists' : cause.message);
      }
    }
    try {
      const result = await localAI(source, opts);
      return reply(req, res, result.unavailable ? 503 : 200, result);
    } catch (cause) { return error(req, res, 400, cause.message); }
  }
  return error(req, res, 404, 'Portal route unavailable');
}
export function createPortalServer({ dataDirectory = defaultData, manifestPath = defaultManifest,
  model = process.env.PORTAL_LOCAL_MODEL ?? '',
  endpoint = process.env.PORTAL_LOCAL_ENDPOINT ?? 'http://127.0.0.1:8080/v1/chat/completions' } = {}) {
  const csrf = randomBytes(32).toString('hex');
  const opts = { dataDirectory: resolve(dataDirectory), manifestPath: resolve(manifestPath),
    model, endpoint, port: () => server.address()?.port };
  const server = createServer(async (req, res) => {
    try {
      const boundPort = server.address()?.port;
      if (!boundPort || req.headers.host !== '127.0.0.1:' + boundPort) {
        return error(req, res, 403, 'Host boundary denied');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
        return error(req, res, 405, 'Method not allowed');
      }
      if (!req.url || req.url.length > 2048) return error(req, res, 400, 'Invalid route');
      const url = new URL(req.url, 'http://127.0.0.1:' + boundPort);
      if (req.method !== 'POST' && staticAssets[url.pathname]) {
        const [filename, type] = staticAssets[url.pathname];
        return reply(req, res, 200, await readFile(join(assets, filename)), type);
      }
      if (req.method === 'GET' && /^\/p\/[a-z][a-z0-9-]{1,47}$/.test(url.pathname)) {
        const slug = url.pathname.slice(3);
        const site = (await listSites(opts.dataDirectory)).find(site => site.slug === slug);
        if (!site) return error(req, res, 404, 'Port site not found');
        return reply(req, res, 200, siteHtml(site), 'text/html; charset=utf-8');
      }
      if (url.pathname.startsWith('/api/')) return await respondApi(req, res, url, opts, csrf);
      return error(req, res, 404, 'Portal route unavailable');
    } catch {
      return error(req, res, 500, 'Portal operation unavailable');
    }
  });
  return server;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const portText = process.env.PORTAL_PORT ?? '8790';
  if (!/^\d{2,5}$/.test(portText) || Number(portText) < 1024 || Number(portText) > 65535) {
    throw new Error('PORTAL_PORT must be an integer between 1024 and 65535');
  }
  createPortalServer().listen(Number(portText), '127.0.0.1', () => {
    process.stdout.write('PORTAL: http://127.0.0.1:' + portText + '/ (independent SDPN local workspace)\n');
  });
}
