import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERFACE_FRAME_SCHEMA,
  SDPNInterfaceRoutePlanner,
  SessionPriorityQueue,
  SessionSequencer,
  canonicalFrameBytes,
  decodeInterfaceFrame
} from "../src/interface-session-routing.mjs";

function frame(overrides = {}) {
  return {
    schema_version: INTERFACE_FRAME_SCHEMA,
    session_id: "session-1",
    frame_id: "frame-1",
    sequence: 1,
    source_peer_id: "peer-a",
    target_peer_id: "kindred",
    type: "input",
    modality: "text",
    correlation_id: null,
    reply_to: null,
    capability: null,
    state_ref: null,
    final: false,
    data: { text: "hello" },
    created_at: "2026-10-01T06:00:00Z",
    ...overrides
  };
}

test("interface frame canonical encoding round-trips", () => {
  const original = frame();
  const bytes = canonicalFrameBytes(original);
  const decoded = decodeInterfaceFrame(bytes);
  assert.equal(decoded.frame_id, original.frame_id);
  assert.equal(decoded.data.text, "hello");
});

test("session sequencer rejects replay and tracks acknowledgements", () => {
  const sequencer = new SessionSequencer({ maxInFlight: 2 });
  const first = sequencer.accept(frame());
  assert.equal(first.pending, 1);

  assert.throws(
    () => sequencer.accept(frame({ frame_id: "duplicate" })),
    /replay or reordering/
  );

  const acked = sequencer.acknowledge("frame-1");
  assert.equal(acked.acknowledged, true);
  assert.equal(acked.pending, 0);
});

test("cancel control frame bypasses a saturated normal backpressure window", () => {
  const sequencer = new SessionSequencer({ maxInFlight: 2 });
  sequencer.accept(frame({ frame_id: "one", sequence: 1 }));
  sequencer.accept(frame({ frame_id: "two", sequence: 2 }));

  const cancel = sequencer.accept(
    frame({ frame_id: "cancel", sequence: 3, type: "cancel" })
  );

  assert.equal(cancel.accepted, true);
  assert.equal(cancel.control, true);
  assert.equal(cancel.priority, 0);
  assert.equal(cancel.pending, 2);
});

test("priority queue drains control before interactive before stream", () => {
  const queue = new SessionPriorityQueue({ maxDepth: 3 });
  queue.enqueue(frame({ frame_id: "delta", sequence: 1, type: "output.delta" }));
  queue.enqueue(frame({ frame_id: "input", sequence: 2, type: "input" }));
  queue.enqueue(frame({ frame_id: "cancel", sequence: 3, type: "cancel" }));

  assert.equal(queue.dequeue().type, "cancel");
  assert.equal(queue.dequeue().type, "input");
  assert.equal(queue.dequeue().type, "output.delta");
});

test("state-reference interface frame avoids payload movement", () => {
  const plan = new SDPNInterfaceRoutePlanner().plan(
    frame({
      frame_id: "state-ref",
      type: "state.ref",
      state_ref: "recall://kindred/state-42"
    }),
    {
      endpointId: "peer-b",
      locator: "session://peer-b",
      authorized: true,
      supportsReference: true,
      supportsStreaming: true
    }
  );

  assert.equal(plan.classification, "REFERENCE");
  assert.equal(plan.payloadBytes, 0);
  assert.equal(plan.executed, false);
});

test("small realtime frame selects interactive buffered lane", () => {
  const plan = new SDPNInterfaceRoutePlanner().plan(
    frame(),
    {
      endpointId: "peer-b",
      locator: "session://peer-b",
      authorized: true,
      supportsReference: true,
      supportsStreaming: true
    }
  );

  assert.equal(plan.classification, "INTERACTIVE_BUFFERED");
  assert.equal(plan.lane, "INTERACTIVE");
  assert.ok(plan.payloadBytes > 0);
  assert.equal(plan.executed, false);
});

test("cancel selects highest-priority control lane", () => {
  const plan = new SDPNInterfaceRoutePlanner().plan(
    frame({ type: "cancel" }),
    {
      endpointId: "peer-b",
      locator: "session://peer-b",
      authorized: true,
      supportsStreaming: true
    }
  );

  assert.equal(plan.classification, "INTERACTIVE_CONTROL");
  assert.equal(plan.lane, "CONTROL");
  assert.equal(plan.priority, 0);
});

test("output delta selects stream lane", () => {
  const plan = new SDPNInterfaceRoutePlanner().plan(
    frame({ type: "output.delta" }),
    {
      endpointId: "peer-b",
      locator: "session://peer-b",
      authorized: true,
      supportsStreaming: true
    }
  );

  assert.equal(plan.classification, "INTERACTIVE_STREAM");
  assert.equal(plan.lane, "STREAM");
  assert.equal(plan.priority, 2);
});

test("oversized or nonstreaming frame stays conservative", () => {
  const plan = new SDPNInterfaceRoutePlanner({ inlineLimitBytes: 1024 }).plan(
    frame({ data: { text: "x".repeat(4096) } }),
    {
      endpointId: "peer-b",
      locator: "session://peer-b",
      authorized: true,
      supportsStreaming: true
    }
  );

  assert.equal(plan.classification, "PORTABLE_BUFFERED");
  assert.equal(plan.executed, false);
  assert.equal(plan.physicalZeroCopyProven, false);
});
