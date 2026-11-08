// Kindred Labs SDPN: discover host interfaces, use only explicitly direct, non-routed drivers.
// This is a software capability and driver-selection boundary, not a global physical carrier.
import { networkInterfaces, platform as systemPlatform } from 'node:os';
import { readdirSync } from 'node:fs';

const ALLOWED = Object.freeze(new Set([
  'BLUETOOTH_L2CAP_DIRECT', 'BLE_GATT_DIRECT', 'WIFI_AWARE_DIRECT',
  'WIFI_DIRECT_P2P', 'USB_PEER_DIRECT', 'NFC_PEER_DIRECT',
  'RAW_ETHERNET_DIRECT', 'SERIAL_PEER_DIRECT', 'LOCAL_OS_PIPE'
]));
const NATIVE_SUBSTRATES = Object.freeze([...ALLOWED]);
const INTERFACE_NAME_LIMIT = 128;

function safeList(path) {
  try { return readdirSync(path).filter(name => /^[a-zA-Z0-9_.:-]{1,128}$/.test(name)); }
  catch { return []; }
}
function normalizedName(name) {
  return typeof name === 'string' && name.length <= INTERFACE_NAME_LIMIT ?
    name : String(name).slice(0, INTERFACE_NAME_LIMIT);
}

// Hardware names are hints only. Wi-Fi association, IP stack presence, and
// detection of a Bluetooth adapter do not prove a native peer API is usable.
export function inspectHostNativeHardware({
  platform = systemPlatform(), interfaces = networkInterfaces(),
  bluetoothDevices = safeList('/sys/class/bluetooth'),
  usbDevices = safeList('/sys/bus/usb/devices'),
  serialDevices = safeList('/dev')
} = {}) {
  if (typeof platform !== 'string' || !interfaces || typeof interfaces !== 'object' ||
      !Array.isArray(bluetoothDevices) || !Array.isArray(usbDevices) || !Array.isArray(serialDevices)) {
    throw new Error('Invalid host hardware probe');
  }
  // Enumerate interface NAMES only; do not copy IP addresses, default gateways,
  // DNS, routing tables, or interface MAC addresses into SDPN identity.
  const names = Object.keys(interfaces).map(normalizedName).sort();
  const wifi = names.some(n => /wi.?fi|wlan|wlp|wireless|p2p/i.test(n));
  const bluetooth = bluetoothDevices.some(n => /^hci\d+$/.test(n)) ||
    names.some(n => /bluetooth|bnep/i.test(n));
  const usb = usbDevices.some(n => !['usb0', 'usb1', 'usb2', 'usb3'].includes(n)) ||
    names.some(n => /usb|rndis/i.test(n));
  const serial = serialDevices.some(n => /^tty(?:ACM|USB|S)\d+$/.test(n));
  return Object.freeze({
    schema: 'kindred.sdpn.native-host-probe.v1', platform,
    interfaceNames: Object.freeze(names),
    candidates: Object.freeze({
      wifi, bluetooth, usb, serial,
      localOsPipe: true
    }),
    examinedIpAddresses: false,
    ipRoutesConfigured: false,
    peerDirectnessVerified: false,
    usableNativeDriversVerified: false,
    globalConnectivityVerified: false
  });
}

function validateDriver(d) {
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' ||
      !/^[a-z][a-z0-9.-]{0,63}$/.test(d.id) || !ALLOWED.has(d.substrate) ||
      d.underlyingIp !== false || d.underlyingRouting !== false ||
      d.forwardsOtherPeers !== false || d.directPeer !== true ||
      typeof d.probe !== 'function' || typeof d.connect !== 'function') {
    throw new Error('Non-routed direct hardware driver contract required');
  }
  return d;
}
export function supportedDirectSubstrates() { return NATIVE_SUBSTRATES; }

// Probe all supplied OS-native drivers; adapters are NOT automatically made
// available by discovery. An operating system permission or driver may be absent.
export async function inspectDirectDrivers(drivers = [], hardware = inspectHostNativeHardware()) {
  if (!Array.isArray(drivers) || drivers.length > 64) throw new Error('Direct driver count exceeded');
  const ids = new Set();
  const results = [];
  for (const proposed of drivers) {
    const d = validateDriver(proposed);
    if (ids.has(d.id)) throw new Error('Duplicate direct driver ID');
    ids.add(d.id);
    let availability;
    try { availability = await d.probe(hardware); }
    catch (error) {
      results.push(Object.freeze({ id: d.id, substrate: d.substrate,
        available: false, permissionGranted: false, reason: 'OS_DRIVER_PROBE_ERROR' }));
      continue;
    }
    if (!availability || typeof availability.available !== 'boolean' ||
        typeof availability.permissionGranted !== 'boolean') {
      throw new Error('Direct driver probe must report availability and OS permissions');
    }
    const ready = availability.available && availability.permissionGranted;
    results.push(Object.freeze({
      id: d.id, substrate: d.substrate, available: availability.available,
      permissionGranted: availability.permissionGranted,
      readyForPeerAttempt: ready,
      routeFreeDriverDeclared: true,
      independentlyProvenRouteFree: false,
      reason: ready ? 'DIRECT_ADAPTER_READY_FOR_PEER_ATTEMPT' :
        !availability.available ? 'DIRECT_HARDWARE_UNAVAILABLE' : 'OS_PERMISSION_REQUIRED'
    }));
  }
  return Object.freeze(results);
}

export async function connectDirectPeer({
  peerPortId, drivers, hardware = inspectHostNativeHardware()
}) {
  if (typeof peerPortId !== 'string' || !/^strata:port:ed25519:[a-f0-9]{64}$/.test(peerPortId)) {
    throw new Error('Cryptographic destination Port ID required');
  }
  if (!Array.isArray(drivers)) throw new Error('Direct driver list required');
  const probes = await inspectDirectDrivers(drivers, hardware);
  for (const candidate of probes) {
    if (!candidate.readyForPeerAttempt) continue;
    const driver = drivers.find(d => d.id === candidate.id);
    let link;
    try { link = await driver.connect({ peerPortId, hardware }); }
    catch { continue; }  // Keep trying other genuinely direct hardware interfaces.
    if (!link || typeof link.sendFrame !== 'function' ||
        typeof link.receiveFrame !== 'function' || typeof link.close !== 'function') {
      await link?.close?.();
      throw new Error('Native peer driver did not return a bidirectional link');
    }
    return Object.freeze({
      peerPortId, driverId: candidate.id, substrate: candidate.substrate,
      link,
      adapter: Object.freeze({ id: driver.id, substrate: driver.substrate,
        underlyingIp: false, underlyingRouting: false }),
      ipRoutingUsedByDeclaredAdapter: false,
      independentPhysicalRoutingAuditPassed: false,
      globalConnectivityVerified: false
    });
  }
  throw new Error('No usable directly connected, non-routed peer hardware driver');
}
