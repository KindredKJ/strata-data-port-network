import test from "node:test";
import assert from "node:assert/strict";
import {
  SDPN_ACTIVATION_SCOPE,
  SDPN_TELEPORT_PERFORMANCE_WINDOW_V1,
  SdpnTeleportActivationGate,
  evaluateSdpnTeleportWindow
} from "../src/sdpn-teleport-activation-gate-v1.mjs";

const sessionId = "00000000-0000-4000-8000-000000000001";
const peerPortId = "strata:port:ed25519:" + "a".repeat(64);
const qualificationReceiptSha256 = "b".repeat(64);

function makeWindow(sequence, {
  candidateLatencyUs = 60_000,
  baselineLatencyUs = 100_000,
  startMs = (sequence - 1) * 300_000,
  endMs = sequence * 300_000,
  operatorVerifiedPhysicalHosts = true,
  samples
} = {}) {
  return {
    schema: SDPN_TELEPORT_PERFORMANCE_WINDOW_V1,
    profileId: "kindred.sdpn.quic-wire.v1",
    operatorNetworkId: "operator-lab-01",
    sequence,
    sessionId,
    peerPortId,
    workloadId: "state-transfer-1mib",
    payloadBytes: 1024 * 1024,
    windowStartMs: startMs,
    windowEndMs: endMs,
    baselineTransport: "HTTP_TCP_AES_256_GCM_BUFFERED",
    candidateTransport: "SDPN_QUIC_STREAM_V1",
    operatorVerifiedPhysicalHosts,
    qualificationReceiptSha256,
    samples: samples ?? Array.from({ length: 60 }, () => ({
      baselineLatencyUs,
      candidateLatencyUs
    }))
  };
}

function makeGate(events, verifyPerformanceWindow = async () => true) {
  return new SdpnTeleportActivationGate({
    verifyPerformanceWindow,
    redirectLocally: async (target) => events.push({ kind: "redirect", target }),
    renewLocalRedirectLease: async (target) => events.push({ kind: "renew", target }),
    restoreLocalBaseline: async (target) => events.push({ kind: "restore", target })
  });
}

test("one good window needs three consecutive windows before local SDPN redirect", async () => {
  const events = [];
  const gate = makeGate(events);

  const first = await gate.observe(makeWindow(1));
  const second = await gate.observe(makeWindow(2));
  assert.equal(first.action, "CONTINUE_BASELINE_QUALIFICATION");
  assert.equal(first.qualifyingWindows, 1);
  assert.equal(second.qualifyingWindows, 2);
  assert.equal(gate.state, "BASELINE");
  assert.equal(events.length, 0);

  const third = await gate.observe(makeWindow(3));
  assert.equal(third.action, "ACTIVATE_LOCAL_REDIRECT");
  assert.equal(gate.state, "ACTIVE");
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "redirect");
  assert.equal(events[0].target.scope, SDPN_ACTIVATION_SCOPE);
  assert.equal(events[0].target.action, "REDIRECT_MATCHING_SDPN_SESSION_LOCALLY");
  assert.equal(events[0].target.routeTableChanges, false);
  assert.equal(events[0].target.sessionId, sessionId);
});

test("each active window renews the local redirect lease and a failed window restores baseline", async () => {
  const events = [];
  const gate = makeGate(events);
  await gate.observe(makeWindow(1));
  await gate.observe(makeWindow(2));
  await gate.observe(makeWindow(3));

  const healthy = await gate.observe(makeWindow(4));
  assert.equal(healthy.action, "RENEW_LOCAL_REDIRECT_LEASE");
  assert.equal(events.at(-1).kind, "renew");
  assert.equal(gate.state, "ACTIVE");

  const missedTarget = await gate.observe(makeWindow(5, { candidateLatencyUs: 61_000 }));
  assert.equal(missedTarget.action, "KEEP_BASELINE");
  assert.equal(missedTarget.reason, "PERFORMANCE_TARGET_MISSED");
  assert.equal(events.at(-1).kind, "restore");
  assert.equal(events.at(-1).target.routeTableChanges, false);
  assert.equal(gate.state, "BASELINE");
});

