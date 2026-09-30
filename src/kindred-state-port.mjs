import { createHash } from "node:crypto";
import { DirectPipeWorkerTransfer } from "./direct-pipe-worker-transfer.mjs";

export const KINDRED_STATE_PORT_SCHEMA = "kindred.sdpn.state-port.v1";

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalize(value[key])])
    );
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(normalize(value)), "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function stateHash(value) {
  return sha256(canonicalBytes(value));
}

export class KindredStatePort {
  #worker;
  #workerOptions;

  constructor(workerOptions = {}) {
    this.#workerOptions = workerOptions;
  }

  #workerTransfer() {
    if (!this.#worker) {
      this.#worker = new DirectPipeWorkerTransfer(this.#workerOptions);
    }
    return this.#worker;
  }

  plan({ candidate, destination, supportsReference = true, local = true }) {
    if (!candidate?.verified) throw new Error("candidate must be verified");
    if (!candidate.state_hash || !candidate.state_id) {
      throw new Error("candidate identity is incomplete");
    }

    if (supportsReference) {
      return {
        schemaVersion: KINDRED_STATE_PORT_SCHEMA,
        stateId: candidate.state_id,
        stateHash: candidate.state_hash,
        destination,
        mode: "reference",
        classification: "REFERENCE",
        physicalZeroCopyProven: false,
        twoMachineTransportProven: false,
        reason: "Destination can resolve verified state without payload movement."
      };
    }

    if (local) {
      return {
        schemaVersion: KINDRED_STATE_PORT_SCHEMA,
        stateId: candidate.state_id,
        stateHash: candidate.state_hash,
        destination,
        mode: "payload",
        classification: "REDUCED_COPY",
        physicalZeroCopyProven: false,
        twoMachineTransportProven: false,
        reason: "Use the SW06-E local ownership-transfer boundary."
      };
    }

    return {
      schemaVersion: KINDRED_STATE_PORT_SCHEMA,
      stateId: candidate.state_id,
      stateHash: candidate.state_hash,
      destination,
      mode: "payload",
      classification: "PORTABLE_BUFFERED",
      physicalZeroCopyProven: false,
      twoMachineTransportProven: false,
      reason: "Remote path falls back to portable buffered transport until proven otherwise."
    };
  }

  async transfer({ candidate, destination, payload, supportsReference = true, local = true }) {
    const plan = this.plan({ candidate, destination, supportsReference, local });
    if (plan.mode === "reference") {
      return {
        ...plan,
        locator: candidate.locator,
        payloadMoved: false
      };
    }

    const bytes = canonicalBytes(payload);
    const digest = sha256(bytes);
    if (digest !== candidate.state_hash) {
      throw new Error("payload hash does not match candidate state hash");
    }

    if (plan.classification !== "REDUCED_COPY") {
      return {
        ...plan,
        payloadMoved: true,
        payloadBytes: bytes.length,
        payloadSha256: digest,
        boundary: "BUFFERED_FALLBACK_NOT_EXECUTED"
      };
    }

    const owned = new ArrayBuffer(bytes.length);
    new Uint8Array(owned).set(bytes);
    const { output, measurement } = await this.#workerTransfer().transfer(owned);

    return {
      ...plan,
      payloadMoved: true,
      payloadBytes: output.byteLength,
      payloadSha256: digest,
      boundary: measurement.boundary,
      workerMeasurement: measurement,
      serializationCopiesExcludedFromClassification: true
    };
  }

  async close() {
    if (this.#worker) {
      await this.#worker.close();
      this.#worker = undefined;
    }
  }
}
