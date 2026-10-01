import { createHash } from "node:crypto";

export const INTERFACE_ROUTE_SCHEMA = "kindred.sdpn.interface-route.v1";
export const INTERFACE_FRAME_SCHEMA = "kindred.interface.frame.v1";

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalize(value[key])])
    );
  }
  return value;
}

export function canonicalFrameBytes(frame) {
  validateInterfaceFrame(frame);
  return Buffer.from(JSON.stringify(normalize(frame)), "utf8");
}

export function frameDigest(frame) {
  return createHash("sha256").update(canonicalFrameBytes(frame)).digest("hex");
}

export function validateInterfaceFrame(frame) {
  if (!frame || typeof frame !== "object") {
    throw new TypeError("interface frame must be an object");
  }
  if (frame.schema_version !== INTERFACE_FRAME_SCHEMA) {
    throw new Error("unsupported interface frame schema");
  }
  for (const key of [
    "session_id",
    "frame_id",
    "source_peer_id",
    "target_peer_id",
    "type"
  ]) {
    if (typeof frame[key] !== "string" || frame[key].length === 0) {
      throw new Error(`interface frame is missing ${key}`);
    }
  }
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0) {
    throw new Error("interface frame sequence must be a non-negative integer");
  }
  return frame;
}

export function decodeInterfaceFrame(bytes) {
  const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  return validateInterfaceFrame(value);
}

export class SessionSequencer {
  #lastBySource = new Map();
  #pending = new Map();
  #maxInFlight;

  constructor({ maxInFlight = 64 } = {}) {
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1) {
      throw new RangeError("maxInFlight must be a positive integer");
    }
    this.#maxInFlight = maxInFlight;
  }

  accept(frame) {
    validateInterfaceFrame(frame);
    const key = `${frame.session_id}|${frame.source_peer_id}`;
    const previous = this.#lastBySource.get(key);
    if (previous !== undefined && frame.sequence <= previous) {
      throw new Error("interface frame sequence replay or reordering rejected");
    }
    this.#lastBySource.set(key, frame.sequence);

    if (!["ack", "pong"].includes(frame.type)) {
      if (this.#pending.size >= this.#maxInFlight) {
        throw new Error("interface session backpressure window is full");
      }
      this.#pending.set(frame.frame_id, {
        sessionId: frame.session_id,
        sourcePeerId: frame.source_peer_id,
        sequence: frame.sequence
      });
    }
    return {
      accepted: true,
      pending: this.#pending.size,
      lastSequence: frame.sequence
    };
  }

  acknowledge(frameId) {
    const accepted = this.#pending.delete(frameId);
    return {
      acknowledged: accepted,
      pending: this.#pending.size
    };
  }

  status() {
    return {
      pending: this.#pending.size,
      maxInFlight: this.#maxInFlight,
      trackedSources: this.#lastBySource.size
    };
  }
}

export class SDPNInterfaceRoutePlanner {
  constructor({ inlineLimitBytes = 64 * 1024 } = {}) {
    if (!Number.isSafeInteger(inlineLimitBytes) || inlineLimitBytes < 1024) {
      throw new RangeError("inlineLimitBytes must be at least 1024");
    }
    this.inlineLimitBytes = inlineLimitBytes;
  }

  plan(frame, endpoint) {
    validateInterfaceFrame(frame);
    if (!endpoint?.authorized) {
      throw new Error("interface route endpoint must be authorized");
    }
    if (!endpoint.endpointId || !endpoint.locator) {
      throw new Error("interface route endpoint identity is incomplete");
    }

    const common = {
      schemaVersion: INTERFACE_ROUTE_SCHEMA,
      sessionId: frame.session_id,
      frameId: frame.frame_id,
      sourcePeerId: frame.source_peer_id,
      targetPeerId: frame.target_peer_id,
      endpointId: endpoint.endpointId,
      destination: endpoint.locator,
      frameType: frame.type,
      sequence: frame.sequence,
      physicalZeroCopyProven: false,
      physicalMachineAttestationProven: false
    };

    if (frame.state_ref && endpoint.supportsReference !== false) {
      return {
        ...common,
        classification: "REFERENCE",
        transportMode: "reference",
        stateRef: frame.state_ref,
        payloadBytes: 0,
        payloadSha256: null,
        executed: false,
        reason: "Resolve the referenced state at the destination; do not inline it."
      };
    }

    const bytes = canonicalFrameBytes(frame);
    const digest = createHash("sha256").update(bytes).digest("hex");

    if (endpoint.supportsStreaming && bytes.length <= this.inlineLimitBytes) {
      return {
        ...common,
        classification: "INTERACTIVE_BUFFERED",
        transportMode: "frame",
        stateRef: null,
        payloadBytes: bytes.length,
        payloadSha256: digest,
        executed: false,
        reason: (
          "Small realtime interface frame is eligible for the persistent " +
          "interactive session lane."
        )
      };
    }

    return {
      ...common,
      classification: "PORTABLE_BUFFERED",
      transportMode: "frame",
      stateRef: null,
      payloadBytes: bytes.length,
      payloadSha256: digest,
      executed: false,
      reason: (
        "Frame requires the conservative buffered route; this plan does not " +
        "pretend a network transfer occurred."
      )
    };
  }
}
