#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { verifyExternalProofEnvelope } from "../src/external-proof-v1.mjs";

const DEFAULT_SOURCE = "https://kindred-external-proof-canary.onrender.com";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const source = arg("source", DEFAULT_SOURCE);
const text = arg("text", `Independent Kindred proof ${new Date().toISOString()}`);
if (!/^https:\/\//.test(source)) throw new Error("--source must be an HTTPS URL");

const pem = await readFile(new URL("../public/proof-public-key.pem", import.meta.url), "utf8");
const trustedPublicKeySpkiBase64 = pem
  .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");

console.log("KINDRED EXTERNAL PROOF — INDEPENDENT CLIENT");
console.log("source:", source);

const statusResponse = await fetch(`${source.replace(/\/$/, "")}/proof/status`, {
  headers: { "user-agent": "kindred-independent-verifier/1.0" },
  signal: AbortSignal.timeout(20_000)
});
const statusText = await statusResponse.text();
if (!statusResponse.ok) throw new Error(`source status HTTP ${statusResponse.status}: ${statusText.slice(0,500)}`);
const status = JSON.parse(statusText);
if (status.ready !== true) throw new Error("source proof runtime is not ready");
console.log("source ready:", status.ready);
console.log("source node:", status.sourceNodeId);

const started = performance.now();
const response = await fetch(`${source.replace(/\/$/, "")}/proof/jobs`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "user-agent": "kindred-independent-verifier/1.0"
  },
  body: JSON.stringify({
    operation: "HASH_TEXT",
    input: { text },
    clientRequestId: `independent-${Date.now()}`
  }),
  signal: AbortSignal.timeout(30_000)
});
const bodyText = await response.text();
if (!response.ok) throw new Error(`proof job HTTP ${response.status}: ${bodyText.slice(0,1000)}`);
const job = JSON.parse(bodyText);
const elapsedMs = performance.now() - started;

const verified = verifyExternalProofEnvelope({
  envelope: job.externalProof,
  trustedPublicKeySpkiBase64
});

const checks = [
  ["HTTP CREATED", response.status === 201],
  ["SOURCE VERIFIED SIGNATURE", job.verification?.strataSignatureVerified === true],
  ["SOURCE VERIFIED STATE", job.verification?.stateHashVerified === true],
  ["INDEPENDENT SIGNATURE", verified.verified === true],
  ["STATE HASH MATCH", verified.stateHash === job.stateHash],
  ["SOURCE NODE", job.externalProof?.receipt?.sourceNodeId === status.sourceNodeId],
  ["DISTINCT DESTINATION", job.externalProof?.receipt?.destinationNodeId !== status.sourceNodeId],
  ["NO PHYSICAL CLAIM", job.externalProof?.receipt?.claims?.physicalMachineAttestationProven === false],
  ["NO PRODUCTION CLAIM", job.externalProof?.receipt?.claims?.productionReadyClaim === false]
];

let failures = 0;
console.log("");
for (const [name, ok] of checks) {
  console.log(String(name).padEnd(28, "."), ok ? "PASS" : "FAIL");
  if (!ok) failures += 1;
}
console.log("");
console.log("elapsedMs:", elapsedMs.toFixed(3));
console.log("jobId:", job.jobId);
console.log("stateHash:", job.stateHash);
console.log("challengeId:", verified.challengeId);
console.log("keyId:", verified.keyId);
console.log("destination:", job.externalProof?.receipt?.destinationExecution?.provider ?? "unknown");
console.log("destinationCommit:", job.externalProof?.receipt?.destinationExecution?.commitSha ?? "unknown");

if (failures) process.exitCode = 1;
