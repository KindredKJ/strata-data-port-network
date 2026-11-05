import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { canonicalBytes } from "../src/native-port-identity.mjs";
import { SdpnTeleportActivationGate } from "../src/sdpn-teleport-activation-gate-v1.mjs";
import {
  createSdpnSignedPerformanceEvidenceVerifierV1,
  SDPN_PHYSICAL_QUALIFICATION_RECEIPT_V1,
  SDPN_SIGNED_PERFORMANCE_EVIDENCE_V1,
  verifySdpnSignedPerformanceEvidenceV1
} from "../src/sdpn-signed-evidence-verifier-v1.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");

function makeSigner() {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyDer = pair.publicKey.export({ type: "spki", format: "der" });
  const keyId = hash(publicKeyDer);
  return {
    keyId,
    trusted: { [keyId]: publicKeyDer.toString("base64") },
    sign(body) {
      return {
        body,
        keyId,
        signature: sign(null, canonicalBytes(body), pair.privateKey).toString("base64")
      };
    }
  };
}

function makeWindow(sequence, startMs) {
  return {
    schema: "kindred.sdpn.teleport-performance-window.v1",
    profileId: "kindred.sdpn.quic-wire.v1",
    operatorNetworkId: "lab-network-01",
    sequence,
    sessionId: "8f3f2a48-4831-43ea-9ff8-b8ac173976c1",
    peerPortId: `strata:port:ed25519:${"ab".repeat(32)}`,
    workloadId: "native-state-transfer-1mib",
    payloadBytes: 1024 * 1024,
    windowStartMs: startMs,
    windowEndMs: startMs + 300_000,
    baselineTransport: "HTTP_TCP_AES_256_GCM_BUFFERED",
    candidateTransport: "SDPN_QUIC_STREAM_V1",
    operatorVerifiedPhysicalHosts: true,
    qualificationReceiptSha256: "0".repeat(64),
    samples: Array.from({ length: 60 }, () => ({
      baselineLatencyUs: 100_000,
      candidateLatencyUs: 60_000
    }))
  };
}

function makeEvidence(window, operator, witness, options = {}) {
  const physicalBody = {
    schema: SDPN_PHYSICAL_QUALIFICATION_RECEIPT_V1,
    profileId: "kindred.sdpn.quic-wire.v1",
    operatorNetworkId: window.operatorNetworkId,
    sessionId: window.sessionId,
    peerPortId: window.peerPortId,
    workloadId: window.workloadId,
    payloadBytes: window.payloadBytes,
    issuedAtMs: options.issuedAtMs ?? window.windowStartMs - 1_000,
    expiresAtMs: options.expiresAtMs ?? window.windowEndMs + 3_600_000,
    baselineHostId: `sha256:${"11".repeat(32)}`,
    candidateHostId: `sha256:${"22".repeat(32)}`,
    independentPhysicalHosts: true,
    virtualized: false,
    witnessMethod: "INDEPENDENT_PHYSICAL_WITNESS",
    networkPathSha256: "33".repeat(32),
    routeTableChanges: false,
    publicExposure: false
  };
  const physicalQualification = witness.sign(physicalBody);
  window.qualificationReceiptSha256 = hash(canonicalBytes(physicalQualification));
  const performance = operator.sign(window);
  return { schema: SDPN_SIGNED_PERFORMANCE_EVIDENCE_V1, performance, physicalQualification };
}

function verifierArgs(window, evidence, operator, witness, nowMs) {
  return {
    window,
    evidence,
    trustedOperatorKeys: operator.trusted,
    trustedPhysicalWitnessKeys: witness.trusted,
    nowMs
  };
}

test("accepts Ed25519-signed paired measurements and a distinct bound physical witness", () => {
  const operator = makeSigner();
  const witness = makeSigner();
  const window = makeWindow(1, 1_000_000);
  const evidence = makeEvidence(window, operator, witness);
  const verified = verifySdpnSignedPerformanceEvidenceV1(
    verifierArgs(window, evidence, operator, witness, window.windowEndMs + 1_000)
  );
  assert.equal(verified.valid, true);
  assert.equal(verified.performanceKeyId, operator.keyId);
  assert.equal(verified.witnessKeyId, witness.keyId);
  assert.equal(verified.physicalHostIds.length, 2);
});

test("rejects altered samples, unknown signing keys, and wrong physical receipt binding", () => {
  const operator = makeSigner();
  const witness = makeSigner();
  const window = makeWindow(1, 1_000_000);
  const evidence = makeEvidence(window, operator, witness);
  const changedWindow = structuredClone(window);
  changedWindow.samples[0].candidateLatencyUs = 1;
  assert.throws(() => verifySdpnSignedPerformanceEvidenceV1(
    verifierArgs(changedWindow, evidence, operator, witness, window.windowEndMs + 1_000)
  ), /does not match/);

  const unknownOperator = makeSigner();
  assert.throws(() => verifySdpnSignedPerformanceEvidenceV1(
    verifierArgs(window, evidence, unknownOperator, witness, window.windowEndMs + 1_000)
  ), /not trusted/);

  const misbound = structuredClone(evidence);
  misbound.physicalQualification.body.sessionId = "0f3f2a48-4831-43ea-9ff8-b8ac173976c1";
  assert.throws(() => verifySdpnSignedPerformanceEvidenceV1(
    verifierArgs(window, misbound, operator, witness, window.windowEndMs + 1_000)
  ), /signature rejected/);
});

