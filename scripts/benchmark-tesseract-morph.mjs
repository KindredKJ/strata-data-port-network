#!/usr/bin/env node
// Compare identical source/destination state deltas with matched payloads.
// Reports unique logical new bytes only: no carrier transport or physical routing proof.
import { performance } from 'node:perf_hooks';
import { createPortIdentity } from '../src/native-port-identity.mjs';
import { prepareCdcState, planCdcDelta } from '../src/tesseract-cdc-delta.mjs';
import { prepareMorphDelta, signMorphCoordinate, reconstructMorphLocally } from '../src/tesseract-state-morph.mjs';

function data(length, seed) {
  const b = Buffer.alloc(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    b[i] = x & 255;
  }
  return b;
}
function fixed(base, modified) {
  const hash = b => (awaitHash(b));
  const first = new Set();
  for (let i = 0; i < base.length; i += 65536) first.add(hash(base.subarray(i, i + 65536)));
  let required = 0;
  for (let i = 0; i < modified.length; i += 65536) {
    const part = modified.subarray(i, i + 65536);
    if (!first.has(hash(part))) required += part.length;
  }
  return required;
}
import { createHash } from 'node:crypto';
const awaitHash = b => createHash('sha256').update(b).digest('hex');

async function main() {
  const base = data(2 * 1024 * 1024, 18467);
  const target = Buffer.concat([base.subarray(0, 14593),
    data(173, 999), base.subarray(14593)]);
  const origin = createPortIdentity({ testSeed: Buffer.alloc(32, 201) });
  const destination = createPortIdentity({ testSeed: Buffer.alloc(32, 202) });
  const initial = prepareCdcState(base), final = prepareCdcState(target);
  const cdc = await planCdcDelta(final.manifest,
    async hash => initial.uniqueChunks.has(hash));
  const start = performance.now();
  const morph = prepareMorphDelta(base, target);
  const coordinate = signMorphCoordinate({
    originIdentity: origin, destinationPortId: destination.id,
    manifest: morph.manifest, now: 1_800_000_000_000
  });
  const reconstructed = reconstructMorphLocally(morph.manifest, base, morph.insertedBytes);
  const morphMs = +(performance.now() - start).toFixed(3);
  if (!reconstructed.equals(target)) throw new Error('MORPH exact state mismatch');
  const contentNew = morph.insertedBytes.length;
  const report = {
    schema: 'kindred.sdpn.tesseract-morph-benchmark.v1',
    workload: '2MiB deterministic high-entropy state, 173-byte inserted change',
    fullFileLogicalBytes: target.length,
    fixed64kMissingLogicalBytes: fixed(base, target),
    cdc1MissingLogicalBytes: cdc.uniqueMissingBytes,
    morph1NovelInformationLogicalBytes: contentNew,
    morph1SignedCoordinateBytes: Buffer.byteLength(JSON.stringify(coordinate)),
    morph1TotalLogicalPayloadPlusControlBytes:
      contentNew + Buffer.byteLength(JSON.stringify(coordinate)),
    morph1PayloadReductionVsFullPercent:
      +((1 - contentNew / target.length) * 100).toFixed(5),
    morph1PayloadReductionVsCDCPercent:
      +((1 - contentNew / cdc.uniqueMissingBytes) * 100).toFixed(3),
    manifestAndLocalReconstructionMs: morphMs,
    exactFinalSha256Verified: true,
    originalStateRequiredAtDestination: true,
    actualWireBytesMeasured: false,
    controlAndAEADFrameOverheadIncludedInPayloadComparisons: false,
    globalRouteFreePhysicalTransferProven: false,
    genuineNovelInformationRecreatedFromNothing: false
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main().catch(e => {
  process.stderr.write('MORPH BENCHMARK FAILED: ' + e.message + '\n');
  process.exitCode = 1;
});
