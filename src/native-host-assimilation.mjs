// Kindred Labs SDPN — automatic local host assimilation.
// On installation, enumerate only OS-visible capabilities; never upload machine data,
// change routing, load privileged drivers, mount disks, read user documents or launch apps.
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, mkdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir, platform as runtimePlatform } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { inspectInstalledHost } from './native-host-capability-bridge.mjs';

const execFile = promisify(execFileCallback);
const MAX_ENTRIES = 4096, MAX_REPORT_BYTES = 8 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 12000;
const safeName = s => typeof s === 'string' && s.length > 0 && s.length <= 512 && !/[\x00-\x1f]/.test(s);

function dedupe(items, limit = MAX_ENTRIES) {
  const out = new Set();
  for (const item of items) {
    const value = typeof item === 'string' ? item.trim() : '';
    if (safeName(value)) out.add(value);
    if (out.size >= limit) break;
  }
  return Object.freeze([...out].sort((a,b) => a.localeCompare(b)));
}
async function osCmd(executable, args, timeout = PROVIDER_TIMEOUT_MS) {
  try {
    const { stdout } = await execFile(executable, args, {
      timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      env: process.env, shell: false
    });
    return { ok: true, stdout };
  } catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'PROVIDER_NOT_INSTALLED' : 'PROVIDER_UNAVAILABLE' }; }
}
async function listSysfs(path) {
  try {
    return dedupe(await readdir(path), 1024);
  } catch { return Object.freeze([]); }
}
async function linuxCapabilities({ sysRoot = '/sys', command = osCmd } = {}) {
  const groups = {};
  for (const type of ['block', 'drm', 'video4linux', 'sound', 'input', 'tty',
    'bluetooth', 'net', 'hidraw', 'power_supply', 'thermal', 'scsi_device']) {
    groups[type] = await listSysfs(join(sysRoot, 'class', type));
  }
  const pkgSources = [
    ['dpkg', 'dpkg-query', ['-W', '-f=${binary:Package}\n']],
    ['rpm', 'rpm', ['-qa', '--qf', '%{NAME}\n']],
    ['flatpak', 'flatpak', ['list', '--app', '--columns=application']],
    ['snap', 'snap', ['list']]
  ];
  const installed = [], evidence = {};
  for (const [name, binary, args] of pkgSources) {
    const r = await command(binary, args);
    evidence[name] = r.ok ? 'OS_REPORTED' : 'UNAVAILABLE';
    if (r.ok) installed.push(...r.stdout.split(/\r?\n/).slice(name === 'snap' ? 1 : 0));
  }
  const serviceResult = await command('systemctl',
    ['list-unit-files', '--type=service', '--no-legend', '--no-pager']);
  evidence.systemd = serviceResult.ok ? 'OS_REPORTED' : 'UNAVAILABLE';
  const services = serviceResult.ok ?
    serviceResult.stdout.split(/\r?\n/).map(line => line.split(/\s+/)[0])
      .filter(name => name?.endsWith('.service')) : [];
  return Object.freeze({ deviceClasses: Object.freeze(groups),
    installedApplications: dedupe(installed),
    services: dedupe(services),
    inventorySources: Object.freeze(evidence) });
}
async function windowsCapabilities({ command = osCmd } = {}) {
  // No serial numbers or software publisher/user identity. PowerShell is read-only.
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$uninstall = @("HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*")',
    '$apps = @($uninstall | ForEach-Object { Get-ItemProperty -Path $_ -ErrorAction SilentlyContinue } | Where-Object DisplayName | Select-Object -ExpandProperty DisplayName)',
    '$appx = @(Get-AppxPackage -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)',
    '$devices = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Select-Object -First 2048 -Property Class,FriendlyName,Status)',
    '$services = @(Get-Service -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)',
    '$out = [pscustomobject]@{ applications = @($apps) + @($appx); services = $services; devices = $devices }',
    '$out | ConvertTo-Json -Compress -Depth 5'
  ].join('; ');
  let result = await command('pwsh.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command',script]);
  if (!result.ok) result = await command('powershell.exe',
    ['-NoLogo','-NoProfile','-NonInteractive','-Command',script]);
  if (!result.ok) return { deviceClasses: Object.freeze({}),
    installedApplications: Object.freeze([]), services: Object.freeze([]),
    inventorySources: Object.freeze({ windowsPowerShell: 'UNAVAILABLE' }) };
  let data;
  try { data = JSON.parse(result.stdout.trim()); }
  catch { throw new Error('Windows inventory returned malformed JSON'); }
  const classes = {};
  for (const d of Array.isArray(data.devices) ? data.devices : []) {
    const kind = safeName(d.Class) ? d.Class : 'Unknown';
    if (!classes[kind]) classes[kind] = [];
    if (safeName(d.FriendlyName)) classes[kind].push(d.FriendlyName);
  }
  for (const k of Object.keys(classes)) classes[k] = dedupe(classes[k], 1024);
  return Object.freeze({
    deviceClasses: Object.freeze(classes),
    installedApplications: dedupe(data.applications || []),
    services: dedupe(data.services || []),
    inventorySources: Object.freeze({ windowsPowerShell: 'OS_REPORTED' })
  });
}
async function macCapabilities({ command = osCmd } = {}) {
  const results = await Promise.all([
    command('/usr/sbin/system_profiler', ['SPApplicationsDataType', '-json']),
    command('/usr/sbin/system_profiler', ['SPUSBDataType','SPBluetoothDataType',
      'SPDisplaysDataType','SPAudioDataType','SPCameraDataType','-json']),
    command('/bin/launchctl', ['list'])
  ]);
  let apps = [], devices = {};
  if (results[0].ok) {
    try { apps = JSON.parse(results[0].stdout).SPApplicationsDataType?.map(x => x._name) || []; }
    catch { /* incomplete inventory */ }
  }
  if (results[1].ok) {
    try {
      const report = JSON.parse(results[1].stdout);
      devices = Object.fromEntries(Object.entries(report).map(([k,v]) =>
        [k, dedupe((Array.isArray(v) ? v : []).map(x => x?._name).filter(Boolean))]));
    } catch { /* incomplete inventory */ }
  }
  return Object.freeze({ deviceClasses: Object.freeze(devices),
    installedApplications: dedupe(apps),
    services: results[2].ok ? dedupe(results[2].stdout.split(/\r?\n/)
      .slice(1).map(x => x.split(/\t/).at(-1))) : Object.freeze([]),
    inventorySources: Object.freeze({
      macApplications: results[0].ok ? 'OS_REPORTED' : 'UNAVAILABLE',
      macHardware: results[1].ok ? 'OS_REPORTED' : 'UNAVAILABLE',
      launchd: results[2].ok ? 'OS_REPORTED' : 'UNAVAILABLE'
    }) });
}
async function androidCapabilities({ command = osCmd } = {}) {
  const packages = await command('pm', ['list', 'packages']);
  return Object.freeze({ deviceClasses: Object.freeze({}),
    installedApplications: packages.ok ? dedupe(packages.stdout.split(/\r?\n/)
      .filter(x => x.startsWith('package:')).map(x => x.slice(8))) : Object.freeze([]),
    services: Object.freeze([]),
    inventorySources: Object.freeze({ androidPackageManager:
      packages.ok ? 'OS_REPORTED' : 'PERMISSION_OR_API_UNAVAILABLE' }) });
}
async function platformInventory(platform, options) {
  switch (platform) {
    case 'win32': return windowsCapabilities(options);
    case 'linux': return linuxCapabilities(options);
    case 'darwin': return macCapabilities(options);
    case 'android': return androidCapabilities(options);
    default: return Object.freeze({
      deviceClasses: Object.freeze({}),
      installedApplications: Object.freeze([]), services: Object.freeze([]),
      inventorySources: Object.freeze({ platform: 'UNSUPPORTED_OR_SANDBOXED' })
    });
  }
}

