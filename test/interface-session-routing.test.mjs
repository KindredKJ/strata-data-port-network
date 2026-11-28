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

test("backpressure does not consume sequence numbers and allows exact retry", () => {
  const sequencer = new SessionSequencer({ maxInFlight: 1 });
  sequencer.accept(frame({ frame_id: "first", sequence: 1 }));
  const second = frame({ frame_id: "second", sequence: 2 });
  assert.throws(() => sequencer.accept(second), /backpressure/);
  assert.equal(sequencer.status().pending, 1);
  sequencer.acknowledge("first");
  assert.deepEqual(sequencer.accept(second), {
    accepted: true, pending: 1, lastSequence: 2
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
