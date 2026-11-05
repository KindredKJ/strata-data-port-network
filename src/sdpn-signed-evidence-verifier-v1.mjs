// Kindred Jermaine Cox / Kindred Labs. SDPN signed physical evidence verifier v1.
import { createHash, verify as verifySignature } from "node:crypto";
import { canonicalBytes, decodePublicKey } from "./native-port-identity.mjs";
import { evaluateSdpnTeleportWindow } from "./sdpn-teleport-activation-gate-v1.mjs";

export const SDPN_SIGNED_PERFORMANCE_EVIDENCE_V1 =
  "kindred.sdpn.signed-performance-evidence.v1";
export const SDPN_PHYSICAL_QUALIFICATION_RECEIPT_V1 =
  "kindred.sdpn.physical-host-qualification.v1";
export const SDPN_EVIDENCE_MAX_WINDOW_AGE_MS = 10 * 60 * 1000;
export const SDPN_EVIDENCE_MAX_FUTURE_SKEW_MS = 30 * 1000;
export const SDPN_EVIDENCE_MAX_QUALIFICATION_TTL_MS = 12 * 60 * 60 * 1000;

const PROFILE_ID = "kindred.sdpn.quic-wire.v1";
const HEX_256 = /^[0-9a-f]{64}$/;
const HOST_FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PORT_ID = /^strata:port:ed25519:[0-9a-f]{64}$/;

