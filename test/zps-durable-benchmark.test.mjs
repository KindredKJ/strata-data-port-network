import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('measured encrypted ZPS filesystem benchmark produces exact persisted bytes', () => {
  const script = fileURLToPath(new URL('../scripts/benchmark-zps-durability.mjs', import.meta.url));
  const trial = spawnSync(process.execPath, [script], {
    encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 60000,
    env: { ...process.env, NODE_OPTIONS: '' }
  });
  assert.equal(trial.status, 0, trial.stderr);
  const report = JSON.parse(trial.stdout);
  assert.equal(report.schema, 'kindred.sdpn.zps.real-filesystem-benchmark.v1');
  assert.equal(report.inputBytes, 1024 * 1024);
  assert.equal(report.validatedExactSha256, true);
  assert.equal(report.actualEncryptedDiskIO, true);
  assert.equal(report.actualPhysicalPowerInterruptionVerified, false);
  assert.equal(report.separateOperatingSystemProcessRestartVerified, false);
  assert.equal(report.trueColdCacheWithoutOsPageCacheVerified, false);
  assert.equal(report.crossHostTransportVerified, false);
  assert.equal(report.physicallyRouteFreeGlobalConnectivityVerified, false);
  assert.ok(report.encryptedPhysicalBytes > 0);
  assert.ok(report.uniqueEncryptedChunkFiles > 1);
  assert.equal(report.reopenedWarmCacheTrials, 10);
  assert.ok(report.reopenedWarmCacheReconstructionP50Ms >= 0);
  assert.ok(report.reopenedWarmCacheReconstructionP95Ms >= report.reopenedWarmCacheReconstructionP50Ms);
  assert.ok(report.reopenedWarmCacheReconstructionP99Ms >= report.reopenedWarmCacheReconstructionP95Ms);
});
