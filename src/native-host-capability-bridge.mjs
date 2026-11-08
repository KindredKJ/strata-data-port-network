// Kindred Labs SDPN — native per-port host capability bridge.
// Read-only discovery never installs drivers, mounts disks, changes routes or launches programs.
// Program execution requires an independently scoped local-admin grant and explicit executable allowlist.
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { platform as osPlatform, homedir, arch, cpus, totalmem } from 'node:os';
import { readdir, realpath, stat, statfs, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve, join, delimiter, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectHostNativeHardware } from './native-hardware-adapters.mjs';
import { authorizePortLocalAction } from './port-local-roles.mjs';

const execFile = promisify(execFileCallback);
const MAX_PROGRAMS = 768;
const MAX_ROOTS = 80;
const MAX_APP_OUTPUT = 128 * 1024;
const BINARY_FILE = /\.(?:exe|com)$/i;
const capabilityId = file => 'host:program:' + createHash('sha256').update(file).digest('hex').slice(0, 32);

function boundedStrings(values, max = 100) {
  if (!Array.isArray(values) || values.length > max ||
      values.some(x => typeof x !== 'string' || x.length < 1 || x.length > 4096)) {
    throw new Error('Invalid host capability path list');
  }
  return [...new Set(values.map(value => resolve(value)))];
}
function mountedSource(path, platform) {
  if (platform === 'win32') return /^[A-Z]:\\$/i.test(path);
  return path === '/' || path.startsWith('/mnt/') ||
    path.startsWith('/media/') || path.startsWith('/run/media/') ||
    path.startsWith('/Volumes/') || path.startsWith('/storage/');
}
async function volumeRoots(platform, env) {
  if (platform === 'win32') {
    // Read the real Windows volume table, not PowerShell's potentially stale working location.
    const script = '$ErrorActionPreference="Stop"; @(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 -or $_.DriveType -eq 3 } | Select-Object -ExpandProperty DeviceID) | ConvertTo-Json -Compress';
    for (const program of ['pwsh.exe', 'powershell.exe']) {
      try {
        const { stdout } = await execFile(program, [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script
        ], { windowsHide: true, timeout: 8000, maxBuffer: 32768 });
        const drives = JSON.parse(stdout.trim());
        const names = (Array.isArray(drives) ? drives : [drives]).filter(x => /^[A-Z]:$/i.test(x));
        if (names.length > 0) return names.map(x => x + '\\');
      } catch { /* Explicitly report incomplete inventory if OS provider is unavailable. */ }
    }
    return [];
  }
  if (platform === 'darwin') {
    try {
      const { stdout } = await execFile('/bin/df', ['-P'], { timeout: 5000, maxBuffer: 128 * 1024 });
      return stdout.split('\n').slice(1).map(line => line.trim().split(/\s+/).at(-1))
        .filter(x => typeof x === 'string' && x.startsWith('/') && mountedSource(x, platform));
    } catch { return ['/']; }
  }
  if (platform === 'linux' || platform === 'android') {
    try {
      const content = await import('node:fs/promises').then(fs => fs.readFile('/proc/mounts', 'utf8'));
      return content.split('\n').filter(Boolean)
        .map(line => line.split(' ')[1]?.replace(/\\040/g, ' '))
        .filter(x => x && mountedSource(x, platform))
        .concat('/');
    } catch { return ['/']; }
  }
  return [resolve(env.HOME || homedir())];
}
async function inspectDrive(path) {
  try {
    const absolute = await realpath(path);
    const info = await stat(absolute);
    if (!info.isDirectory()) return null;
    const fs = await statfs(absolute);
    return Object.freeze({
      root: absolute, accessible: true, bytesTotal: fs.blocks * fs.bsize,
      bytesAvailable: fs.bavail * fs.bsize,
      writable: false, // Discovery cannot establish a durable write grant.
      mountModified: false
    });
  } catch { return null; }
}
async function probePrograms(paths, platform) {
  const found = new Map();
  for (const directory of paths) {
    let items;
    try { items = (await readdir(directory)).sort().slice(0, 2048); }
    catch { continue; }
    for (const name of items) {
      if (found.size >= MAX_PROGRAMS) break;
      if (platform === 'win32' && !BINARY_FILE.test(name)) continue;
      const candidate = join(directory, name);
      try {
        const finalPath = await realpath(candidate);
        const info = await stat(finalPath);
        if (!info.isFile() || (platform !== 'win32' && (info.mode & 0o111) === 0)) continue;
        if (platform === 'win32' && !BINARY_FILE.test(finalPath)) continue;
        if (platform !== 'win32') await access(finalPath, fsConstants.X_OK);
        const id = capabilityId(finalPath);
        found.set(id, Object.freeze({
          id, name: basename(finalPath), executablePath: finalPath,
          origin: 'INSTALLED_OS_BINARY', discovered: true, runnableByOS: true,
          executablePermissionObserved: true, applicationServiceIntegrationVerified: false,
          networkBehaviorVerified: false, routeFreeExecutionProven: false
        }));
      } catch { /* Not an accessible executable. */ }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
function envSubset(env, platform) {
  const approved = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'HOME',
    'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'COMSPEC'];
  const result = {};
  for (const key of approved) if (typeof env[key] === 'string') result[key] = env[key];
  if (platform === 'win32' && !result.SystemRoot && !result.WINDIR) {
    throw new Error('Windows runtime environment lacks SystemRoot');
  }
  return result;
}
// Installer/bootstrap use: inspect the current machine WITHOUT generating a fake
// Port 0 identity, joining a network, or executing a detected application.
export async function inspectInstalledHost({
  platform = osPlatform(), env = process.env, programPaths, volumePaths
} = {}) {
  const searchPath = platform === 'win32' ? ';' : delimiter;
  const directories = programPaths === undefined ?
    boundedStrings((env.PATH || env.Path || '').split(searchPath).filter(Boolean).slice(0, 64), 64) :
    boundedStrings(programPaths, 64);
  const discoveredRoots = volumePaths === undefined ?
    await volumeRoots(platform, env) : boundedStrings(volumePaths, MAX_ROOTS);
  const drives = [];
  for (const root of boundedStrings(discoveredRoots.slice(0, MAX_ROOTS), MAX_ROOTS)) {
    const drive = await inspectDrive(root);
    if (drive) drives.push(drive);
  }
  const programs = await probePrograms(directories, platform);
  return Object.freeze({
    schema: 'kindred.sdpn.native-host-capabilities.v1',
    platform, arch: arch(), cpuThreads: cpus().length,
    totalMemoryBytes: totalmem(),
    drives: Object.freeze(drives), programs: Object.freeze(programs),
    hardware: inspectHostNativeHardware({ platform }),
    appInventoryExhaustive: false,
    hardwareDriverBindingsVerified: false,
    installedProgramCountObserved: programs.length,
    programExecutionEnabledAutomatically: false,
    hostRoutesChanged: false, remoteControlEnabled: false,
    globalConnectivityVerified: false
  });
}

export class NativeHostCapabilityBridge {
  #registry; #founder; #portNumber; #grantedPrograms; #catalog = new Map();
  #platform; #env; #programPaths; #volumePaths;
  constructor({
    events, founderPortId, portNumber, allowedProgramIds = [],
    platform = osPlatform(), env = process.env,
    programPaths, volumePaths
  }) {
    if (!Array.isArray(events) || typeof founderPortId !== 'string' ||
        !Number.isSafeInteger(portNumber) || portNumber < 1 ||
        !Array.isArray(allowedProgramIds) || allowedProgramIds.length > MAX_PROGRAMS ||
        allowedProgramIds.some(x => typeof x !== 'string' || !/^host:program:[a-f0-9]{32}$/.test(x))) {
      throw new Error('Explicit nonfounder port and local executable allowlist required');
    }
    this.#registry = events; this.#founder = founderPortId; this.#portNumber = portNumber;
    this.#grantedPrograms = new Set(allowedProgramIds);
    this.#platform = platform; this.#env = env;
    const searchPath = platform === 'win32' ? ';' : delimiter;
    this.#programPaths = programPaths === undefined ?
      boundedStrings((env.PATH || env.Path || '').split(searchPath).filter(Boolean).slice(0, 64), 64) :
      boundedStrings(programPaths, 64);
    this.#volumePaths = volumePaths === undefined ? null : boundedStrings(volumePaths, MAX_ROOTS);
  }

  async discover() {
    const snapshot = await inspectInstalledHost({
      platform: this.#platform, env: this.#env,
      programPaths: this.#programPaths,
      volumePaths: this.#volumePaths === null ? undefined : this.#volumePaths
    });
    this.#catalog = new Map(snapshot.programs.map(program => [program.id, program]));
    return Object.freeze({ ...snapshot, portNumber: this.#portNumber });
  }

  // Only operate a program explicitly selected from the just-discovered catalog
  // and explicitly authorized for THIS port. No shell, no elevation, no network
  // transport, no arbitrary executable path supplied by the requesting worker.
  async invoke({ programId, args = [], grant, timeoutMs = 10_000 }) {
    authorizePortLocalAction(grant, this.#registry, this.#founder, {
      targetNumber: this.#portNumber, action: 'utility.invoke'
    });
    const program = this.#catalog.get(programId);
    if (!program || !this.#grantedPrograms.has(programId)) {
      throw new Error('Local program not discovered or allowlisted');
    }
    if (!Array.isArray(args) || args.length > 32 ||
        args.some(a => typeof a !== 'string' || a.length > 4096 || a.includes('\0')) ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
      throw new Error('Local program argument or timeout bounds rejected');
    }
    const activePath = await realpath(program.executablePath);
    const info = await stat(activePath);
    if (!info.isFile() || capabilityId(activePath) !== programId) {
      throw new Error('Local program executable changed since discovery');
    }
    const { stdout, stderr } = await execFile(activePath, args, {
      shell: false, cwd: homedir(), timeout: timeoutMs,
      maxBuffer: MAX_APP_OUTPUT, windowsHide: true,
      env: envSubset(this.#env, this.#platform)
    });
    return Object.freeze({
      schema: 'kindred.sdpn.local-utility-result.v1',
      portNumber: this.#portNumber, programId,
      stdout, stderr, succeeded: true, usedSdpnTransport: false,
      noRoutingGuaranteedForExecutedProgram: false,
      hostRoutingTableModifiedByBridge: false
    });
  }
}