function exactFields(value, expected, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((field, index) => field !== wanted[index])) {
    throw new TypeError(`${label} fields rejected`);
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifySignedBody(envelope, trust, label) {
  exactFields(envelope, ["body", "keyId", "signature"], `${label} envelope`);
  if (typeof envelope.keyId !== "string" || !HEX_256.test(envelope.keyId)) {
    throw new TypeError(`${label} keyId rejected`);
  }
  if (typeof envelope.signature !== "string" || envelope.signature.length !== 88) {
    throw new TypeError(`${label} signature encoding rejected`);
  }
  const publicKeyDerBase64 = trust[envelope.keyId];
  if (typeof publicKeyDerBase64 !== "string") {
    throw new Error(`${label} signer is not trusted`);
  }
  const publicKeyDer = Buffer.from(publicKeyDerBase64, "base64");
  if (publicKeyDer.toString("base64") !== publicKeyDerBase64 || digest(publicKeyDer) !== envelope.keyId) {
    throw new Error(`${label} trust anchor fingerprint rejected`);
  }
  const signature = Buffer.from(envelope.signature, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== envelope.signature ||
      !verifySignature(null, canonicalBytes(envelope.body), decodePublicKey(publicKeyDerBase64, "ed25519"), signature)) {
    throw new Error(`${label} Ed25519 signature rejected`);
  }
  return envelope.body;
}

function validTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} rejected`);
}

function verifyQualificationReceipt(receipt, window, witnessTrust, nowMs) {
  const body = verifySignedBody(receipt, witnessTrust, "physical qualification");
  exactFields(body, [
    "schema", "profileId", "operatorNetworkId", "sessionId", "peerPortId", "workloadId",
    "payloadBytes", "issuedAtMs", "expiresAtMs", "baselineHostId", "candidateHostId",
    "independentPhysicalHosts", "virtualized", "witnessMethod", "networkPathSha256",
    "routeTableChanges", "publicExposure"
  ], "physical qualification body");
  if (body.schema !== SDPN_PHYSICAL_QUALIFICATION_RECEIPT_V1 || body.profileId !== PROFILE_ID ||
      body.operatorNetworkId !== window.operatorNetworkId || body.sessionId !== window.sessionId ||
      body.peerPortId !== window.peerPortId || body.workloadId !== window.workloadId ||
      body.payloadBytes !== window.payloadBytes) {
    throw new Error("physical qualification binding rejected");
  }
  validTime(body.issuedAtMs, "physical qualification issuedAtMs");
  validTime(body.expiresAtMs, "physical qualification expiresAtMs");
  if (body.expiresAtMs <= body.issuedAtMs ||
      body.expiresAtMs - body.issuedAtMs > SDPN_EVIDENCE_MAX_QUALIFICATION_TTL_MS ||
      body.issuedAtMs > window.windowStartMs || body.expiresAtMs < window.windowEndMs ||
      body.issuedAtMs > nowMs + SDPN_EVIDENCE_MAX_FUTURE_SKEW_MS || body.expiresAtMs <= nowMs) {
    throw new Error("physical qualification freshness rejected");
  }
  if (typeof body.baselineHostId !== "string" || !HOST_FINGERPRINT.test(body.baselineHostId) ||
      typeof body.candidateHostId !== "string" || !HOST_FINGERPRINT.test(body.candidateHostId) ||
      body.baselineHostId === body.candidateHostId ||
      body.independentPhysicalHosts !== true || body.virtualized !== false ||
      body.witnessMethod !== "INDEPENDENT_PHYSICAL_WITNESS" ||
      typeof body.networkPathSha256 !== "string" || !HEX_256.test(body.networkPathSha256) ||
      body.routeTableChanges !== false || body.publicExposure !== false) {
    throw new Error("physical qualification claims rejected");
  }
  return Object.freeze({
    witnessKeyId: receipt.keyId,
    baselineHostId: body.baselineHostId,
    candidateHostId: body.candidateHostId,
    networkPathSha256: body.networkPathSha256
  });
}

/**
 * Verify a window and its independent physical-host witness receipt against
 * operator-configured Ed25519 trust anchors. Public keys in evidence are never
 * trusted on their own. A witness signature verifies who made the qualification
 * statement; it does not replace an independent review of the physical setup.
 */
export function verifySdpnSignedPerformanceEvidenceV1({
  window,
  evidence,
  trustedOperatorKeys,
  trustedPhysicalWitnessKeys,
  nowMs = Date.now(),
  maxWindowAgeMs = SDPN_EVIDENCE_MAX_WINDOW_AGE_MS
}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(maxWindowAgeMs) || maxWindowAgeMs < 0) {
    throw new RangeError("evidence verifier clock bounds rejected");
  }
  if (!window || typeof window !== "object" || !UUID.test(window.sessionId ?? "") ||
      !PORT_ID.test(window.peerPortId ?? "")) {
    throw new TypeError("performance window identity rejected");
  }
  const evaluation = evaluateSdpnTeleportWindow(window);
  if (!evaluation.eligible) throw new Error("signed performance window does not meet activation guardrails");
  exactFields(evidence, ["schema", "performance", "physicalQualification"], "signed evidence");
  if (evidence.schema !== SDPN_SIGNED_PERFORMANCE_EVIDENCE_V1) {
    throw new Error("signed evidence schema rejected");
  }
  if (!trustedOperatorKeys || Object.getPrototypeOf(trustedOperatorKeys) !== Object.prototype ||
      !trustedPhysicalWitnessKeys || Object.getPrototypeOf(trustedPhysicalWitnessKeys) !== Object.prototype) {
    throw new TypeError("operator and physical witness trust maps are required");
  }

  const signedWindow = verifySignedBody(evidence.performance, trustedOperatorKeys, "performance");
  if (!canonicalBytes(signedWindow).equals(canonicalBytes(window))) {
    throw new Error("signed performance window does not match measured window");
  }
  validTime(window.windowStartMs, "windowStartMs");
  validTime(window.windowEndMs, "windowEndMs");
  if (window.windowEndMs > nowMs + SDPN_EVIDENCE_MAX_FUTURE_SKEW_MS ||
      nowMs - window.windowEndMs > maxWindowAgeMs) {
    throw new Error("performance window freshness rejected");
  }

  const qualification = evidence.physicalQualification;
  const verifiedQualification = verifyQualificationReceipt(
    qualification,
    window,
    trustedPhysicalWitnessKeys,
    nowMs
  );
  if (qualification.keyId === evidence.performance.keyId) {
    throw new Error("performance signer and physical witness must be distinct");
  }
  const qualificationDigest = digest(canonicalBytes(qualification));
  if (window.qualificationReceiptSha256 !== qualificationDigest ||
      window.operatorVerifiedPhysicalHosts !== true) {
    throw new Error("performance window qualification receipt binding rejected");
  }

  return Object.freeze({
    valid: true,
    schema: SDPN_SIGNED_PERFORMANCE_EVIDENCE_V1,
    performanceKeyId: evidence.performance.keyId,
    witnessKeyId: verifiedQualification.witnessKeyId,
    qualificationReceiptSha256: qualificationDigest,
    performanceWindowSha256: digest(canonicalBytes(window)),
    physicalHostIds: Object.freeze([
      verifiedQualification.baselineHostId,
      verifiedQualification.candidateHostId
    ]),
    networkPathSha256: verifiedQualification.networkPathSha256
  });
}

export function createSdpnSignedPerformanceEvidenceVerifierV1({
  resolveEvidence,
  trustedOperatorKeys,
  trustedPhysicalWitnessKeys,
  now = () => Date.now(),
  maxWindowAgeMs = SDPN_EVIDENCE_MAX_WINDOW_AGE_MS
} = {}) {
  if (typeof resolveEvidence !== "function" || typeof now !== "function") {
    throw new TypeError("resolveEvidence and now functions are required");
  }
  return async window => {
    try {
      const evidence = await resolveEvidence(window);
      verifySdpnSignedPerformanceEvidenceV1({
        window,
        evidence,
        trustedOperatorKeys,
        trustedPhysicalWitnessKeys,
        nowMs: now(),
        maxWindowAgeMs
      });
      return true;
    } catch {
      return false;
    }
  };
}
