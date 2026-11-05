export const SDPN_TELEPORT_PERFORMANCE_WINDOW_V1 =
  "kindred.sdpn.teleport-performance-window.v1";
export const SDPN_QUIC_PROFILE_ID_V1 = "kindred.sdpn.quic-wire.v1";
export const SDPN_ACTIVATION_REQUIRED_WINDOWS = 3;
export const SDPN_ACTIVATION_WINDOW_MS = 5 * 60 * 1000;
export const SDPN_ACTIVATION_MIN_SUCCESSFUL_PAIRS = 60;
export const SDPN_ACTIVATION_MAX_ATTEMPTS = 300;
export const SDPN_ACTIVATION_MAX_GAP_MS = 30_000;
export const SDPN_LOCAL_REDIRECT_LEASE_MS = 6 * 60 * 1000;
export const SDPN_ACTIVATION_SCOPE = "LOCAL_SDPN_SESSION";

const BASELINE_TRANSPORT = "HTTP_TCP_AES_256_GCM_BUFFERED";
const CANDIDATE_TRANSPORT = "SDPN_QUIC_STREAM_V1";
const PORT_ID_PATTERN = /^strata:port:ed25519:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function exactObjectFields(value, expected, name) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length ||
      actual.some((field, index) => field !== wanted[index])) {
    throw new TypeError(`${name} fields rejected`);
  }
}

