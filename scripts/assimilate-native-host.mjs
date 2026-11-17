#!/usr/bin/env node
// SDPN first-run hardware assimilation. Entirely local; no Port Zero enrollment,
// route setup, app execution, file content collection, or telemetry upload.
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assimilateInstalledHost, persistLocalAssimilation } from '../src/native-host-assimilation.mjs';

async function main(argv) {
  let dir = join(homedir(), '.sdpn'), verbose = false;
  if (argv.length > 3) throw new Error('Usage: node scripts/assimilate-native-host.mjs [--dir PRIVATE_DIRECTORY] [--json]');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') verbose = true;
    else if (argv[i] === '--dir' && argv[i + 1]) dir = argv[++i];
    else throw new Error('Unrecognized host assimilation argument');
  }
  const report = await assimilateInstalledHost();
  const result = await persistLocalAssimilation(report, resolve(dir));
  const summary = {
    schema: report.schema, capturedAt: report.capturedAt,
    platform: report.host.platform, cpuThreads: report.host.cpuThreads,
    driveCount: report.host.drives.length,
    binaryCount: report.host.programs.length,
    applicationCount: report.operatingSystem.installedApplications.length,
    serviceCount: report.operatingSystem.services.length,
    deviceClasses: Object.keys(report.operatingSystem.deviceClasses),
    inventorySources: report.operatingSystem.inventorySources,
    localReportPath: result.path,
    sha256: result.sha256,
    automaticCapabilitiesDiscovered: true,
    machineFullyAccessible: false,
    userFilesScanned: false, uploaded: false,
    applicationsAutomaticallyExecuted: false, networkRoutesChanged: false
  };
  // Full inventory only when explicitly requested; default output stays compact.
  process.stdout.write(JSON.stringify(verbose ? report : summary, null, 2) + '\n');
}

main(process.argv.slice(2)).catch(e => {
  process.stderr.write('SDPN HOST ASSIMILATION: ' + (e?.message ?? String(e)) + '\n');
  process.exitCode = 2;
});
