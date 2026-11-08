import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('MORPH deterministic benchmark proves exact reconstruction and smaller logical payload than CDC', () => {
  const script = fileURLToPath(new URL('../scripts/benchmark-tesseract-morph.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 512 * 1024,
    env: { ...process.env, NODE_OPTIONS: '' }
  });
  assert.equal(run.status, 0, run.stderr);
  const p = JSON.parse(run.stdout);
  assert.equal(p.schema, 'kindred.sdpn.tesseract-morph-benchmark.v1');
  assert.equal(p.exactFinalSha256Verified, true);
  assert.equal(p.morph1NovelInformationLogicalBytes, 173);
  assert.ok(p.morph1SignedCoordinateBytes > 0);
  assert.ok(p.morph1TotalLogicalPayloadPlusControlBytes < p.cdc1MissingLogicalBytes);
  assert.ok(p.cdc1MissingLogicalBytes < p.fullFileLogicalBytes / 10);
  assert.ok(p.morph1PayloadReductionVsFullPercent > 99.99);
  assert.ok(p.morph1PayloadReductionVsCDCPercent > 99);
  assert.equal(p.originalStateRequiredAtDestination, true);
  assert.equal(p.actualWireBytesMeasured, false);
  assert.equal(p.controlAndAEADFrameOverheadIncludedInPayloadComparisons, false);
  assert.equal(p.globalRouteFreePhysicalTransferProven, false);
  assert.equal(p.genuineNovelInformationRecreatedFromNothing, false);
});