test("candidate p99 and packet-loss regressions block activation", () => {
  const p99Regression = evaluateSdpnTeleportWindow(makeWindow(1, {
    samples: [
      ...Array.from({ length: 59 }, () => ({
        baselineLatencyUs: 100_000,
        candidateLatencyUs: 60_000
      })),
      { baselineLatencyUs: 100_000, candidateLatencyUs: 100_001 }
    ]
  }));
  assert.equal(p99Regression.p95ImprovedByFortyPercent, true);
  assert.equal(p99Regression.p99GuardrailPassed, false);
  assert.equal(p99Regression.eligible, false);

  const lossRegression = evaluateSdpnTeleportWindow(makeWindow(1, {
    samples: [
      ...Array.from({ length: 60 }, () => ({
        baselineLatencyUs: 100_000,
        candidateLatencyUs: 60_000
      })),
      { baselineLatencyUs: 100_000, candidateLatencyUs: null }
    ]
  }));
  assert.equal(lossRegression.packetLossGuardrailPassed, false);
  assert.equal(lossRegression.eligible, false);
});

test("unpaired transport successes cannot qualify as paired improvement evidence", () => {
  assert.throws(() => evaluateSdpnTeleportWindow(makeWindow(1, {
    samples: [
      ...Array.from({ length: 60 }, () => ({
        baselineLatencyUs: 100_000,
        candidateLatencyUs: null
      })),
      ...Array.from({ length: 60 }, () => ({
        baselineLatencyUs: null,
        candidateLatencyUs: 60_000
      }))
    ]
  })), /60 successful paired samples/);
});
test("unverified performance evidence never reaches the local redirect callback", async () => {
  const events = [];
  const gate = makeGate(events, async () => false);
  for (let sequence = 1; sequence <= 3; sequence++) {
    const result = await gate.observe(makeWindow(sequence));
    assert.equal(result.action, "KEEP_BASELINE");
    assert.equal(result.reason, "INVALID_OR_MISSING_PERFORMANCE_WINDOW");
  }
  assert.equal(events.length, 0);
  assert.equal(gate.state, "BASELINE");
});

test("missing physical-host qualification never activates the local adapter", async () => {
  const events = [];
  const gate = makeGate(events);
  for (let sequence = 1; sequence <= 3; sequence++) {
    const result = await gate.observe(makeWindow(sequence, {
      operatorVerifiedPhysicalHosts: sequence !== 3
    }));
    assert.equal(result.state, "BASELINE");
  }
  assert.equal(events.length, 0);
  assert.equal(gate.state, "BASELINE");
});

test("windows longer or shorter than five minutes are rejected", () => {
  assert.throws(() => evaluateSdpnTeleportWindow(makeWindow(1, {
    endMs: 300_001
  })), /exactly five minutes/);
  assert.throws(() => evaluateSdpnTeleportWindow(makeWindow(1, {
    endMs: 299_999
  })), /exactly five minutes/);
});

test("a broken five-minute sequence restarts qualification instead of redirecting", async () => {
  const events = [];
  const gate = makeGate(events);
  await gate.observe(makeWindow(1));
  await gate.observe(makeWindow(2));
  const broken = await gate.observe(makeWindow(3, {
    startMs: 660_001,
    endMs: 960_001
  }));
  assert.equal(broken.action, "CONTINUE_BASELINE_QUALIFICATION");
  assert.equal(broken.qualifyingWindows, 1);
  assert.equal(events.length, 0);
  assert.equal(gate.state, "BASELINE");
});

test("one route-free session cannot reuse qualification for another peer or workload", async () => {
  const events = [];
  const gate = makeGate(events);
  await gate.observe(makeWindow(1));
  await gate.observe(makeWindow(2));
  const changed = makeWindow(3);
  changed.workloadId = "different-state-size";
  const result = await gate.observe(changed);
  assert.equal(result.qualifyingWindows, 1);
  assert.equal(events.length, 0);
});
