import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = "mobile/android/app/src/main/";
function read(path) { return readFileSync(join(process.cwd(), root, path), "utf8"); }

test("four-cloud vector resources have consistent progressive illuminated signals", () => {
  for (let level = 0; level <= 4; level++) {
    const pct = level * 25;
    const xml = read("res/drawable/sdpn_cloud_" + pct + ".xml");
    assert.match(xml, /<vector\b/);
    assert.equal((xml.match(/<group\b/g) || []).length, 4);
    assert.equal((xml.match(/<path\b/g) || []).length, 4);
    assert.equal((xml.match(/android:fillColor="#FFFFFFFF"/g) || []).length, level);
    assert.equal((xml.match(/android:fillColor="#00000000"/g) || []).length, 4 - level);
  }
});

test("native cloud signal requires live non-IP bidirectional materialization", () => {
  const quality = read("java/ai/kindredlabs/sdpn/mobile/CloudSignal.kt");
  const tile = read("java/ai/kindredlabs/sdpn/mobile/StrataNetworkTileService.kt");
  const vpn = read("java/ai/kindredlabs/sdpn/mobile/StrataVpnService.kt");
  const manifest = read("AndroidManifest.xml");
  assert.match(quality, /routeForwardingVerified/);
  assert.match(quality, /authenticated/);
  assert.match(quality, /nativeLevel/);
  assert.match(quality, /sample\.usesIp \|\| sample\.usesRouting/);
  assert.match(quality, /currentNativeHealth\(\): CloudSignal\.NativeMaterializationHealth\? = null/);
  assert.match(quality, /currentGatewayHealth\(\): CloudSignal\.GatewayHealth\? = null/);
  assert.match(tile, /CloudSignal\.nativeLevel\(/);
  assert.match(tile, /CloudSignal\.iconResource\(level\)/);
  assert.match(manifest, /android:icon="@drawable\/sdpn_cloud_0"/);
  assert.match(manifest, /VpnService\.SUPPORTS_ALWAYS_ON/);
  assert.match(manifest, /android:value="false"/);
  const withoutComments = vpn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(withoutComments, /\.establish\s*\(/);
});
