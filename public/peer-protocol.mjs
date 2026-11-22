// Strata secure peer transfer framing. HTTPS is used to load this code; WebRTC
// uses DTLS for peer transport. The payload remains a passphrase-sealed package.
export const MAX_TRANSFER_BYTES = 24 * 1024 * 1024;
export const CHUNK_BYTES = 12 * 1024;
export const PACKAGE_VERSION = 'kindred.sdpn.browser-package.v1';
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const DIGEST = /^[a-f0-9]{64}$/;
const SIGNAL_MAX = 256 * 1024;

export async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, x => x.toString(16).padStart(2, '0')).join('');
}

export function encodeSignal(description) {
  if (!description || !['offer', 'answer'].includes(description.type) ||
      typeof description.sdp !== 'string' || !description.sdp.startsWith('v=0') ||
      description.sdp.length > SIGNAL_MAX) {
    throw new Error('Invalid WebRTC connection description');
  }
  const bytes = enc.encode(JSON.stringify({ v: 1, type: description.type, sdp: description.sdp }));
  if (bytes.length > SIGNAL_MAX) throw new Error('Connection description is too long');
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSignal(value, expectedType) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value.trim()) ||
      value.length > SIGNAL_MAX * 2) throw new Error('Invalid connection code');
  const base64 = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  let parsed;
  try {
    parsed = JSON.parse(dec.decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))));
  } catch {
    throw new Error('Could not read connection code');
  }
  if (!parsed || parsed.v !== 1 || parsed.type !== expectedType ||
      typeof parsed.sdp !== 'string' || !parsed.sdp.startsWith('v=0') ||
      parsed.sdp.length > SIGNAL_MAX || Object.keys(parsed).sort().join(',') !== 'sdp,type,v') {
    throw new Error('Connection code has wrong type or format');
  }
  return { type: parsed.type, sdp: parsed.sdp };
}

export async function startFrame(packageText) {
  if (typeof packageText !== 'string') throw new Error('Invalid package');
  const bytes = enc.encode(packageText);
  if (bytes.length < 64 || bytes.length > MAX_TRANSFER_BYTES) throw new Error('Package is outside transfer size limits');
  const packageValue = JSON.parse(packageText);
  if (!packageValue || packageValue.version !== PACKAGE_VERSION ||
      typeof packageValue.ciphertext !== 'string') throw new Error('Not a Strata encrypted package');
  return { bytes, start: { v: 1, type: 'start', length: bytes.length, sha256: await sha256(bytes) } };
}

export class TransferReceiver {
  constructor() { this.reset(); }
  reset() { this.expected = null; this.buffers = []; this.received = 0; }
  begin(frame) {
    if (this.expected) throw new Error('Another transfer is in progress');
    if (!frame || frame.v !== 1 || frame.type !== 'start' ||
        !Number.isSafeInteger(frame.length) || frame.length < 64 || frame.length > MAX_TRANSFER_BYTES ||
        typeof frame.sha256 !== 'string' || !DIGEST.test(frame.sha256)) {
      throw new Error('Invalid or oversized transfer header');
    }
    this.expected = { length: frame.length, sha256: frame.sha256 };
  }
  append(input) {
    if (!this.expected) throw new Error('Transfer has not started');
    const data = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    if (!(data instanceof Uint8Array) || data.length < 1 || data.length > CHUNK_BYTES ||
        this.received + data.length > this.expected.length) throw new Error('Invalid transfer chunk');
    this.buffers.push(data.slice());
    this.received += data.length;
  }
  async finish(frame) {
    if (!this.expected || !frame || frame.v !== 1 || frame.type !== 'finish' ||
        this.received !== this.expected.length) throw new Error('Incomplete transfer');
    const data = new Uint8Array(this.expected.length);
    let offset = 0;
    for (const chunk of this.buffers) { data.set(chunk, offset); offset += chunk.length; }
    const actual = await sha256(data);
    if (actual !== this.expected.sha256) throw new Error('Transfer SHA-256 mismatch');
    let parsed;
    try { parsed = JSON.parse(dec.decode(data)); } catch { throw new Error('Invalid received package JSON'); }
    if (!parsed || parsed.version !== PACKAGE_VERSION || typeof parsed.ciphertext !== 'string' ||
        typeof parsed.iv !== 'string' || typeof parsed.salt !== 'string') {
      throw new Error('Received data is not a Strata encrypted package');
    }
    this.reset();
    return { bytes: data, sha256: actual };
  }
}

function waitForBuffer(channel) {
  if (channel.readyState !== 'open') return Promise.reject(new Error('Peer disconnected'));
  if (channel.bufferedAmount <= 256 * 1024) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Peer send buffer stalled')); }, 20000);
    const tick = () => { if (channel.bufferedAmount <= 256 * 1024) { cleanup(); resolve(); } };
    const closed = () => { cleanup(); reject(new Error('Peer disconnected')); };
    function cleanup() {
      clearTimeout(timeout);
      channel.removeEventListener('bufferedamountlow', tick);
      channel.removeEventListener('close', closed);
    }
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.addEventListener('bufferedamountlow', tick);
    channel.addEventListener('close', closed);
    tick();
  });
}

export async function sendPackage(channel, packageText, onProgress = () => {}) {
  if (!channel || channel.readyState !== 'open') throw new Error('Connect to the receiving device first');
  const { bytes, start } = await startFrame(packageText);
  channel.send(JSON.stringify(start));
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    await waitForBuffer(channel);
    if (channel.readyState !== 'open') throw new Error('Peer disconnected');
    channel.send(bytes.slice(offset, Math.min(offset + CHUNK_BYTES, bytes.length)).buffer);
    onProgress(Math.min(offset + CHUNK_BYTES, bytes.length), bytes.length);
  }
  await waitForBuffer(channel);
  channel.send(JSON.stringify({ v: 1, type: 'finish' }));
  return start.sha256;
}
