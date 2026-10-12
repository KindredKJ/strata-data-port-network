#!/usr/bin/env node
/**
 * SW06-F bounded encrypted-transport benchmark.
 * Reuses the real proof protocol; never infers physical-machine attestation.
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sendTwoHostProof } from "../src/two-machine-proof.mjs";

const MIB = 1024 * 1024;
const VALID_SIZES = new Set([1, 4, 16]);

export function requirePrivateIpv4(host) {
  if (typeof host !== "string" || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    throw new Error("receiver host must be a literal private IPv4 address");
  }
  const parts = host.split(".").map(Number);
  if (parts.some((v, i) => v > 255 || String(v) !== host.split(".")[i])) {
    throw new Error("receiver host must be a canonical IPv4 address");
  }
  const [a, b] = parts;
  const isLoopback = a === 127;
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
  if (!isLoopback && !isPrivate) {
    throw new Error("receiver must be on RFC1918 private LAN; public routing is prohibited");
  }
  return { host, isLoopback };
}

export function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0 ||
      !Number.isFinite(fraction) || fraction <= 0 || fraction > 1 ||
      values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("percentile requires valid nonempty durations and a fraction in (0,1]");
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function boundedInteger(value, label, lower, upper) {
  if (!Number.isSafeInteger(value) || value < lower || value > upper) {
    throw new RangeError(label + " must be an integer between " + lower + " and " + upper);
  }
  return value;
}

export async function runSw06fBenchmark({
  host, port = 47900, secret, sizesMiB = [1, 4, 16], trials = 12,
  warmup = 2, timeoutMs = 30000, requireNonloopback = false
}) {
  const target = requirePrivateIpv4(host);
  boundedInteger(port, "port", 1, 65535);
  boundedInteger(trials, "trials", 1, 100);
  boundedInteger(warmup, "warmup", 0, 20);
  boundedInteger(timeoutMs, "timeoutMs", 1000, 120000);
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("KINDRED_SDPN_PROOF_SECRET must be an ephemeral secret of at least 32 characters");
  }
  if (!Array.isArray(sizesMiB) || sizesMiB.length < 1 || sizesMiB.length > 3 ||
      new Set(sizesMiB).size !== sizesMiB.length ||
      sizesMiB.some((size) => !VALID_SIZES.has(size))) {
    throw new Error("sizesMiB must be distinct values from 1,4,16 (MiB)");
  }
  if (requireNonloopback && target.isLoopback) {
    throw new Error("non-loopback benchmark requested but receiver address is loopback");
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const results = [];
  let index = 0;

  for (const sizeMiB of sizesMiB) {
    const payload = Buffer.alloc(sizeMiB * MIB, 0xa5);
    const stateHash = createHash("sha256").update(payload).digest("hex");
    const samples = [];
    for (let n = 0; n < warmup + trials; n += 1) {
      const generation = index++;
      const stateId = "kindred-benchmark:" + runId + ":" + generation;
      const t0 = process.hrtime.bigint();
      const receipt = await sendTwoHostProof({
        host, port, secret, canonicalPayload: payload, stateId, stateHash,
        generation, timeoutMs
      });
      const roundTripMs = Number(process.hrtime.bigint() - t0) / 1e6;
      if (receipt.payloadBytes !== payload.length ||
          receipt.receivedSha256 !== stateHash ||
          receipt.stateHash !== stateHash ||
          receipt.authenticationVerified !== true ||
          receipt.integrityVerified !== true ||
          receipt.encryptedOnWire !== true ||
          receipt.physicalMachineAttestationProven !== false ||
          receipt.productionReadyClaim !== false) {
        throw new Error("invalid verified SW06-F receipt for generation " + generation);
      }
      if (requireNonloopback && receipt.twoHostNetworkProofSatisfied !== true) {
        throw new Error("two-host software evidence failed; refusing to publish performance");
      }
      if (n >= warmup) {
        samples.push({ roundTripMs, receipt });
      }
    }

    const durations = samples.map((sample) => sample.roundTripMs);
    const totalMs = durations.reduce((sum, ms) => sum + ms, 0);
    const payloadBytes = payload.length * samples.length;
    results.push({
      sizeMiB,
      trials: samples.length,
      payloadBytes,
      roundTripMs: {
        min: Math.min(...durations),
        mean: totalMs / durations.length,
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        max: Math.max(...durations)
      },
      // Application goodput includes challenge, encryption, TCP and verified receipt.
      applicationGoodputMbps: (payloadBytes * 8) / (totalMs / 1000) / 1e6,
      applicationGoodputMiBps: (payloadBytes / MIB) / (totalMs / 1000),
      samples
    });
  }
  const receipts = results.flatMap((result) => result.samples.map((sample) => sample.receipt));
  return {
    schema: "kindred.sdpn.sw06f.application-benchmark.v1",
    runId, startedAt, finishedAt: new Date().toISOString(),
    protocol: "kindred.sdpn.two-host-proof.v2",
    classification: "ENCRYPTED_SW06F_APPLICATION_GOODPUT",
    environment: { node: process.version, platform: process.platform, architecture: process.arch },
    testParameters: {
      receiverIpv4: target.host, port, sizesMiB, trials, warmup, timeoutMs,
      pattern: "synthetic-0xa5", dataIsSynthetic: true
    },
    observation: {
      loopbackTarget: target.isLoopback,
      nonloopbackReceiptsObserved: receipts.every((r) => r.loopbackObserved === false),
      distinctHostFingerprintsObserved: receipts.every((r) => r.distinctHostFingerprints === true),
      twoHostSoftwareProofObserved: receipts.every((r) => r.twoHostNetworkProofSatisfied === true),
      physicalMachineAttestationProven: false,
      physicalZeroCopyProven: false,
      internetBandwidthMeasured: false,
      productionAuthorized: false,
      // Distinct hosts and private-link proofs never imply separate physical machines.
      physicalSeparationVerified: false
    },
    results
  };
}

function argumentsFromCli(argv) {
  const options = new Map();
  const flags = new Set(["--allow-loopback"]);
  const named = new Set(["--host", "--port", "--sizes-mib", "--trials", "--warmup", "--timeout-ms", "--output"]);
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (!named.has(name) && !flags.has(name)) throw new Error("unknown argument: " + name);
    if (options.has(name)) throw new Error("duplicate argument: " + name);
    if (flags.has(name)) {
      options.set(name, true);
    } else {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
        throw new Error("missing value for " + name);
      }
      options.set(name, argv[++i]);
    }
  }
  if (!options.has("--host") || !options.has("--output")) {
    throw new Error("required: --host RFC1918_IP --output NEW_LOCAL_JSON_PATH");
  }
  const sizesMiB = (options.get("--sizes-mib") ?? "1,4,16").split(",").map(Number);
  return {
    host: options.get("--host"),
    port: Number(options.get("--port") ?? "47900"),
    sizesMiB,
    trials: Number(options.get("--trials") ?? "12"),
    warmup: Number(options.get("--warmup") ?? "2"),
    timeoutMs: Number(options.get("--timeout-ms") ?? "30000"),
    requireNonloopback: !options.has("--allow-loopback"),
    output: options.get("--output")
  };
}

async function main() {
  const opts = argumentsFromCli(process.argv.slice(2));
  const report = await runSw06fBenchmark({
    ...opts, secret: process.env.KINDRED_SDPN_PROOF_SECRET
  });
  // Exclusive creation protects immutable past evidence. Secret and payload are never persisted.
  await writeFile(opts.output, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx", mode: 0o600
  });
  process.stdout.write(JSON.stringify({
    evidencePath: opts.output,
    runId: report.runId,
    verifiedSoftwareTwoHostProof: report.observation.twoHostSoftwareProofObserved,
    physicalMachineAttestationProven: false,
    summary: report.results.map((item) => ({
      sizeMiB: item.sizeMiB, trials: item.trials,
      p50Ms: item.roundTripMs.p50, p95Ms: item.roundTripMs.p95,
      applicationGoodputMbps: item.applicationGoodputMbps
    }))
  }, null, 2) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write("SW06-F benchmark failed: " + error.message + "\n");
    process.exitCode = 1;
  });
}
