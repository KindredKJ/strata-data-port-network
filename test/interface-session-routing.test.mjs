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

test("backpressure does not consume sequence numbers and allows exact retry", () => {
  const sequencer = new SessionSequencer({ maxInFlight: 1 });
  sequencer.accept(frame({ frame_id: "first", sequence: 1 }));
  const second = frame({ frame_id: "second", sequence: 2 });
  assert.throws(() => sequencer.accept(second), /backpressure/);
  assert.equal(sequencer.status().pending, 1);
  sequencer.acknowledge("first");
  assert.deepEqual(sequencer.accept(second), {
    accepted: true, priority: 1, control: false, pending: 1, lastSequence: 2
  });
});

test("duplicate pending frame IDs cannot overwrite entries across sessions", () => {
  const sequencer = new SessionSequencer({ maxInFlight: 3 });
  sequencer.accept(frame({ frame_id: "same", session_id: "alpha" }));
  assert.throws(() => sequencer.accept(frame({
    frame_id: "same", session_id: "beta"
  })), /duplicate pending/);
  assert.equal(sequencer.status().pending, 1);
  assert.equal(sequencer.status().trackedSources, 1);
});

test("delimiters in session and source IDs cannot collide", () => {
  const sequencer = new SessionSequencer({ maxInFlight: 2 });
  sequencer.accept(frame({
    session_id: "a|b", source_peer_id: "c", frame_id: "first"
  }));
  sequencer.accept(frame({
    session_id: "a", source_peer_id: "b|c", frame_id: "second"
  }));
  assert.equal(sequencer.status().trackedSources, 2);
});

test("session teardown releases only that session's replay and pending state", () => {
  const sequencer = new SessionSequencer({ maxInFlight: 3 });
  sequencer.accept(frame({ session_id: "alpha", frame_id: "alpha-one" }));
  sequencer.accept(frame({ session_id: "beta", frame_id: "beta-one" }));
  const closed = sequencer.closeSession("alpha");
  assert.deepEqual(closed, { removedSources: 1, removedPending: 1, pending: 1 });
  assert.equal(sequencer.status().trackedSources, 1);
  assert.equal(sequencer.acknowledge("beta-one").acknowledged, true);
  sequencer.accept(frame({ session_id: "alpha", frame_id: "alpha-new" }));
  assert.throws(() => sequencer.closeSession(""), /sessionId/);
});

test("route planning requires exactly boolean true authorization", () => {
  const endpoint = { endpointId: "peer", locator: "session://peer" };
  const planner = new SDPNInterfaceRoutePlanner();
  for (const value of ["false", 1, {}, null, undefined]) {
    assert.throws(() => planner.plan(frame(), { ...endpoint, authorized: value }), /authorized/);
  }
  assert.equal(planner.plan(frame(), { ...endpoint, authorized: true }).executed, false);
});

test("canonical frame digest rejects ambiguous or non-JSON values", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [1, , 3];
  for (const invalid of [
    { amount: NaN }, { amount: Infinity }, { amount: -Infinity },
    { amount: -0 }, { value: undefined }, { value: () => 1 },
    { value: 2n }, { value: new Date() }, { value: sparse }, cyclic
  ]) {
    assert.throws(() => canonicalFrameBytes(frame({ data: invalid })), /JSON|numbers|cyclic|array|compatible/);
  }
  const first = canonicalFrameBytes(frame({ data: { b: 2, a: 1 } }));
  const second = canonicalFrameBytes(frame({ data: { a: 1, b: 2 } }));
  assert.deepEqual(first, second);
});

test("cancel remains admitted when normal in-flight window is saturated", () => {
  const seq = new SessionSequencer({ maxInFlight: 2, maxControlInFlight: 1 });
  seq.accept(frame({ frame_id: "one", sequence: 1 }));
  seq.accept(frame({ frame_id: "two", sequence: 2 }));
  const cancel = seq.accept(frame({ frame_id: "cancel", sequence: 3, type: "cancel" }));
  assert.equal(cancel.control, true);
  assert.equal(cancel.priority, 0);
  assert.equal(cancel.pending, 3);
  assert.equal(seq.acknowledge("cancel").acknowledged, true);
  assert.equal(seq.status().normalPending, 2);
  assert.equal(seq.status().controlPending, 0);
});