test("rejects virtualized, stale, expired, and same-key physical evidence", () => {
  const operator = makeSigner();
  const witness = makeSigner();
  const window = makeWindow(1, 1_000_000);
  const evidence = makeEvidence(window, operator, witness);
  const virtualized = structuredClone(evidence);
  virtualized.physicalQualification = witness.sign({
    ...evidence.physicalQualification.body,
    virtualized: true
  });
  window.qualificationReceiptSha256 = hash(canonicalBytes(virtualized.physicalQualification));
  const resigned = operator.sign(window);
  virtualized.performance = resigned;
  assert.throws(() => verifySdpnSignedPerformanceEvidenceV1(
    verifierArgs(window, virtualized, operator, witness, window.windowEndMs + 1_000)
  ), /claims rejected/);

  const staleWindow = makeWindow(1, 1_000_000);
  const staleEvidence = makeEvidence(staleWindow, operator, witness);
  assert.throws(() => verifySdpnSignedPerformanceEvidenceV1(
    verifierArgs(staleWindow, staleEvidence, operator, witness, staleWindow.windowEndMs + 600_001)
  ), /freshness rejected/);

  const sharedKeyEvidence = makeEvidence(makeWindow(1, 1_000_000), operator, operator);
  assert.throws(() => verifySdpnSignedPerformanceEvidenceV1({
    ...verifierArgs(sharedKeyEvidence.performance.body, sharedKeyEvidence, operator, operator,
      sharedKeyEvidence.performance.body.windowEndMs + 1_000),
    trustedPhysicalWitnessKeys: operator.trusted
  }), /must be distinct/);
});

test("production callback validates each of three consecutive windows before the gate redirects", async () => {
  const operator = makeSigner();
  const witness = makeSigner();
  const evidenceBySequence = new Map();
  const windows = [1, 2, 3].map(sequence => {
    const window = makeWindow(sequence, 1_000_000 + (sequence - 1) * 300_000);
    evidenceBySequence.set(sequence, makeEvidence(window, operator, witness, {
      issuedAtMs: 900_000,
      expiresAtMs: 3_000_000
    }));
    return window;
  });
  let nowMs = windows[0].windowEndMs + 1_000;
  const verifyPerformanceWindow = createSdpnSignedPerformanceEvidenceVerifierV1({
    resolveEvidence: window => evidenceBySequence.get(window.sequence),
    trustedOperatorKeys: operator.trusted,
    trustedPhysicalWitnessKeys: witness.trusted,
    now: () => nowMs
  });
  const events = [];
  const gate = new SdpnTeleportActivationGate({
    verifyPerformanceWindow,
    redirectLocally: async target => events.push(target),
    renewLocalRedirectLease: async () => {},
    restoreLocalBaseline: async target => events.push(target)
  });

  const first = await gate.observe(windows[0]);
  nowMs = windows[1].windowEndMs + 1_000;
  const second = await gate.observe(windows[1]);
  nowMs = windows[2].windowEndMs + 1_000;
  const third = await gate.observe(windows[2]);
  assert.equal(first.qualifyingWindows, 1);
  assert.equal(second.qualifyingWindows, 2);
  assert.equal(third.action, "ACTIVATE_LOCAL_REDIRECT");
  assert.equal(events.length, 1);
  assert.equal(events[0].routeTableChanges, false);
});

test("missing, malformed, or expired evidence makes the gate keep baseline", async () => {
  const operator = makeSigner();
  const witness = makeSigner();
  const window = makeWindow(1, 1_000_000);
  const evidence = makeEvidence(window, operator, witness);
  const verifyPerformanceWindow = createSdpnSignedPerformanceEvidenceVerifierV1({
    resolveEvidence: () => evidence,
    trustedOperatorKeys: operator.trusted,
    trustedPhysicalWitnessKeys: witness.trusted,
    now: () => window.windowEndMs + 600_001
  });
  let redirects = 0;
  const gate = new SdpnTeleportActivationGate({
    verifyPerformanceWindow,
    redirectLocally: async () => redirects++,
    renewLocalRedirectLease: async () => {},
    restoreLocalBaseline: async () => {}
  });
  for (let i = 0; i < 3; i++) {
    const result = await gate.observe(window);
    assert.equal(result.action, "KEEP_BASELINE");
  }
  assert.equal(gate.state, "BASELINE");
  assert.equal(redirects, 0);
});
