// Kindred Labs SDPN — Tesseract CDC/1: transport-independent, lossless content-delta engine.
// Pre-existing destination chunks are reused; missing NEW information must arrive over
// an independently declared and authorized carrier. This module performs no routing.
import { createHash } from 'node:crypto';
import { validateAdapterDescriptor } from './native-session.mjs';

export const CDC_MANIFEST_SCHEMA = 'kindred.sdpn.tesseract-cdc-manifest.v1';
export const CDC_PROFILE = Object.freeze({
  name: 'SDPN_CDC_8K_16K_64K_BUZHASH48_V1',
  min: 8 * 1024,
  average: 16 * 1024,
  max: 64 * 1024,
  window: 48
});
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_STATE_BYTES / CDC_PROFILE.min) + 1;
const SHA256 = /^[a-f0-9]{64}$/;
const exact = (actual, expected) =>
  actual && Object.getPrototypeOf(actual) === Object.prototype &&
  Object.keys(actual).sort().join('|') === expected.slice().sort().join('|');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const roll = (value, count) => ((value << count) | (value >>> (32 - count))) >>> 0;

// Pin a deterministic, versioned rolling-hash table. This is a chunk-boundary
// detector, NOT a cryptographic digest; integrity is checked by SHA-256 below.
const GEAR = Uint32Array.from({ length: 256 }, (_, i) => createHash('sha256')
  .update('kindred.sdpn.cdc.gear.v1/' + i).digest().readUInt32LE(0));

function inputBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_STATE_BYTES) {
    throw new TypeError('CDC state requires at most 4 MiB of binary bytes');
  }
  return Buffer.from(bytes);
}
function verifyAdapter(adapter) {
  validateAdapterDescriptor(adapter);
  if (adapter.underlyingIp !== false || adapter.underlyingRouting !== false) {
    throw new Error('STRICT CDC transfer rejects IP or routed underlays');
  }
  // No purely software adapter declaration is evidence of physical non-routing.
}
function validateDescriptor(chunk, index, length) {
  if (!exact(chunk, ['sha256', 'bytes']) || typeof chunk.sha256 !== 'string' ||
      !SHA256.test(chunk.sha256) || !Number.isSafeInteger(chunk.bytes) ||
      chunk.bytes < 1 || chunk.bytes > CDC_PROFILE.max ||
      (index < length - 1 && chunk.bytes < CDC_PROFILE.min)) {
    throw new Error('CDC chunk integrity descriptor rejected');
  }
}
export function verifyCdcManifest(manifest) {
  if (!exact(manifest, ['schema', 'profile', 'totalBytes', 'sha256', 'chunks']) ||
      manifest.schema !== CDC_MANIFEST_SCHEMA ||
      manifest.profile !== CDC_PROFILE.name ||
      !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 ||
      manifest.totalBytes > MAX_STATE_BYTES ||
      typeof manifest.sha256 !== 'string' || !SHA256.test(manifest.sha256) ||
      !Array.isArray(manifest.chunks) || manifest.chunks.length > MAX_CHUNKS ||
      (manifest.totalBytes === 0 ? manifest.chunks.length !== 0 :
        manifest.chunks.length === 0)) throw new Error('CDC manifest schema rejected');
  let total = 0;
  for (let i = 0; i < manifest.chunks.length; i++) {
    validateDescriptor(manifest.chunks[i], i, manifest.chunks.length);
    total += manifest.chunks[i].bytes;
  }
  if (total !== manifest.totalBytes ||
      (total === 0 && manifest.sha256 !== sha256(Buffer.alloc(0)))) {
    throw new Error('CDC manifest length or zero-state digest rejected');
  }
  return Object.freeze({
    schema: manifest.schema, profile: manifest.profile,
    totalBytes: manifest.totalBytes, sha256: manifest.sha256,
    chunks: Object.freeze(manifest.chunks.map(x => Object.freeze({ ...x })))
  });
}

export function prepareCdcState(bytes) {
  const input = inputBytes(bytes);
  const parts = [], uniqueChunks = new Map();
  let start = 0, rolling = 0;
  for (let i = 0; i < input.length; i++) {
    rolling = (roll(rolling, 1) ^ GEAR[input[i]]) >>> 0;
    if (i - start >= CDC_PROFILE.window) {
      rolling = (rolling ^ roll(GEAR[input[i - CDC_PROFILE.window]], CDC_PROFILE.window)) >>> 0;
    }
    const currentLength = i + 1 - start;
    const cut = currentLength >= CDC_PROFILE.max ||
      (currentLength >= CDC_PROFILE.min && (rolling & (CDC_PROFILE.average - 1)) === 0);
    if (cut) {
      const chunk = Buffer.from(input.subarray(start, i + 1));
      const hash = sha256(chunk);
      parts.push({ sha256: hash, bytes: chunk.length });
      uniqueChunks.set(hash, chunk);
      start = i + 1;
      rolling = 0;
    }
  }
  if (start < input.length) {
    const chunk = Buffer.from(input.subarray(start));
    const hash = sha256(chunk);
    parts.push({ sha256: hash, bytes: chunk.length });
    uniqueChunks.set(hash, chunk);
  }
  const manifest = verifyCdcManifest({
    schema: CDC_MANIFEST_SCHEMA, profile: CDC_PROFILE.name,
    totalBytes: input.length, sha256: sha256(input), chunks: parts
  });
  return Object.freeze({ manifest, uniqueChunks });
}

