import { createHash } from "node:crypto";
import { DirectPipeRuntime } from "../candidates/unified-quad-direct-pipe/runtime/unified-quad/src/direct-pipe-runtime.v1.mjs";
import { DirectPipeWorkerTransfer, WORKER_TRANSFER_SCHEMA } from "../src/direct-pipe-worker-transfer.mjs";

const payloadBytes = 4 * 1024 * 1024;
const warmupIterations = 4;
const iterations = 32;
const expected = createHash("sha256").update(Buffer.alloc(payloadBytes, 0xa5)).digest("hex");

function digest(value) {
  return createHash("sha256").update(new Uint8Array(value)).digest("hex");
}

function sampleStats(samples) {
  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) => ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
  return {
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    samplesMs: samples
  };
}

function makeBufferedInput() {
  return Buffer.alloc(payloadBytes, 0xa5);
}

function makeWorkerInput() {
  const input = new ArrayBuffer(payloadBytes);
  new Uint8Array(input).fill(0xa5);
  return input;
}

function runBufferedSample(runtime) {
  const input = makeBufferedInput();
  const started = process.hrtime.bigint();
  const inputSha256 = digest(input);
  const result = runtime.transfer(input);
  const workerEquivalentSha256 = digest(result.output);
  const outputSha256 = digest(result.output);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (inputSha256 !== expected || workerEquivalentSha256 !== expected || outputSha256 !== expected) {
    throw new Error("Buffered baseline integrity failure");
  }
  return elapsedMs;
}

async function runWorkerSample(worker) {
  const input = makeWorkerInput();
  const started = process.hrtime.bigint();
  const result = await worker.transfer(input);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (input.byteLength !== 0 || result.measurement.workerSha256 !== expected || result.measurement.outputSha256 !== expected) {
    throw new Error("Worker ownership or integrity failure");
  }
  return elapsedMs;
}

const baseline = new DirectPipeRuntime();
const worker = new DirectPipeWorkerTransfer({ maxBytes: payloadBytes });
const baselineSamples = [];
const workerSamples = [];

try {
  for (let index = 0; index < warmupIterations; index += 1) {
    runBufferedSample(baseline);
  }
  for (let index = 0; index < warmupIterations; index += 1) {
    await runWorkerSample(worker);
  }
  for (let index = 0; index < iterations; index += 1) {
    baselineSamples.push(runBufferedSample(baseline));
  }
  for (let index = 0; index < iterations; index += 1) {
    workerSamples.push(await runWorkerSample(worker));
  }
} finally {
  await worker.close();
}

const baselineStats = sampleStats(baselineSamples);
const workerStats = sampleStats(workerSamples);
process.stdout.write(`${JSON.stringify({
  schemaVersion: WORKER_TRANSFER_SCHEMA,
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  payloadBytes,
  warmupIterations,
  iterations,
  integrity: {
    algorithm: "sha256",
    hashOperationsPerTransfer: 3,
    expectedSha256: expected,
    bufferedInputAndOutputVerified: true,
    workerSourceDetached: true,
    workerAndOutputIntegrityVerified: true
  },
  setupCosts: {
    payloadAllocationAndFillExcludedFromTimedSamples: true,
    workerStartupExcludedFromTimedSamples: true
  },
  baseline: {
    classification: "PORTABLE_BUFFERED",
    explicitPayloadCopiesPerTransfer: 1,
    ...baselineStats
  },
  worker: {
    classification: "REDUCED_COPY",
    explicitPayloadCopiesPerTransfer: 0,
    ...workerStats
  },
  limits: {
    digestComputationIncludedInTimedSamples: true,
    hardwarePhysicalTransferMeasured: false,
    twoMachineTransportProven: false,
    zeroCopyClaimAuthorized: false,
    productionReadinessProven: false
  }
}, null, 2)}\n`);
