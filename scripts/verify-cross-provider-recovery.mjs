#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalBytes,
  sha256,
  verifyCrossProviderRecoveryEnvelope
} from "../src/external-proof-v1.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

const envelopePath = required("envelope");
const keyPath = resolve(arg("public-key") ?? fileURLToPath(new URL("../public/proof-public-key.pem", import.meta.url)));
const expectedEvidencePath = resolve(
  arg("expected-evidence") ?? fileURLToPath(new URL("../examples/external-proof-v1/recovery-001/recovery.summary.json", import.meta.url))
);

const [envelopeText, pem, evidenceText] = await Promise.all([
  readFile(envelopePath, "utf8"),
  readFile(keyPath, "utf8"),
  readFile(expectedEvidencePath, "utf8")
]);
const envelope = JSON.parse(envelopeText);
const expected = JSON.parse(evidenceText);
const trustedPublicKeySpkiBase64 = pem
  .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");
const r = envelope?.recovery;

if (expected?.schemaVersion !== "kindred.external-proof.recovery-evidence.v1") {
  throw new Error("expected evidence schema mismatch");
}
if (!r || typeof r !== "object") throw new Error("recovery record is missing");
if (!r.output || typeof r.output !== "object" || Array.isArray(r.output)) {
  throw new Error("recovery output must be an object");
}
if (r.operation !== "HASH_TEXT") throw new Error("unexpected recovery operation");
if (!isSha256(r.output.sha256) || !Number.isSafeInteger(r.output.utf8Bytes) || r.output.utf8Bytes < 0) {
  throw new Error("HASH_TEXT output fields are invalid");
}

const result = verifyCrossProviderRecoveryEnvelope({
  envelope,
  trustedPublicKeySpkiBase64
});

const independentlyComputedOutputHash = sha256(canonicalBytes(r.output));
const checks = [
  ["SIGNATURE", result.verified === true],
  ["PINNED KEY", envelope.publicKeySpkiBase64 === trustedPublicKeySpkiBase64],
  ["RECOVERY ID", r.recoveryId === expected.recoveryId],
  ["CAPSULE HASH", isSha256(expected.capsuleSha256) && r.capsuleSha256 === expected.capsuleSha256],
  ["INPUT HASH", isSha256(expected.validatedInputHash) && r.recoveredInputHash === expected.validatedInputHash && r.recoveredInputHash === expected.recoveredInputHash],
  ["OUTPUT HASH", isSha256(r.outputHash) && independentlyComputedOutputHash === r.outputHash],
  ["ORIGINAL SOURCE", r.originalSourceNodeId === expected.sourceNodeId],
  ["ORIGINAL BOOT", r.originalSourceBootId === expected.checkpointBootId],
  ["CHECKPOINT TIME", r.checkpointedAt === expected.checkpointedAt],
  ["RECOVERY NODE", r.recoveryNodeId === "strata-vercel-recovery-node-c"],
  ["DISTINCT NODE", r.recoveryNodeId !== r.originalSourceNodeId],
  ["PROVIDER", r.execution?.provider === "vercel"],
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
console.log(`checks: ${checks.length - failures}/${checks.length} PASS`);
console.log("recoveryId:", r.recoveryId);
console.log("capsuleSha256:", r.capsuleSha256);
console.log("recoveredInputHash:", r.recoveredInputHash);
console.log("outputHash:", independentlyComputedOutputHash);
console.log("originalSourceNodeId:", r.originalSourceNodeId);
console.log("recoveryNodeId:", r.recoveryNodeId);
console.log("deploymentId:", r.execution?.deploymentId);
console.log("commitSha:", r.execution?.commitSha);
console.log("keyId:", envelope.keyId);

if (failures) process.exitCode = 1;