// Availability is only a planning hint. Reconstruction ALWAYS reads, hashes,
// and checks destination bytes before accepting any asserted local presence.
export async function planCdcDelta(manifest, hasLocalChunk) {
  const verified = verifyCdcManifest(manifest);
  if (typeof hasLocalChunk !== 'function') throw new TypeError('Local inventory callback required');
  const seen = new Set(), missing = [], present = [];
  for (const chunk of verified.chunks) {
    if (seen.has(chunk.sha256)) continue;
    seen.add(chunk.sha256);
    const available = await hasLocalChunk(chunk.sha256, chunk.bytes);
    if (available === true) present.push({ ...chunk });
    else missing.push({ ...chunk });
  }
  const uniqueMissingBytes = missing.reduce((sum, c) => sum + c.bytes, 0);
  return Object.freeze({
    schema: 'kindred.sdpn.tesseract-cdc-plan.v1',
    stateSha256: verified.sha256, stateBytes: verified.totalBytes,
    missing: Object.freeze(missing.map(x => Object.freeze(x))),
    preexisting: Object.freeze(present.map(x => Object.freeze(x))),
    uniqueMissingBytes, payloadBytesSavedEstimate: Math.max(0, verified.totalBytes - uniqueMissingBytes),
    destinationStateVerified: false, networkRouteProven: false,
    physicalCarrierVerified: false
  });
}

export async function reconstructCdcDelta({
  manifest, readLocalChunk, receiveMissingChunk, adapter,
  onReconstructed
}) {
  const verified = verifyCdcManifest(manifest);
  verifyAdapter(adapter);
  if (typeof readLocalChunk !== 'function' ||
      typeof receiveMissingChunk !== 'function' ||
      (onReconstructed !== undefined && typeof onReconstructed !== 'function')) {
    throw new TypeError('Explicit destination local read and missing-byte delivery required');
  }
  const output = Buffer.alloc(verified.totalBytes);
  const cache = new Map();
  let offset = 0, logicalReceivedBytes = 0, reusedPayloadBytes = 0,
    newlyFetchedUniqueChunks = 0, reusedChunkReferences = 0;
  try {
    for (const chunk of verified.chunks) {
      let data = cache.get(chunk.sha256);
      let origin = 'cache';
      if (!data) {
        const existing = await readLocalChunk(chunk.sha256, chunk.bytes);
        if (existing instanceof Uint8Array && existing.byteLength === chunk.bytes &&
            sha256(existing) === chunk.sha256) {
          data = Buffer.from(existing);
          origin = 'destination-local';
        } else {
          const missing = await receiveMissingChunk(chunk.sha256, chunk.bytes);
          if (!(missing instanceof Uint8Array) || missing.byteLength !== chunk.bytes ||
              sha256(missing) !== chunk.sha256) {
            throw new Error('CDC missing chunk not delivered or failed integrity verification');
          }
          data = Buffer.from(missing);
          origin = 'new-bytes';
          logicalReceivedBytes += data.length;
          newlyFetchedUniqueChunks++;
        }
        cache.set(chunk.sha256, data);
      } else reusedChunkReferences++;
      if (origin !== 'new-bytes') reusedPayloadBytes += chunk.bytes;
      data.copy(output, offset);
      offset += chunk.bytes;
    }
    if (offset !== verified.totalBytes || sha256(output) !== verified.sha256) {
      throw new Error('CDC exact destination reconstruction failed');
    }
    // Publish only after the WHOLE output is cryptographically verified.
    if (onReconstructed) await onReconstructed(Buffer.from(output), verified);
    return Object.freeze({
      schema: 'kindred.sdpn.tesseract-cdc-reconstruction.v1',
      reconstructed: output,
      stateSha256: verified.sha256, stateBytes: verified.totalBytes,
      exactReconstructionVerified: true,
      newlyDeliveredUniqueBytes: logicalReceivedBytes,
      reusedPayloadBytes,
      newlyFetchedUniqueChunks, reusedChunkReferences,
      payloadReductionPercent: verified.totalBytes === 0 ? 100 :
        +((1 - logicalReceivedBytes / verified.totalBytes) * 100).toFixed(2),
      adapter: Object.freeze({ ...adapter }),
      dataDeliveryWasExplicit: true,
      ciphertextOverheadMeasured: false,
      globalConnectivityVerified: false,
      physicalRouteFreeTransportVerified: false
    });
  } catch (error) {
    output.fill(0);
    throw error;
  }
}
