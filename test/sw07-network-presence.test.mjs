import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
test("Android VPN service is declared with system-only bind permission", () => {
  const manifest = read("mobile/android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android:name="\.StrataVpnService"/);
  assert.match(manifest, /android:permission="android\.permission\.BIND_VPN_SERVICE"/);
  assert.match(manifest, /android\.net\.VpnService/);
  assert.match(manifest, /android\.net\.VpnService\.SUPPORTS_ALWAYS_ON/);
  assert.match(manifest, /android:value="false"/);
});
test("SW07 system VPN integration explicitly refuses premature packet routing", () => {
  const vpn = read("mobile/android/app/src/main/java/ai/kindredlabs/sdpn/mobile/StrataVpnService.kt");
  assert.match(vpn, /VpnService/);
  assert.match(vpn, /START_NOT_STICKY/);
  const executable = vpn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(executable, /Builder\s*\(\s*\)/);
  assert.doesNotMatch(executable, /\.establish\s*\(/);
});
test("stock OS Wi-Fi discovery requires an actual access point, not a fake SSID", () => {
  const design = read("docs/SW07-NATIVE-NETWORK-PRESENCE.md");
  assert.match(design, /actually broadcast/);
  assert.match(design, /SSID/);
  assert.match(design, /IP-packet VPN gateway/);
});
