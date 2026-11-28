#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { verifyExternalProofEnvelope } from "../src/external-proof-v1.mjs";

function required(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`--${name} is required`);
  return process.argv[i + 1];
}

const receiptPath = required("receipt");
const keyPath = process.argv.includes("--public-key")
  ? required("public-key")
  : new URL("../public/proof-public-key.pem", import.meta.url);

const envelope = JSON.parse(await readFile(receiptPath, "utf8"));
const pem = await readFile(keyPath, "utf8");
const trustedPublicKeySpkiBase64 = pem
  .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");

const result = verifyExternalProofEnvelope({ envelope, trustedPublicKeySpkiBase64 });

const checks = [
  ["SCHEMA", envelope.receipt?.schemaVersion === "kindred.external-proof.receipt.v1"],
  ["SIGNATURE", result.verified === true],
  ["KEY ID", result.keyId === envelope.keyId],
  ["STATE HASH", envelope.receipt?.stateHash === envelope.receipt?.payloadSha256],
  ["RECEIVED HASH", envelope.receipt?.receivedSha256 === envelope.receipt?.payloadSha256],
  ["AUTHENTICATION", envelope.receipt?.transport?.authenticationVerified === true],
  ["INTEGRITY", envelope.receipt?.transport?.integrityVerified === true],
  ["EXTERNAL RUNTIME", envelope.receipt?.claims?.externalRuntime === true],
  ["NO PHYSICAL CLAIM", envelope.receipt?.claims?.physicalMachineAttestationProven === false],
  ["NO PRODUCTION CLAIM", envelope.receipt?.claims?.productionReadyClaim === false]
];

let failed = 0;
for (const [name, ok] of checks) {
  process.stdout.write(`${name.padEnd(20, ".")} ${ok ? "PASS" : "FAIL"}\n`);
  if (!ok) failed += 1;
}

process.stdout.write(`\nchallengeId: ${result.challengeId}\n`);
process.stdout.write(`stateHash:   ${result.stateHash}\n`);
process.stdout.write(`keyId:       ${result.keyId}\n`);

if (failed) process.exitCode = 1;
