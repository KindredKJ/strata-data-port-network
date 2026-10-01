import { createHash } from "node:crypto";

export const INTERFACE_ROUTE_SCHEMA = "kindred.sdpn.interface-route.v2";
export const INTERFACE_FRAME_SCHEMA = "kindred.interface.frame.v1";

export const CONTROL_FRAME_TYPES = new Set([
  "ack",
  "cancel",
  "error",
  "ping",
  "pong",
  "response.start",
  "response.cancelled"
]);

export const STREAM_FRAME_TYPES = new Set([
  "input.delta",
  "audio.input.chunk",
  "output.delta",
  "audio.output.chunk"
]);

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

export function framePriority(frame) {
  validateInterfaceFrame(frame);
  if (CONTROL_FRAME_TYPES.has(frame.type)) return 0;
  if (STREAM_FRAME_TYPES.has(frame.type)) return 2;
  return 1;
}

export class SessionPriorityQueue {
  #queues = [[], [], []];
  #maxDepth;

  constructor({ maxDepth = 512 } = {}) {
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
      throw new RangeError("maxDepth must be a positive integer");
    }
    this.#maxDepth = maxDepth;
  }

  get depth() {
    return this.#queues.reduce((sum, queue) => sum + queue.length, 0);
  }

  enqueue(frame) {
    const priority = framePriority(frame);
    if (this.depth >= this.#maxDepth && priority !== 0) {
      throw new Error("realtime stream queue is full");
    }
    this.#queues[priority].push(frame);
    return { priority, depth: this.depth };
  }

  dequeue() {
    for (const queue of this.#queues) {
      if (queue.length) return queue.shift();
    }
    return null;
  }

  status() {
    return {
      depth: this.depth,
      maxDepth: this.#maxDepth,
      control: this.#queues[0].length,
      interactive: this.#queues[1].length,
      stream: this.#queues[2].length
    };
  }
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

    const control = CONTROL_FRAME_TYPES.has(frame.type);
    const noAck = ["ack", "pong"].includes(frame.type);

    if (!control && !noAck) {
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
      priority: framePriority(frame),
      control,
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

    const priority = framePriority(frame);
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
      priority,
      physicalZeroCopyProven: false,
      physicalMachineAttestationProven: false
    };

    if (frame.state_ref && endpoint.supportsReference !== false) {
      return {
        ...common,
        lane: "REFERENCE",
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
      const control = CONTROL_FRAME_TYPES.has(frame.type);
      const stream = STREAM_FRAME_TYPES.has(frame.type);
      return {
        ...common,
        lane: control ? "CONTROL" : stream ? "STREAM" : "INTERACTIVE",
        classification: control
          ? "INTERACTIVE_CONTROL"
          : stream
            ? "INTERACTIVE_STREAM"
            : "INTERACTIVE_BUFFERED",
        transportMode: "frame",
        stateRef: null,
        payloadBytes: bytes.length,
        payloadSha256: digest,
        executed: false,
        reason: control
          ? "Control frame receives the highest-priority persistent session lane."
          : stream
            ? "Streaming delta/chunk uses the bulk realtime lane behind control traffic."
            : "Interactive frame uses the persistent realtime session lane."
      };
    }

    return {
      ...common,
      lane: "BUFFERED",
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
