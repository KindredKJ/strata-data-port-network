import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERFACE_FRAME_SCHEMA,
  SDPNInterfaceRoutePlanner,
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
  assert.ok(plan.payloadBytes > 0);
  assert.equal(plan.executed, false);
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
