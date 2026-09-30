import { createHash, randomUUID } from "node:crypto";

export const KINDRED_ECONOMIC_PROTOCOLS = Object.freeze([
  "K-PRODUCE",
  "K-INFERENCE",
  "K-DATA",
  "K-COMMERCE",
  "K-COMPUTE",
  "K-ENERGY",
  "K-PROCURE",
  "K-CAPITAL",
]);

export const KINDRED_WORKLOAD_PRIORITIES = Object.freeze([
  "P0",
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
]);

const DEFAULT_POLICY = Object.freeze({
  mode: "observe",
  minimumEconomicPriority: "P3",
  maxCpuPercent: 20,
  maxMemoryMiB: 512,
  maxBandwidthMbps: 100,
  maxExternalValueCents: 0,
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
}

function priorityIndex(priority) {
  const index = KINDRED_WORKLOAD_PRIORITIES.indexOf(priority);
  if (index === -1) throw new RangeError(`unknown workload priority: ${priority}`);
  return index;
}

/**
 * Additive economic plane for existing Kindred capabilities.
 *
 * The sidecar never mutates the registered base capability manifest.
 * Existing SDPN behavior remains independent of this module.
 */
export class KindredEconomicSidecar {
  #component;
  #clock;
  #idFactory;
  #policy;
  #capabilities = new Map();
  #settlementAdapter;

  constructor({
    component,
    policy = {},
    settlementAdapter = null,
    clock = () => new Date(),
    idFactory = randomUUID,
  } = {}) {
    assertNonEmptyString(component, "component");

    const merged = { ...DEFAULT_POLICY, ...policy };
    if (!["observe", "active"].includes(merged.mode)) {
      throw new RangeError("policy.mode must be observe or active");
    }
    priorityIndex(merged.minimumEconomicPriority);

    for (const [field, value] of [
      ["maxCpuPercent", merged.maxCpuPercent],
      ["maxMemoryMiB", merged.maxMemoryMiB],
      ["maxBandwidthMbps", merged.maxBandwidthMbps],
      ["maxExternalValueCents", merged.maxExternalValueCents],
    ]) {
      assertNonNegativeInteger(value, field);
    }

    if (merged.maxCpuPercent > 100) {
      throw new RangeError("maxCpuPercent cannot exceed 100");
    }

    this.#component = component;
    this.#policy = Object.freeze({ ...merged });
    this.#settlementAdapter = settlementAdapter;
    this.#clock = clock;
    this.#idFactory = idFactory;
  }

  get policy() {
    return { ...this.#policy };
  }

  registerCapability(manifest) {
    if (!manifest || typeof manifest !== "object") {
      throw new TypeError("manifest must be an object");
    }

    assertNonEmptyString(manifest.capability_id, "manifest.capability_id");

    const registered = clone({
      component: manifest.component ?? this.#component,
      capability_id: manifest.capability_id,
      version: manifest.version ?? "0.0.0",
      inputs: manifest.inputs ?? {},
      outputs: manifest.outputs ?? {},
      resource_cost: manifest.resource_cost ?? {},
      permissions: manifest.permissions ?? [],
      availability: manifest.availability ?? "available",
      economic_use: {
        enabled: Boolean(manifest.economic_use?.enabled),
        pricing_mode: manifest.economic_use?.pricing_mode ?? "manual",
        minimum_margin: manifest.economic_use?.minimum_margin ?? 0,
      },
    });

    this.#capabilities.set(registered.capability_id, registered);
    return clone(registered);
  }

  listCapabilities() {
    return [...this.#capabilities.values()].map(clone);
  }

  getCapability(capabilityId) {
    const capability = this.#capabilities.get(capabilityId);
    return capability ? clone(capability) : null;
  }

  quote({ capabilityId, quantity = 1, unitPriceCents }) {
    assertNonEmptyString(capabilityId, "capabilityId");
    assertNonNegativeInteger(quantity, "quantity");
    assertNonNegativeInteger(unitPriceCents, "unitPriceCents");

    const capability = this.#capabilities.get(capabilityId);
    if (!capability) throw new Error(`unknown capability: ${capabilityId}`);
    if (!capability.economic_use.enabled) {
      throw new Error(`economic use disabled for capability: ${capabilityId}`);
    }

    return Object.freeze({
      capability_id: capabilityId,
      quantity,
      unit_price_cents: unitPriceCents,
      total_price_cents: quantity * unitPriceCents,
      currency: "USD",
    });
  }

  evaluateResources({
    priority = "P4",
    cpuPercent = 0,
    memoryMiB = 0,
    bandwidthMbps = 0,
  } = {}) {
    const requestedPriority = priorityIndex(priority);
    const minimumEconomicPriority = priorityIndex(this.#policy.minimumEconomicPriority);

    for (const [field, value] of [
      ["cpuPercent", cpuPercent],
      ["memoryMiB", memoryMiB],
      ["bandwidthMbps", bandwidthMbps],
    ]) {
      assertNonNegativeInteger(value, field);
    }

    const reasons = [];
    if (requestedPriority < minimumEconomicPriority) {
      reasons.push("higher-priority Kindred workload has precedence");
    }
    if (cpuPercent > this.#policy.maxCpuPercent) {
      reasons.push("CPU side-system budget exceeded");
    }
    if (memoryMiB > this.#policy.maxMemoryMiB) {
      reasons.push("memory side-system budget exceeded");
    }
    if (bandwidthMbps > this.#policy.maxBandwidthMbps) {
      reasons.push("bandwidth side-system budget exceeded");
    }

    return Object.freeze({
      allowed: reasons.length === 0,
      reasons,
    });
  }

  createTransitionReceipt({
    protocol,
    capabilityId,
    state0,
    state1,
    economic = {},
  }) {
    if (!KINDRED_ECONOMIC_PROTOCOLS.includes(protocol)) {
      throw new RangeError(`unknown economic protocol: ${protocol}`);
    }
    assertNonEmptyString(capabilityId, "capabilityId");

    if (!this.#capabilities.has(capabilityId)) {
      throw new Error(`unknown capability: ${capabilityId}`);
    }

    const timestamp = this.#clock().toISOString();
    const transition = {
      component: this.#component,
      protocol,
      capability_id: capabilityId,
      s0_hash: sha256(state0),
      s1_hash: sha256(state1),
      economic: clone(economic),
      timestamp,
    };

    return Object.freeze({
      receipt_id: this.#idFactory(),
      ...transition,
      receipt_hash: sha256(transition),
    });
  }

  async settle({
    protocol,
    capabilityId,
    quote,
    externalValueCents = quote?.total_price_cents ?? 0,
    metadata = {},
  }) {
    if (!KINDRED_ECONOMIC_PROTOCOLS.includes(protocol)) {
      throw new RangeError(`unknown economic protocol: ${protocol}`);
    }
    assertNonEmptyString(capabilityId, "capabilityId");
    assertNonNegativeInteger(externalValueCents, "externalValueCents");

    const capability = this.#capabilities.get(capabilityId);
    if (!capability) throw new Error(`unknown capability: ${capabilityId}`);
    if (!capability.economic_use.enabled) {
      throw new Error(`economic use disabled for capability: ${capabilityId}`);
    }

    if (this.#policy.mode !== "active") {
      return Object.freeze({
        status: "observed",
        settled: false,
        reason: "economic sidecar is in observe mode",
      });
    }

    if (externalValueCents > this.#policy.maxExternalValueCents) {
      throw new Error("external value exceeds configured side-system authority");
    }

    if (!this.#settlementAdapter || typeof this.#settlementAdapter.settle !== "function") {
      throw new Error("settlement denied: no verified settlement adapter configured");
    }

    const result = await this.#settlementAdapter.settle({
      component: this.#component,
      protocol,
      capability_id: capabilityId,
      quote: clone(quote),
      external_value_cents: externalValueCents,
      metadata: clone(metadata),
    });

    return Object.freeze({
      status: "settled",
      settled: true,
      result: clone(result),
    });
  }
}