function validText(value, max, name) {
  if (typeof value !== "string" || value.length < 1 ||
      value.length > max || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${name} must be bounded text`);
  }
}

function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length < 1) {
    throw new RangeError("latency sample set is empty");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function validateWindow(window) {
  exactObjectFields(window, [
    "schema",
    "profileId",
    "operatorNetworkId",
    "sequence",
    "sessionId",
    "peerPortId",
    "workloadId",
    "payloadBytes",
    "windowStartMs",
    "windowEndMs",
    "baselineTransport",
    "candidateTransport",
    "operatorVerifiedPhysicalHosts",
    "qualificationReceiptSha256",
    "samples"
  ], "performance window");

  if (window.schema !== SDPN_TELEPORT_PERFORMANCE_WINDOW_V1 ||
      window.profileId !== SDPN_QUIC_PROFILE_ID_V1) {
    throw new Error("performance window schema/profile rejected");
  }
  validText(window.operatorNetworkId, 128, "operatorNetworkId");
  if (!Number.isSafeInteger(window.sequence) || window.sequence < 1) {
    throw new RangeError("window sequence must be a positive safe integer");
  }
  if (typeof window.sessionId !== "string" || !UUID_PATTERN.test(window.sessionId)) {
    throw new TypeError("sessionId must be a UUID");
  }
  if (typeof window.peerPortId !== "string" || !PORT_ID_PATTERN.test(window.peerPortId)) {
    throw new TypeError("peerPortId must be an SDPN Ed25519 Port ID");
  }
  validText(window.workloadId, 128, "workloadId");
  if (!Number.isSafeInteger(window.payloadBytes) ||
      window.payloadBytes < 1 || window.payloadBytes > 32 * 1024 * 1024) {
    throw new RangeError("payloadBytes exceeds SDPN session bounds");
  }
  if (!Number.isSafeInteger(window.windowStartMs) ||
      !Number.isSafeInteger(window.windowEndMs) ||
      window.windowEndMs - window.windowStartMs !== SDPN_ACTIVATION_WINDOW_MS) {
    throw new RangeError("performance window must span exactly five minutes");
  }
  if (window.baselineTransport !== BASELINE_TRANSPORT ||
      window.candidateTransport !== CANDIDATE_TRANSPORT) {
    throw new Error("performance transport pair rejected");
  }
  if (window.operatorVerifiedPhysicalHosts !== true ||
      typeof window.qualificationReceiptSha256 !== "string" ||
      !SHA256_PATTERN.test(window.qualificationReceiptSha256)) {
    throw new Error("operator-verified physical-host qualification is required");
  }
  if (!Array.isArray(window.samples) ||
      window.samples.length < SDPN_ACTIVATION_MIN_SUCCESSFUL_PAIRS ||
      window.samples.length > SDPN_ACTIVATION_MAX_ATTEMPTS) {
    throw new RangeError("paired sample count is outside profile bounds");
  }

  const baseline = [];
  const candidate = [];
  const pairedBaseline = [];
  const pairedCandidate = [];
  for (const sample of window.samples) {
    exactObjectFields(sample, ["baselineLatencyUs", "candidateLatencyUs"], "paired sample");
    for (const [field, output] of [
      ["baselineLatencyUs", baseline],
      ["candidateLatencyUs", candidate]
    ]) {
      const value = sample[field];
      if (value === null) continue;
      if (!Number.isSafeInteger(value) || value < 1 || value > 60_000_000) {
        throw new RangeError(`${field} must be null or a bounded positive integer`);
      }
      output.push(value);
    }
    if (sample.baselineLatencyUs !== null && sample.candidateLatencyUs !== null) {
      pairedBaseline.push(sample.baselineLatencyUs);
      pairedCandidate.push(sample.candidateLatencyUs);
    }
  }
  if (pairedBaseline.length < SDPN_ACTIVATION_MIN_SUCCESSFUL_PAIRS) {
    throw new RangeError("at least 60 successful paired samples are required");
  }

  const baselineLosses = window.samples.length - baseline.length;
  const candidateLosses = window.samples.length - candidate.length;
  const baselineP95Us = percentile(pairedBaseline, 0.95);
  const candidateP95Us = percentile(pairedCandidate, 0.95);
  const baselineP99Us = percentile(pairedBaseline, 0.99);
  const candidateP99Us = percentile(pairedCandidate, 0.99);
  const p95ImprovedByFortyPercent =
    candidateP95Us * 100 <= baselineP95Us * 60;
  const p99GuardrailPassed = candidateP99Us <= baselineP99Us;
  const packetLossGuardrailPassed = candidateLosses <= baselineLosses;

  return Object.freeze({
    eligible: p95ImprovedByFortyPercent &&
      p99GuardrailPassed && packetLossGuardrailPassed,
    p95ImprovedByFortyPercent,
    p99GuardrailPassed,
    packetLossGuardrailPassed,
    baselineP95Us,
    candidateP95Us,
    baselineP99Us,
    candidateP99Us,
    baselineLosses,
    candidateLosses,
    successfulPairedSamples: pairedBaseline.length,
    successfulBaselineSamples: baseline.length,
    successfulCandidateSamples: candidate.length
  });
}

export function evaluateSdpnTeleportWindow(window) {
  return validateWindow(window);
}

function seriesKey(window) {
  return [
    window.operatorNetworkId,
    window.sessionId.toLowerCase(),
    window.peerPortId,
    window.workloadId,
    String(window.payloadBytes),
    window.qualificationReceiptSha256.toLowerCase()
  ].join("|");
}

function areConsecutive(previous, current) {
  if (!previous) return true;
  return seriesKey(previous) === seriesKey(current) &&
    current.sequence === previous.sequence + 1 &&
    current.windowStartMs >= previous.windowEndMs &&
    current.windowStartMs - previous.windowEndMs <= SDPN_ACTIVATION_MAX_GAP_MS;
}

function activationTarget(window, evaluation) {
  return Object.freeze({
    scope: SDPN_ACTIVATION_SCOPE,
    action: "REDIRECT_MATCHING_SDPN_SESSION_LOCALLY",
    profileId: SDPN_QUIC_PROFILE_ID_V1,
    operatorNetworkId: window.operatorNetworkId,
    sessionId: window.sessionId,
    peerPortId: window.peerPortId,
    workloadId: window.workloadId,
    payloadBytes: window.payloadBytes,
    qualificationReceiptSha256: window.qualificationReceiptSha256,
    qualifyingWindowSequence: window.sequence,
    leaseExpiresAtMs: window.windowEndMs + SDPN_LOCAL_REDIRECT_LEASE_MS,
    routeTableChanges: false,
    evaluation
  });
}

function baselineTarget(window, reason) {
  return Object.freeze({
    scope: SDPN_ACTIVATION_SCOPE,
    action: "RESTORE_MATCHING_SDPN_SESSION_BASELINE",
    operatorNetworkId: window?.operatorNetworkId ?? null,
    sessionId: window?.sessionId ?? null,
    peerPortId: window?.peerPortId ?? null,
    reason,
    routeTableChanges: false
  });
}

export class SdpnTeleportActivationGate {
  #redirectLocally;
  #renewLocalRedirectLease;
  #restoreLocalBaseline;
  #verifyPerformanceWindow;
  #state = "BASELINE";
  #windows = [];
  #activeWindow = null;

  constructor({
    redirectLocally,
    renewLocalRedirectLease,
    restoreLocalBaseline,
    verifyPerformanceWindow
  } = {}) {
    for (const [name, callback] of [
      ["verifyPerformanceWindow", verifyPerformanceWindow],
      ["redirectLocally", redirectLocally],
      ["renewLocalRedirectLease", renewLocalRedirectLease],
      ["restoreLocalBaseline", restoreLocalBaseline]
    ]) {
      if (typeof callback !== "function") {
        throw new TypeError(`${name} callback is required`);
      }
    }
    this.#verifyPerformanceWindow = verifyPerformanceWindow;
    this.#redirectLocally = redirectLocally;
    this.#renewLocalRedirectLease = renewLocalRedirectLease;
    this.#restoreLocalBaseline = restoreLocalBaseline;
  }

  get state() {
    return this.#state;
  }

  async observe(window) {
    let evaluation;
    try {
      evaluation = validateWindow(window);
      if (await this.#verifyPerformanceWindow(window) !== true) {
        throw new Error("signed performance evidence verification failed");
      }
    } catch (error) {
      await this.#restoreIfActive("INVALID_OR_MISSING_PERFORMANCE_WINDOW");
      this.#resetQualification();
      return Object.freeze({
        state: this.#state,
        action: "KEEP_BASELINE",
        reason: "INVALID_OR_MISSING_PERFORMANCE_WINDOW",
        detail: error instanceof Error ? error.message : String(error)
      });
    }

    if (!evaluation.eligible) {
      await this.#restoreIfActive("PERFORMANCE_TARGET_MISSED");
      this.#resetQualification();
      return Object.freeze({
        state: this.#state,
        action: "KEEP_BASELINE",
        reason: "PERFORMANCE_TARGET_MISSED",
        evaluation
      });
    }

    if (this.#state === "ACTIVE") {
      if (!areConsecutive(this.#activeWindow, window)) {
        await this.#restoreIfActive("SUSTAINED_WINDOW_SEQUENCE_BROKEN");
        this.#resetQualification();
      } else {
        const target = activationTarget(window, evaluation);
        try {
          await this.#renewLocalRedirectLease(target);
        } catch {
          await this.#restoreIfActive("LOCAL_REDIRECT_LEASE_RENEWAL_FAILED");
          this.#resetQualification();
          return Object.freeze({
            state: this.#state,
            action: "KEEP_BASELINE",
            reason: "LOCAL_REDIRECT_LEASE_RENEWAL_FAILED"
          });
        }
        this.#activeWindow = window;
        return Object.freeze({
          state: this.#state,
          action: "RENEW_LOCAL_REDIRECT_LEASE",
          target
        });
      }
    }

    const previous = this.#windows.at(-1);
    if (previous && !areConsecutive(previous, window)) {
      this.#resetQualification();
    }
    this.#windows.push(window);
    if (this.#windows.length > SDPN_ACTIVATION_REQUIRED_WINDOWS) {
      this.#windows.shift();
    }

    if (this.#windows.length < SDPN_ACTIVATION_REQUIRED_WINDOWS) {
      return Object.freeze({
        state: this.#state,
        action: "CONTINUE_BASELINE_QUALIFICATION",
        qualifyingWindows: this.#windows.length,
        requiredWindows: SDPN_ACTIVATION_REQUIRED_WINDOWS,
        evaluation
      });
    }

    const target = activationTarget(window, evaluation);
    try {
      await this.#redirectLocally(target);
    } catch {
      this.#resetQualification();
      return Object.freeze({
        state: "BASELINE",
        action: "KEEP_BASELINE",
        reason: "LOCAL_ADAPTER_REDIRECT_FAILED"
      });
    }
    this.#state = "ACTIVE";
    this.#activeWindow = window;
    return Object.freeze({
      state: this.#state,
      action: "ACTIVATE_LOCAL_REDIRECT",
      target
    });
  }

  async #restoreIfActive(reason) {
    if (this.#state !== "ACTIVE") return;
    const target = baselineTarget(this.#activeWindow, reason);
    await this.#restoreLocalBaseline(target);
    this.#state = "BASELINE";
    this.#activeWindow = null;
  }

  #resetQualification() {
    this.#windows = [];
    this.#activeWindow = null;
  }
}
