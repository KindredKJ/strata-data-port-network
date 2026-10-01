import { createHash } from "node:crypto";
import { DirectPipeWorkerTransfer } from "./direct-pipe-worker-transfer.mjs";

export const KINDRED_STATE_PORT_SCHEMA = "kindred.sdpn.state-port.v1";

function toBytes(serialized) {
  if (typeof serialized === "string") return Buffer.from(serialized, "utf8");
  if (serialized instanceof Uint8Array) {
    return Buffer.from(serialized.buffer, serialized.byteOffset, serialized.byteLength);
  }
  if (serialized instanceof ArrayBuffer) return Buffer.from(serialized);
  throw new TypeError("canonical payload must be a string, Uint8Array, or ArrayBuffer");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function payloadDigest(serialized) {
  return sha256(toBytes(serialized));
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
      reason: "Remote path is only classified; no two-machine executor is established."
    };
  }

  async transfer({
    candidate,
    destination,
    canonicalPayload,
    expectedIntegrityHash,
    supportsReference = true,
    local = true
  }) {
    const plan = this.plan({ candidate, destination, supportsReference, local });

    if (plan.mode === "reference") {
      return {
        ...plan,
        executed: true,
        locator: candidate.locator,
        payloadMoved: false
      };
    }

    if (!expectedIntegrityHash) {
      throw new Error("expectedIntegrityHash is required for payload transfer");
    }
    const bytes = toBytes(canonicalPayload);
    const digest = sha256(bytes);
    if (digest !== expectedIntegrityHash) {
      throw new Error("canonical payload integrity hash mismatch");
    }

    if (plan.classification !== "REDUCED_COPY") {
      return {
        ...plan,
        executed: false,
        payloadMoved: false,
        plannedPayloadBytes: bytes.length,
        payloadSha256: digest,
        boundary: "BUFFERED_FALLBACK_NOT_IMPLEMENTED"
      };
    }

    const owned = new ArrayBuffer(bytes.length);
    new Uint8Array(owned).set(bytes);
    const { output, measurement } = await this.#workerTransfer().transfer(owned);

    return {
      ...plan,
      executed: true,
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
