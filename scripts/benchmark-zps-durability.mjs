#!/usr/bin/env node
// Deterministic content, real encrypted filesystem I/O; this is NOT an abrupt
// power-loss test, cold-cache test, independent physical-host or wire benchmark.
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomBytes, createHash } from 'node:crypto';
import { createPortIdentity } from '../src/native-port-identity.mjs';
import { prepareCdcState } from '../src/tesseract-cdc-delta.mjs';
import { DurablePortChunkStore } from '../src/zps-durable-cas.mjs';

function deterministic(length, seed = 451) {
  const out = Buffer.alloc(length);
  let x = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    out[i] = x & 255;
  }
  return out;
}
function percentile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  return +(s[Math.max(0, Math.ceil(q * s.length) - 1)]).toFixed(3);
}
async function main() {
  const location = await mkdtemp(join(tmpdir(), 'sdpn-zps-durable-measure-'));
  const key = randomBytes(32);
  const identity = createPortIdentity({ testSeed: Buffer.alloc(32, 238) });
  const input = deterministic(1024 * 1024);
  const prepared = prepareCdcState(input);
  const timings = [];
  let store;
  try {
    const start = performance.now();
    store = await DurablePortChunkStore.open({
      directory: location, portId: identity.id, encryptionKey: key
    });
    const published = await store.importPrepared(prepared);
    const writeMs = +(performance.now() - start).toFixed(3);
    const usage = await store.usage();
    if (!published.published || usage.chunks !== prepared.uniqueChunks.size) {
      throw new Error('ZPS durable state publication and physical chunk inventory disagree');
    }
    store.close(); store = undefined;
    store = await DurablePortChunkStore.open({
      directory: location, portId: identity.id, encryptionKey: key
    });
    for (let i = 0; i < 10; i++) {
      const begin = performance.now();
      const restored = await store.readPublishedState(prepared.manifest.sha256);
      const elapsed = performance.now() - begin;
      if (!restored.equals(input)) throw new Error('ZPS reopen/reconstruction integrity failure');
      timings.push(elapsed);
      restored.fill(0);
    }
    const result = {
      schema: 'kindred.sdpn.zps.real-filesystem-benchmark.v1',
      inputBytes: input.length,
      stateSha256: createHash('sha256').update(input).digest('hex'),
      encryptedPhysicalBytes: usage.bytes,
      uniqueEncryptedChunkFiles: usage.chunks,
      initialEncryptedWriteAndPublishMs: writeMs,
      reopenedWarmCacheTrials: timings.length,
      reopenedWarmCacheReconstructionP50Ms: percentile(timings, 0.50),
      reopenedWarmCacheReconstructionP95Ms: percentile(timings, 0.95),
      reopenedWarmCacheReconstructionP99Ms: percentile(timings, 0.99),
      validatedExactSha256: true,
      actualEncryptedDiskIO: true,
      separateOperatingSystemProcessRestartVerified: false,
      actualPhysicalPowerInterruptionVerified: false,
      trueColdCacheWithoutOsPageCacheVerified: false,
      crossHostTransportVerified: false,
      physicallyRouteFreeGlobalConnectivityVerified: false,
      metricScope: 'actual_local_encrypted_filesystem_IO_warm_cache'
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    store?.close(); key.fill(0); input.fill(0);
    await rm(location, { recursive: true, force: true });
  }
}
main().catch(error => {
  process.stderr.write('SDPN ZPS BENCHMARK FAILED: ' + error.message + '\n');
  process.exitCode = 1;
});
