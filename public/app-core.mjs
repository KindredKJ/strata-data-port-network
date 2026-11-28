// Strata browser package v1. This portable buffered path does not claim live network transport.
export const PACKAGE_VERSION = 'kindred.sdpn.browser-package.v1';
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
const ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function bytesToBase64(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}

function base64ToBytes(value, maximum) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid package encoding');
  }
  const binary = atob(value);
  if (binary.length > maximum) throw new Error('Package is too large');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hex(bytes) {
  return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
}

async function digest(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

async function keyFromPassphrase(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) {
    throw new Error('Use a passphrase of at least 12 characters');
  }
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

function safeName(name) {
  if (typeof name !== 'string' || !name || name.length > 255 || /[\\/\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..') {
    throw new Error('Invalid file name');
  }
  return name;
}

export async function sealFile(file, passphrase) {
  if (!file || typeof file.arrayBuffer !== 'function' || file.size < 0 || file.size > MAX_FILE_BYTES) {
    throw new Error('Choose a file up to 16 MiB');
  }
  const name = safeName(file.name);
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length !== file.size) throw new Error('File changed while reading');
  const sha256 = await digest(data);
  const meta = encoder.encode(JSON.stringify({ name, mime: typeof file.type === 'string' ? file.type.slice(0, 128) : '', size: data.length, sha256 }));
  const clear = new Uint8Array(4 + meta.length + data.length);
  new DataView(clear.buffer).setUint32(0, meta.length);
  clear.set(meta, 4);
  clear.set(data, 4 + meta.length);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPassphrase(passphrase, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, clear));
  return {
    package: { version: PACKAGE_VERSION, kdf: 'PBKDF2-SHA256-310000', cipher: 'AES-256-GCM', salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) },
    receipt: { classification: 'PORTABLE_BUFFERED_ENCRYPTED_PACKAGE', name, bytes: data.length, sha256, executed: true, networkTransportProven: false }
  };
}

export async function openPackage(packageText, passphrase) {
  if (typeof packageText !== 'string' || packageText.length > 24 * 1024 * 1024) throw new Error('Package is too large');
  let value;
  try { value = JSON.parse(packageText); } catch { throw new Error('Invalid package JSON'); }
  if (!value || Array.isArray(value) || value.version !== PACKAGE_VERSION ||
      value.kdf !== 'PBKDF2-SHA256-310000' || value.cipher !== 'AES-256-GCM' ||
      Object.keys(value).sort().join(',') !== 'cipher,ciphertext,iv,kdf,salt,version') {
    throw new Error('Unsupported package format');
  }
  const salt = base64ToBytes(value.salt, 16);
  const iv = base64ToBytes(value.iv, 12);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid package parameters');
  const ciphertext = base64ToBytes(value.ciphertext, MAX_FILE_BYTES + 4096);
  const key = await keyFromPassphrase(passphrase, salt);
  let clear;
  try { clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)); }
  catch { throw new Error('Could not open package: wrong passphrase or altered data'); }
  if (clear.length < 6) throw new Error('Invalid package contents');
  const metaSize = new DataView(clear.buffer).getUint32(0);
  if (metaSize < 2 || metaSize > 1024 || 4 + metaSize > clear.length) throw new Error('Invalid package metadata');
  let meta;
  try { meta = JSON.parse(decoder.decode(clear.subarray(4, 4 + metaSize))); } catch { throw new Error('Invalid package metadata'); }
  const bytes = clear.slice(4 + metaSize);
  if (!meta || safeName(meta.name) !== meta.name || typeof meta.mime !== 'string' || meta.mime.length > 128 ||
      meta.size !== bytes.length || bytes.length > MAX_FILE_BYTES || !/^[0-9a-f]{64}$/.test(meta.sha256) ||
      await digest(bytes) !== meta.sha256) {
    throw new Error('Package integrity check failed');
  }
  return { name: meta.name, mime: meta.mime, bytes, sha256: meta.sha256 };
}
