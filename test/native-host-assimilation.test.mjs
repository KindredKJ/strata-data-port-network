import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assimilateInstalledHost, persistLocalAssimilation } from '../src/native-host-assimilation.mjs';

test('assimilate actual installed host hardware, apps and services with no routing or execution', async () => {
  const inventory = await assimilateInstalledHost({
    programPaths: [dirname(process.execPath)],
    volumePaths: [tmpdir()]
  });
  assert.equal(inventory.schema, 'kindred.sdpn.machine-assimilation.v1');
  assert.equal(inventory.host.platform, process.platform);
  assert.equal(inventory.host.drives.length, 1);
  assert.ok(inventory.host.programs.some(p => p.executablePath));
  assert.equal(inventory.capabilitiesReadyForBinding.accessibleDrives, 1);
  assert.ok(Array.isArray(inventory.operatingSystem.installedApplications));
  assert.ok(Array.isArray(inventory.operatingSystem.services));
  assert.ok(typeof inventory.operatingSystem.deviceClasses === 'object');
  assert.ok(typeof inventory.operatingSystem.inventorySources === 'object');
  assert.equal(inventory.readOnlyDiscoveryComplete, true);
  assert.equal(inventory.userFilesScanned, false);
  assert.equal(inventory.machineFullyAccessible, false);
  assert.equal(inventory.applicationsAutomaticallyExecuted, false);
  assert.equal(inventory.dataUploaded, false);
  assert.equal(inventory.networkRoutesChanged, false);
  assert.equal(inventory.physicalGlobalConnectivityVerified, false);
});

test('local assimilation writes a private durable inventory without network operations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdpn-assimilation-'));
  try {
    const snapshot = await assimilateInstalledHost({
      programPaths: [dirname(process.execPath)],
      volumePaths: [dir],
      command: async () => ({ ok: false, error: 'PROVIDER_NOT_INSTALLED' }),
      sysRoot: join(dir, 'empty-sys')
    });
    const one = await persistLocalAssimilation(snapshot, dir);
    assert.equal(one.savedLocally, true);
    assert.equal(one.uploaded, false);
    assert.equal(one.routesChanged, false);
    const bytes = await readFile(one.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), one.sha256);
    const file = JSON.parse(bytes.toString('utf8'));
    assert.equal(file.schema, snapshot.schema);
    assert.equal(file.dataUploaded, false);
    if (process.platform !== 'win32') {
      const permissions = (await stat(one.path)).mode & 0o777;
      assert.equal(permissions & 0o077, 0);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installer CLI creates local manifest automatically, without exposing full inventory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sdpn-auto-bootstrap-'));
  try {
    const command = fileURLToPath(new URL('../scripts/assimilate-native-host.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [command, '--dir', dir], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: '' }
    });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.automaticCapabilitiesDiscovered, true);
    assert.equal(summary.uploaded, false);
    assert.equal(summary.networkRoutesChanged, false);
    assert.equal(summary.userFilesScanned, false);
    assert.equal('programs' in summary, false);
    const bytes = await readFile(summary.localReportPath);
    const report = JSON.parse(bytes.toString());
    assert.equal(report.schema, 'kindred.sdpn.machine-assimilation.v1');
    assert.equal(report.dataUploaded, false);
    assert.equal(report.host.platform, process.platform);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
