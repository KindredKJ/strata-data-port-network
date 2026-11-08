#!/usr/bin/env node
// Repeatable in-process delta benchmark. Reports actual logical chunk counts,
// NOT end-to-end network goodput, energy savings or global no-routing proof.
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import {
  prepareCdcState, planCdcDelta, reconstructCdcDelta
} from '../src/tesseract-cdc-delta.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
function bytes(size, seed) {
  const output = Buffer.alloc(size);
  let x = seed >>> 0;
  for (let i = 0; i < output.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    output[i] = x & 255;
  }
  return output;
}
function fixedChunks(input, size) {
  const chunks = new Map();
  for (let i = 0; i < input.length; i += size) {
    const block = input.subarray(i, i + size);
    chunks.set(hash(block), block.length);
  }
  return chunks;
}

async function main() {
  const original = bytes(2 * 1024 * 1024, 18467);
  const addition = bytes(173, 999);
  const shifted = Buffer.concat([
    original.subarray(0, 14593), addition, original.subarray(14593)
  ]);
  const begin = performance.now();
  const before = prepareCdcState(original);
  const after = prepareCdcState(shifted);
  const preparedMs = +(performance.now() - begin).toFixed(3);
  const availability = await planCdcDelta(after.manifest,
    async key => before.uniqueChunks.has(key));
  const fixedBefore = fixedChunks(original, 65536);
  const fixedAfter = fixedChunks(shifted, 65536);
  const fixedUniqueMissingBytes = [...fixedAfter].filter(([key]) => !fixedBefore.has(key))
    .reduce((n, [, size]) => n + size, 0);

  const reconstructionStarted = performance.now();
  const result = await reconstructCdcDelta({
    manifest: after.manifest,
    adapter: { id: 'direct.pipe/v1', substrate: 'ANONYMOUS_PIPE',
      underlyingIp: false, underlyingRouting: false },
    readLocalChunk: async key => before.uniqueChunks.get(key),
    receiveMissingChunk: async key => after.uniqueChunks.get(key)
  });
  const reconstructedMs = +(performance.now() - reconstructionStarted).toFixed(3);
  if (!result.reconstructed.equals(shifted)) throw new Error('Reconstruction bytes failed exact verification');
  if (availability.uniqueMissingBytes !== result.newlyDeliveredUniqueBytes) {
    throw new Error('Inventory estimate and verified missing bytes diverged');
  }
  const saved = result.stateBytes - result.newlyDeliveredUniqueBytes;
  process.stdout.write(JSON.stringify({
    schema: 'kindred.sdpn.cdc-delta-benchmark.v1',
    workload: '2MiB deterministic high-entropy binary with 173-byte insertion',
    baselineFullPayloadBytes: shifted.length,
    fixed64kUniqueMissingBytes,
    cdcUniqueMissingBytes: result.newlyDeliveredUniqueBytes,
    cdcLogicalPayloadSavingsBytes: saved,
    cdcLogicalPayloadSavingsPercent: result.payloadReductionPercent,
    extraLogicalSavingsVsFixed64kBytes:
      fixedUniqueMissingBytes - result.newlyDeliveredUniqueBytes,
    cdcSourceAndDestinationPrepareMs: preparedMs,
    cdcDestinationReconstructionMs: reconstructedMs,
    exactSha256Matched: result.stateSha256 === hash(shifted),
    measuredHost: process.platform,
    testOnlyInProcessByteSupplier: true,
    actualTransportBytesMeasured: false,
    cryptographicControlOverheadIncluded: false,
    actualPhysicalNoRoutingVerified: false,
    globalConnectivityVerified: false
  }, null, 2) + '\n');
}
main().catch(e => {
  process.stderr.write('SDPN CDC BENCHMARK FAILED: ' + (e?.message ?? String(e)) + '\n');
  process.exitCode = 1;
});
