import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

export const WORKER_TRANSFER_SCHEMA = "kindred.direct-pipe.worker-transfer.v1";
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function digest(buffer) {
  return createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
}

export class DirectPipeWorkerTransfer {
  #worker;
  #pending = new Map();
  #nextId = 1;
  #closed = false;
  #maxBytes;
  #maxInflight;
  #timeoutMs;
  #termination;

  constructor({ maxBytes = DEFAULT_MAX_BYTES, maxInflight = 8, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.#maxBytes = positiveInteger(maxBytes, "maxBytes");
    this.#maxInflight = positiveInteger(maxInflight, "maxInflight");
    this.#timeoutMs = positiveInteger(timeoutMs, "timeoutMs");
    this.#worker = new Worker(new URL("./direct-pipe-worker.mjs", import.meta.url));
    this.#worker.on("message", (message) => this.#receive(message));
    this.#worker.on("error", (error) => this.#fail(error));
    this.#worker.on("exit", (code) => {
      if (!this.#closed) this.#fail(new Error(`Direct Pipe worker exited with code ${code}`));
    });
  }

  async transfer(buffer) {
    if (this.#closed) throw new Error("Direct Pipe worker is closed");
    if (!(buffer instanceof ArrayBuffer)) {
      throw new TypeError("Transfer requires an owned ArrayBuffer");
    }
    if (buffer.byteLength < 1 || buffer.byteLength > this.#maxBytes) {
      throw new RangeError(`Transfer size must be between 1 and ${this.#maxBytes} bytes`);
    }
    if (this.#pending.size >= this.#maxInflight) {
      throw new Error("Direct Pipe worker capacity exceeded");
    }

    const logicalBytes = buffer.byteLength;
    const expectedSha256 = digest(buffer);
    const id = this.#nextId++;
    const started = process.hrtime.bigint();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#fail(new Error("Direct Pipe worker transfer timed out"));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout, logicalBytes, expectedSha256, started });

      try {
        this.#worker.postMessage({ id, buffer }, [buffer]);
        if (buffer.byteLength !== 0) {
          this.#fail(new Error("Transfer did not detach the source ArrayBuffer"));
        }
      } catch (error) {
        this.#fail(error);
      }
    });
  }

  #receive(message) {
    const request = this.#pending.get(message?.id);
    if (!request) return;
    this.#pending.delete(message.id);
    clearTimeout(request.timeout);

    try {
      if (message.error) throw new Error(`Direct Pipe worker: ${message.error}`);
      if (!(message.buffer instanceof ArrayBuffer) ||
          message.byteLength !== request.logicalBytes ||
          message.buffer.byteLength !== request.logicalBytes ||
          message.sha256 !== request.expectedSha256 ||
          digest(message.buffer) !== request.expectedSha256) {
        throw new Error("Direct Pipe worker integrity or length mismatch");
      }

      const latencyNs = Number(process.hrtime.bigint() - request.started);
      request.resolve({
        output: new Uint8Array(message.buffer),
        measurement: {
          schemaVersion: WORKER_TRANSFER_SCHEMA,
          classification: "REDUCED_COPY",
          boundary: "NODE_WORKER_TRANSFER_LIST_ROUND_TRIP",
          logicalBytes: request.logicalBytes,
          explicitPayloadCopies: 0,
          sourceDetached: true,
          workerSha256: message.sha256,
          outputSha256: request.expectedSha256,
          latencyNs,
          hardwarePhysicalTransferMeasured: false,
          zeroCopyClaimAuthorized: false
        }
      });
    } catch (error) {
      request.reject(error);
      this.#fail(error);
    }
  }

  #fail(error) {
    if (this.#closed) return;
    this.#closed = true;
    for (const request of this.#pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.#pending.clear();
    this.#termination = this.#worker.terminate();
  }

  async close() {
    if (!this.#closed) this.#fail(new Error("Direct Pipe worker closed"));
    await this.#termination;
  }
}
