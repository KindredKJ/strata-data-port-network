import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortIdentity } from '../src/native-port-identity.mjs';
import { createFounderPortZero, assignNumberedPort, revokeNumberedPort } from '../src/numbered-port-registry.mjs';
import { signPortLocalRole, verifyPortLocalRole, authorizePortLocalAction } from '../src/port-local-roles.mjs';
import { inspectHostNativeHardware, supportedDirectSubstrates,
  inspectDirectDrivers, connectDirectPeer } from '../src/native-hardware-adapters.mjs';

const now = 1_800_000_000_000;
const founder = createPortIdentity({ testSeed: Buffer.alloc(32, 31) });
const alice = createPortIdentity({ testSeed: Buffer.alloc(32, 32) });
const bob = createPortIdentity({ testSeed: Buffer.alloc(32, 33) });
function registry() {
  return assignNumberedPort(founder,
    assignNumberedPort(founder, createFounderPortZero(founder, now), alice.publicKey, now + 1),
    bob.publicKey, now + 2);
}

test('Port 0 is only founder; admin role is scoped to own port and never cross-port', () => {
  const r = registry();
  const regular = signPortLocalRole(alice, r, founder.id, 1, 'regular', { now: now + 3 });
  const admin = signPortLocalRole(bob, r, founder.id, 2, 'admin', { now: now + 3 });
  assert.equal(verifyPortLocalRole(regular, r, founder.id, now + 4).founderAuthority, false);
  assert.equal(verifyPortLocalRole(admin, r, founder.id, now + 4).crossPortAuthority, false);
  assert.equal(authorizePortLocalAction(admin, r, founder.id,
    { targetNumber: 2, action: 'adapter.configure', now: now + 4 }).authorized, true);
  assert.equal(authorizePortLocalAction(regular, r, founder.id,
    { targetNumber: 1, action: 'state.read', now: now + 4 }).authorized, true);
  assert.throws(() => authorizePortLocalAction(regular, r, founder.id,
    { targetNumber: 1, action: 'adapter.configure', now: now + 4 }), /denied/);
  assert.throws(() => authorizePortLocalAction(admin, r, founder.id,
    { targetNumber: 1, action: 'adapter.configure', now: now + 4 }), /denied/);
  assert.throws(() => authorizePortLocalAction(admin, r, founder.id,
    { targetNumber: 0, action: 'local.policy.manage', now: now + 4 }), /denied/);
  assert.throws(() => signPortLocalRole(founder, r, founder.id, 0, 'admin',
    { now: now + 3 }), /founder-exclusive/);
  assert.throws(() => signPortLocalRole(bob, r, founder.id, 1, 'admin',
    { now: now + 3 }), /not bound/);
  const revoked = revokeNumberedPort(founder, r, 2, now + 5);
  assert.throws(() => verifyPortLocalRole(admin, revoked, founder.id, now + 6),
    /not bound/);
});

test('hardware probe never imports interface IPs, routing tables or host addresses', () => {
  const report = inspectHostNativeHardware({
    platform: 'test',
    interfaces: { 'Wi-Fi': [{ address: '192.0.2.99', gateway: '192.0.2.1' }] },
    bluetoothDevices: ['hci0'], usbDevices: [], serialDevices: []
  });
  assert.equal(report.candidates.wifi, true);
  assert.equal(report.candidates.bluetooth, true);
  assert.equal(report.peerDirectnessVerified, false);
  assert.equal(report.globalConnectivityVerified, false);
  assert.equal(JSON.stringify(report).includes('192.0.2.'), false);
  assert.ok(supportedDirectSubstrates().includes('BLE_GATT_DIRECT'));
});

test('direct hardware drivers are negotiated without any IP/routed fallback', async () => {
  const hardware = inspectHostNativeHardware({
    platform: 'test', interfaces: {}, bluetoothDevices: ['hci0'], usbDevices: [], serialDevices: []
  });
  let transmitted = 0;
  const link = {
    async sendFrame(bytes) { transmitted += bytes.byteLength; return bytes.byteLength; },
    async receiveFrame() { return Buffer.from('control-message'); },
    async close() {}
  };
  const driver = {
    id: 'example.ble-direct', substrate: 'BLE_GATT_DIRECT',
    underlyingIp: false, underlyingRouting: false,
    forwardsOtherPeers: false, directPeer: true,
    async probe() { return { available: true, permissionGranted: true }; },
    async connect({ peerPortId }) {
      assert.equal(peerPortId, bob.id);
      return link;
    }
  };
  const result = await connectDirectPeer({ peerPortId: bob.id,
    drivers: [driver], hardware });
  assert.equal(result.adapter.underlyingRouting, false);
  assert.equal(result.independentPhysicalRoutingAuditPassed, false);
  await result.link.sendFrame(Buffer.from('control'));
  assert.equal(transmitted, 7);
  await result.link.close();

  const routed = { ...driver, id: 'example.ethernet-routed', underlyingRouting: true };
  await assert.rejects(() => inspectDirectDrivers([routed], hardware), /non-routed direct/);
  const noPermission = { ...driver, id: 'example.permission-denied',
    async probe() { return { available: true, permissionGranted: false }; } };
  assert.equal((await inspectDirectDrivers([noPermission], hardware))[0].readyForPeerAttempt, false);
  await assert.rejects(() => connectDirectPeer({
    peerPortId: bob.id, drivers: [noPermission], hardware
  }), /No usable/);
});
