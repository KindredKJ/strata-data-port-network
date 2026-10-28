#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { verifyCrossProviderRecoveryEnvelope } from "../src/external-proof-v1.mjs";

function required(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`--${name} is required`);
  return process.argv[i + 1];
}

const envelopePath = required("envelope");
const keyPath = process.argv.includes("--public-key")
  ? required("public-key")
  : new URL("../public/proof-public-key.pem", import.meta.url);

const envelope = JSON.parse(await readFile(envelopePath, "utf8"));
const pem = await readFile(keyPath, "utf8");
const trustedPublicKeySpkiBase64 = pem
  .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");

const result = verifyCrossProviderRecoveryEnvelope({
  envelope,
  trustedPublicKeySpkiBase64
});

const r = envelope.recovery;
const checks = [
  ["SIGNATURE", result.verified === true],
  ["CAPSULE HASH", result.capsuleSha256 === r.capsuleSha256],
  ["INPUT HASH", result.recoveredInputHash === r.recoveredInputHash],
  ["OUTPUT HASH", result.outputHash === r.outputHash],
  ["DISTINCT NODE", r.recoveryNodeId !== r.originalSourceNodeId],
  ["NO AUTO FAILOVER CLAIM", r.claims?.automaticFailoverProven === false],
  ["NO ABRUPT CLAIM", r.claims?.abruptTerminationRecoveryProven === false],
  ["NO PHYSICAL CLAIM", r.claims?.physicalMachineAttestationProven === false],
  ["NO PRODUCTION CLAIM", r.claims?.productionReadyClaim === false]
];

let failures = 0;
for (const [name, ok] of checks) {
  console.log(String(name).padEnd(28, "."), ok ? "PASS" : "FAIL");
  if (!ok) failures += 1;
}
console.log("");
console.log("recoveryId:", result.recoveryId);
console.log("capsuleSha256:", result.capsuleSha256);
console.log("originalSourceNodeId:", r.originalSourceNodeId);
console.log("recoveryNodeId:", r.recoveryNodeId);
console.log("outputHash:", result.outputHash);
console.log("keyId:", result.keyId);

if (failures) process.exitCode = 1;
