import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('reproducible CDC benchmark measures exact bytes and beats fixed-block resend on insertion', () => {
  const path = fileURLToPath(new URL('../scripts/benchmark-tesseract-cdc.mjs', import.meta.url));
  const processResult = spawnSync(process.execPath, [path], {
    encoding: 'utf8', timeout: 30000,
    maxBuffer: 256 * 1024, env: { ...process.env, NODE_OPTIONS: '' }
  });
  assert.equal(processResult.status, 0, processResult.stderr);
  const report = JSON.parse(processResult.stdout);
  assert.equal(report.schema, 'kindred.sdpn.cdc-delta-benchmark.v1');
  assert.equal(report.exactSha256Matched, true);
  assert.equal(report.actualTransportBytesMeasured, false);
  assert.equal(report.cryptographicControlOverheadIncluded, false);
  assert.equal(report.actualPhysicalNoRoutingVerified, false);
  assert.equal(report.globalConnectivityVerified, false);
  assert.equal(report.testOnlyInProcessByteSupplier, true);
  assert.ok(report.baselineFullPayloadBytes >= 2 * 1024 * 1024);
  assert.ok(report.cdcUniqueMissingBytes < report.baselineFullPayloadBytes * 0.5);
  assert.ok(report.cdcUniqueMissingBytes < report.fixed64kUniqueMissingBytes);
  assert.equal(report.cdcLogicalPayloadSavingsBytes,
    report.baselineFullPayloadBytes - report.cdcUniqueMissingBytes);
});
