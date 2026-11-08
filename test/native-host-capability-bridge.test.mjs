import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortIdentity } from '../src/native-port-identity.mjs';
import { createFounderPortZero, assignNumberedPort, revokeNumberedPort } from '../src/numbered-port-registry.mjs';
import { signPortLocalRole } from '../src/port-local-roles.mjs';
import { NativeHostCapabilityBridge } from '../src/native-host-capability-bridge.mjs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { realpath } from 'node:fs/promises';

const founder = createPortIdentity({ testSeed: Buffer.alloc(32, 41) });
const local = createPortIdentity({ testSeed: Buffer.alloc(32, 42) });
const other = createPortIdentity({ testSeed: Buffer.alloc(32, 43) });
const registry = assignNumberedPort(founder,
  assignNumberedPort(founder, createFounderPortZero(founder, 1000), local.publicKey, 1001),
  other.publicKey, 1002);

function runtime(extra = {}, events = registry) {
  return new NativeHostCapabilityBridge({
    events, founderPortId: founder.id, portNumber: 1,
    programPaths: [dirname(process.execPath)],
    volumePaths: [tmpdir(), join(tmpdir(), 'sdpn-inaccessible-volume-should-not-exist')],
    ...extra
  });
}
function localGrant(identity = local, events = registry, role = 'admin') {
  return signPortLocalRole(identity, events, founder.id, identity === other ? 2 : 1,
    role, { now: Date.now(), ttlMs: 120000 });
}

test('native port discovers real accessible disks and host binaries without executing them', async () => {
  const bridge = runtime();
  const snapshot = await bridge.discover();
  assert.equal(snapshot.portNumber, 1);
  assert.equal(snapshot.platform, process.platform);
  assert.equal(snapshot.hardware.platform, process.platform);
  assert.equal(snapshot.drives.length, 1);
  assert.equal(snapshot.drives[0].accessible, true);
  assert.equal(snapshot.drives[0].writable, false);
  assert.ok(snapshot.drives[0].bytesTotal > 0);
  assert.equal(snapshot.programExecutionEnabledAutomatically, false);
  assert.equal(snapshot.hardwareDriverBindingsVerified, false);
  assert.equal(snapshot.appInventoryExhaustive, false);
  assert.equal(snapshot.hostRoutesChanged, false);
  assert.equal(snapshot.globalConnectivityVerified, false);
  assert.ok(snapshot.programs.every(p => p.runnableByOS === true &&
    p.networkBehaviorVerified === false));
  const executablePath = await realpath(process.execPath);
  assert.ok(snapshot.programs.some(p => p.executablePath === executablePath));
});

test('local port grants and explicit program allowlist are required to run installed utility', async () => {
  const probe = runtime();
  const catalog = await probe.discover();
  const executable = await realpath(process.execPath);
  const program = catalog.programs.find(x => x.executablePath === executable);
  assert.ok(program);
  const denied = runtime();
  await denied.discover();
  await assert.rejects(denied.invoke({
    programId: program.id, grant: localGrant(), args: ['-e', 'process.stdout.write("NOPE")']
  }), /allowlisted/);
  const bridge = runtime({ allowedProgramIds: [program.id] });
  await bridge.discover();
  await assert.rejects(bridge.invoke({
    programId: program.id, grant: localGrant(local, registry, 'regular'),
    args: ['--version']
  }), /authorization denied/);
  const result = await bridge.invoke({
    programId: program.id, grant: localGrant(),
    args: ['-e', 'process.stdout.write("SDPN_NATIVE_HOST_OK")'],
    timeoutMs: 5000
  });
  assert.equal(result.stdout, 'SDPN_NATIVE_HOST_OK');
  assert.equal(result.succeeded, true);
  assert.equal(result.usedSdpnTransport, false);
  assert.equal(result.noRoutingGuaranteedForExecutedProgram, false);
  assert.equal(result.hostRoutingTableModifiedByBridge, false);
});

test('a regular/admin credential from a different port cannot run our utilities', async () => {
  const catalog = await runtime().discover();
  const program = catalog.programs.find(p => p.executablePath);
  assert.ok(program);
  const bridge = runtime({ allowedProgramIds: [program.id] });
  await bridge.discover();
  await assert.rejects(bridge.invoke({
    programId: program.id, grant: localGrant(other), args: ['--version']
  }), /not bound|authorization denied/);
  const revoked = revokeNumberedPort(founder, registry, 1, Date.now());
  const disabled = runtime({ allowedProgramIds: [program.id] }, revoked);
  await disabled.discover();
  await assert.rejects(disabled.invoke({
    programId: program.id, grant: localGrant(), args: ['--version']
  }), /not bound/);
});

test('arguments, timeout and unknown programs are rejected without shell execution', async () => {
  const c = await runtime().discover();
  const program = c.programs.find(x => x.executablePath);
  const bridge = runtime({ allowedProgramIds: [program.id] });
  await bridge.discover();
  for (const args of [[123], ['bad\0arg'], Array(33).fill('x')]) {
    await assert.rejects(bridge.invoke({ programId: program.id,
      grant: localGrant(), args }), /argument/);
  }
  await assert.rejects(bridge.invoke({ programId: program.id,
    grant: localGrant(), timeoutMs: 999999 }), /timeout/);
  await assert.rejects(bridge.invoke({ programId: 'host:program:' + 'a'.repeat(32),
    grant: localGrant() }), /allowlisted/);
});