test("control reserve is bounded and does not consume rejected sequence numbers", () => {
  const seq = new SessionSequencer({ maxInFlight: 1, maxControlInFlight: 1 });
  seq.accept(frame({ frame_id: "first", sequence: 1, type: "input" }));
  seq.accept(frame({ frame_id: "ping1", sequence: 2, type: "ping" }));
  assert.throws(() => seq.accept(frame({ frame_id: "cancel", sequence: 3, type: "cancel" })),
    /control backpressure/);
  seq.acknowledge("ping1");
  assert.equal(seq.accept(frame({ frame_id: "cancel", sequence: 3, type: "cancel" })).pending, 2);
  assert.equal(seq.acknowledge("cancel").acknowledged, true);
});

test("priority queue schedules independent sources by priority", () => {
  const q = new SessionPriorityQueue({ maxDepth: 3 });
  q.enqueue(frame({ frame_id: "delta", source_peer_id: "stream", type: "output.delta" }));
  q.enqueue(frame({ frame_id: "input", source_peer_id: "interactive" }));
  q.enqueue(frame({ frame_id: "ping", source_peer_id: "control", type: "ping" }));
  assert.deepEqual([q.dequeue().type, q.dequeue().type, q.dequeue().type],
    ["ping", "input", "output.delta"]);
});

test("normal priority cannot reverse same-source monotonically ordered frames", () => {
  const q = new SessionPriorityQueue({ maxDepth: 4 });
  q.enqueue(frame({ frame_id: "delta", sequence: 1, type: "output.delta" }));
  q.enqueue(frame({ frame_id: "ping", sequence: 2, type: "ping" }));
  const seq = new SessionSequencer();
  assert.equal(seq.accept(q.dequeue()).lastSequence, 1);
  assert.equal(seq.accept(q.dequeue()).lastSequence, 2);
});

test("barge-in cancel drops same-source queued output and reports every drop", () => {
  const q = new SessionPriorityQueue({ maxDepth: 3 });
  q.enqueue(frame({ frame_id: "delta", sequence: 1, type: "output.delta" }));
  q.enqueue(frame({ frame_id: "input", sequence: 2, type: "input" }));
  const status = q.enqueue(frame({ frame_id: "cancel", sequence: 3, type: "cancel" }));
  assert.deepEqual(status.droppedFrameIds.sort(), ["delta", "input"]);
  assert.equal(q.depth, 1);
  const seq = new SessionSequencer();
  assert.equal(seq.accept(q.dequeue()).lastSequence, 3);
});

test("control priority evicts lower-priority work but never exceeds maxDepth", () => {
  const q = new SessionPriorityQueue({ maxDepth: 2 });
  q.enqueue(frame({ frame_id: "bulk1", source_peer_id: "a", type: "output.delta" }));
  q.enqueue(frame({ frame_id: "bulk2", source_peer_id: "b", type: "output.delta" }));
  const event = q.enqueue(frame({ frame_id: "ping", source_peer_id: "c", type: "ping" }));
  assert.equal(q.depth, 2);
  assert.equal(event.droppedFrameIds.length, 1);
  const q2 = new SessionPriorityQueue({ maxDepth: 1 });
  q2.enqueue(frame({ frame_id: "ping1", source_peer_id: "p1", type: "ping" }));
  assert.throws(() => q2.enqueue(frame({ frame_id: "ping2", source_peer_id: "p2", type: "ping" })),
    /control queue is full/);
});

test("route planner selects control and bulk streaming lanes", () => {
  const planner = new SDPNInterfaceRoutePlanner();
  const endpoint = { endpointId: "peer-b", locator: "session://peer-b",
    authorized: true, supportsStreaming: true };
  const control = planner.plan(frame({ type: "cancel" }), endpoint);
  const stream = planner.plan(frame({ type: "output.delta" }), endpoint);
  assert.equal(control.classification, "INTERACTIVE_CONTROL");
  assert.equal(control.lane, "CONTROL");
  assert.equal(control.priority, 0);
  assert.equal(stream.classification, "INTERACTIVE_STREAM");
  assert.equal(stream.lane, "STREAM");
  assert.equal(stream.priority, 2);
  assert.equal(stream.executed, false);
});