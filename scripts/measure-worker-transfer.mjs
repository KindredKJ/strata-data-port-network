import { createHash } from "node:crypto";
import { DirectPipeRuntime } from "../candidates/unified-quad-direct-pipe/runtime/unified-quad/src/direct-pipe-runtime.v1.mjs";
import { DirectPipeWorkerTransfer, WORKER_TRANSFER_SCHEMA } from "../src/direct-pipe-worker-transfer.mjs";

const bytesPerTransfer = 4 * 1024 * 1024;
const iterations = 16;
const baseline = new DirectPipeRuntime();
const worker = new DirectPipeWorkerTransfer({ maxBytes: bytesPerTransfer });
const expected = createHash("sha256").update(Buffer.alloc(bytesPerTransfer, 0xa5)).digest("hex");
let baselineNs = 0;
let workerNs = 0;

try {
  for (let i = 0; i < iterations; i++) {
    const input = Buffer.alloc(bytesPerTransfer, 0xa5);
    const result = baseline.transfer(input);
    if (createHash("sha256").update(result.output).digest("hex") !== expected) {
      throw new Error("Buffered baseline integrity failure");
    }
    baselineNs += result.measurement.latencyNs;
  }

  for (let i = 0; i < iterations; i++) {
    const input = new ArrayBuffer(bytesPerTransfer);
    new Uint8Array(input).fill(0xa5);
    const result = await worker.transfer(input);
    if (input.byteLength !== 0 || result.measurement.outputSha256 !== expected) {
      throw new Error("Worker ownership or integrity failure");
    }
    workerNs += result.measurement.latencyNs;
  }
} finally {
  await worker.close();
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: WORKER_TRANSFER_SCHEMA,
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  iterations,
  bytesPerTransfer,
  expectedSha256: expected,
  baseline: {
    classification: "PORTABLE_BUFFERED",
    explicitPayloadCopiesPerTransfer: 1,
    meanBoundaryLatencyMs: baselineNs / iterations / 1_000_000
  },
  worker: {
    classification: "REDUCED_COPY",
    explicitPayloadCopiesPerTransfer: 0,
    sourceDetached: true,
    workerAndOutputIntegrityVerified: true,
    meanBoundaryLatencyMs: workerNs / iterations / 1_000_000
  },
  limits: {
    setupAllocationExcluded: true,
    digestComputationIncludedInWorkerBoundary: true,
    hardwarePhysicalTransferMeasured: false,
    twoMachineTransportProven: false,
    zeroCopyClaimAuthorized: false
  }
}, null, 2)}\n`);
