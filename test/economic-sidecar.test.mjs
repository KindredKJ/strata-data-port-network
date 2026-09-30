import test from "node:test";
import assert from "node:assert/strict";

import {
  KindredEconomicSidecar,
  KINDRED_ECONOMIC_PROTOCOLS,
} from "../src/economic-sidecar.mjs";

const fixedClock = () => new Date("2026-09-30T06:00:00.000Z");
const fixedId = () => "receipt-1";

function createSidecar(overrides = {}) {
  return new KindredEconomicSidecar({
    component: "SDPN",
    clock: fixedClock,
    idFactory: fixedId,
    ...overrides,
  });
}

function registerDefault(sidecar) {
  return sidecar.registerCapability({
    component: "SDPN",
    capability_id: "direct-pipe-worker-transfer",
    version: "0.1.0",
    economic_use: {
      enabled: true,
      pricing_mode: "dynamic",
      minimum_margin: 0.2,
    },
  });
}

test("keeps canonical protocol names", () => {
  assert.deepEqual(KINDRED_ECONOMIC_PROTOCOLS, [
    "K-PRODUCE",
    "K-INFERENCE",
    "K-DATA",
    "K-COMMERCE",
    "K-COMPUTE",
    "K-ENERGY",
    "K-PROCURE",
    "K-CAPITAL",
  ]);
});

test("registers a capability without mutating the base manifest", () => {
  const sidecar = createSidecar();
  const manifest = {
    component: "SDPN",
    capability_id: "direct-pipe-worker-transfer",
    version: "0.1.0",
    economic_use: {
      enabled: true,
      pricing_mode: "dynamic",
      minimum_margin: 0.2,
    },
  };

  sidecar.registerCapability(manifest);
  const registered = sidecar.getCapability("direct-pipe-worker-transfer");
  registered.version = "changed";

  assert.equal(manifest.version, "0.1.0");
  assert.equal(
    sidecar.getCapability("direct-pipe-worker-transfer").version,
    "0.1.0",
  );
});

test("blocks economic work from taking precedence over P0-P2 workloads", () => {
  const sidecar = createSidecar();

  assert.equal(sidecar.evaluateResources({ priority: "P1" }).allowed, false);
  assert.equal(sidecar.evaluateResources({ priority: "P3" }).allowed, true);
});

test("enforces side-system resource ceilings", () => {
  const sidecar = createSidecar({
    policy: {
      maxCpuPercent: 10,
      maxMemoryMiB: 128,
      maxBandwidthMbps: 25,
    },
  });

  const decision = sidecar.evaluateResources({
    priority: "P4",
    cpuPercent: 11,
    memoryMiB: 129,
    bandwidthMbps: 26,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasons.length, 3);
});

test("creates S0 to S1 receipt with provenance hashes", () => {
  const sidecar = createSidecar();
  registerDefault(sidecar);

  const receipt = sidecar.createTransitionReceipt({
    protocol: "K-COMPUTE",
    capabilityId: "direct-pipe-worker-transfer",
    state0: { status: "idle", bytes: 0 },
    state1: { status: "complete", bytes: 1024 },
    economic: { revenue_cents: 0 },
  });

  assert.equal(receipt.receipt_id, "receipt-1");
  assert.equal(receipt.protocol, "K-COMPUTE");
  assert.notEqual(receipt.s0_hash, receipt.s1_hash);
  assert.equal(receipt.receipt_hash.length, 64);
});

test("observe mode does not settle external value", async () => {
  const sidecar = createSidecar();
  registerDefault(sidecar);
  const quote = sidecar.quote({
    capabilityId: "direct-pipe-worker-transfer",
    quantity: 1,
    unitPriceCents: 100,
  });

  const result = await sidecar.settle({
    protocol: "K-COMPUTE",
    capabilityId: "direct-pipe-worker-transfer",
    quote,
  });

  assert.equal(result.settled, false);
  assert.equal(result.status, "observed");
});

test("active mode fails closed without verified settlement adapter", async () => {
  const sidecar = createSidecar({
    policy: {
      mode: "active",
      maxExternalValueCents: 100,
    },
  });
  registerDefault(sidecar);
  const quote = sidecar.quote({
    capabilityId: "direct-pipe-worker-transfer",
    quantity: 1,
    unitPriceCents: 100,
  });

  await assert.rejects(
    sidecar.settle({
      protocol: "K-COMPUTE",
      capabilityId: "direct-pipe-worker-transfer",
      quote,
    }),
    /no verified settlement adapter configured/,
  );
});