export async function assimilateInstalledHost({
  platform = runtimePlatform(), env = process.env, programPaths, volumePaths,
  command = osCmd, sysRoot = '/sys'
} = {}) {
  const [host, other] = await Promise.all([
    inspectInstalledHost({ platform, env, programPaths, volumePaths }),
    platformInventory(platform, { command, sysRoot })
  ]);
  // Available for per-port use; never a new global admin credential.
  const catalog = Object.freeze({
    schema: 'kindred.sdpn.machine-assimilation.v1',
    capturedAt: Date.now(),
    host: Object.freeze(host),
    operatingSystem: Object.freeze(other),
    capabilitiesReadyForBinding: Object.freeze({
      accessibleDrives: host.drives.length,
      discoveredExecutables: host.programs.length,
      detectedApplications: other.installedApplications.length,
      detectedServices: other.services.length,
      detectedDeviceClasses: Object.keys(other.deviceClasses).length
    }),
    readOnlyDiscoveryComplete: true,
    machineFullyAccessible: false,
    operatingSystemPermissionsRequired: true,
    applicationsAutomaticallyExecuted: false,
    dataUploaded: false, userFilesScanned: false,
    networkRoutesChanged: false, physicalGlobalConnectivityVerified: false
  });
  if (Buffer.byteLength(JSON.stringify(catalog)) > MAX_REPORT_BYTES) {
    throw new Error('Host inventory exceeds bounded local manifest size');
  }
  return catalog;
}

export async function persistLocalAssimilation(catalog, directory = join(homedir(), '.sdpn')) {
  if (!catalog || catalog.schema !== 'kindred.sdpn.machine-assimilation.v1') {
    throw new Error('Validated local assimilation report required');
  }
  const dir = resolve(directory);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const dest = join(dir, 'machine-capabilities.v1.json');
  const tmp = dest + '.' + randomUUID() + '.tmp';
  const payload = JSON.stringify(catalog, null, 2) + '\n';
  if (Buffer.byteLength(payload) > MAX_REPORT_BYTES) throw new Error('Oversized host inventory');
  try {
    const handle = await open(tmp, 'wx', 0o600);
    try { await handle.writeFile(payload, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(tmp, dest);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  const sha256 = createHash('sha256').update(payload).digest('hex');
  // This file is PRIVATE, stored on the device, and is not an SDPN global directory.
  return Object.freeze({ path: dest, sha256,
    savedLocally: true, uploaded: false, routesChanged: false });
}
