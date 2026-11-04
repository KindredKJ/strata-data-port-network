import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SDPNPortOrchestrator } from "../src/port-orchestrator.mjs";
import { toStrataCastRenderFrame } from "../src/stratacast-topology-bridge.mjs";
import {
  signTopologyAttestation, verifyTopologyAttestation
} from "../src/topology-attestation.mjs";

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicPem: publicKey.export({ type: "spki", format: "pem" })
  };
}
const now = 1800000000000;
const frame = {
  schemaVersion: "stratacast.kindred/v1", kind: "RenderFrame",
  worldId: "sdpn.network.topology", sourceTick: 10, sourceSequence: 10,
  objects: [{ entityId: "sdpn.port:test-1", assetId: "sdpn.port.healthy",
    position: { x: 1, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }]
};
const hash = "f".repeat(64);

test("verified Ed25519 topology binds source journal, frame and bounded validity", () => {
  const { privatePem, publicPem } = keys();
  const a = signTopologyAttestation({ frame, journalHash: hash,
    privateKeyPem: privatePem, issuedAtMs: now, expiresAtMs: now + 300000 });
  const verified = verifyTopologyAttestation(a, publicPem, now + 1000);
  assert.equal(verified.journalHash, hash);
  assert.equal(verified.frame.sourceSequence, 10);
  assert.equal(verified.topologyAuthenticityVerified, true);
  assert.equal(verified.publicNetworkOperational, false);
  const mutations = [
    { ...a, journalHash: "a".repeat(64) },
    { ...a, frame: { ...a.frame, sourceSequence: 11, sourceTick: 11 } },
    { ...a, frame: { ...a.frame, objects: [] } },
    { ...a, signature: "A".repeat(86) }
  ];
  for (const mutated of mutations) {
    assert.throws(() => verifyTopologyAttestation(mutated, publicPem, now + 1000));
  }
  assert.throws(() => verifyTopologyAttestation(a, keys().publicPem, now + 1000), /not present/);
  assert.throws(() => verifyTopologyAttestation(a, publicPem, now + 300000), /expired/);
  assert.throws(() => verifyTopologyAttestation(a, publicPem, now - 40000), /expired/);
  assert.throws(() => signTopologyAttestation({
    frame, journalHash: hash, privateKeyPem: privatePem,
    issuedAtMs: now, expiresAtMs: now + 3600000
  }), /expired/);
});

test("CLI signs exact, durable SDPN journal and never overwrites evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "sdpn-attest-"));
  const journalPath = join(root, "journal.ndjson");
  const outputPath = join(root, "proof.json");
  const privatePath = join(root, "signing.pem");
  const k = keys();
  try {
    await writeFile(privatePath, k.privatePem, { mode: 0o600 });
    const coordinator = await SDPNPortOrchestrator.open({
      journalPath, authorize: async () => ({ allowed: true, authorityId: "test" }),
      transport: async () => { throw new Error("never invoked"); }
    });
    let journalHash;
    try {
      await coordinator.registerPort({ actor: "auditor", port: {
        id: "proof-port", ownerId: "tenant", scopes: ["transfer:send"],
        allowedDestinations: [], expiresAt: Date.now() + 60000,
        health: "healthy", identityVerified: true, consentGranted: true
      } });
      const snapshot = coordinator.snapshot();
      assert.equal(toStrataCastRenderFrame(snapshot).objects.length, 1);
      journalHash = snapshot.journalHash;
    } finally { await coordinator.close(); }
    const command = () => execFileSync(process.execPath, [
      "scripts/sign-topology-frame.mjs", "--journal", journalPath,
      "--output", outputPath, "--private-key", privatePath,
      "--acknowledge-trusted-signing"
    ], { encoding: "utf8" });
    const receipt = JSON.parse(command());
    const encoded = await readFile(outputPath, "utf8");
    const attestation = JSON.parse(encoded);
    assert.equal(receipt.signerKeyId, attestation.signerKeyId);
    assert.equal(verifyTopologyAttestation(attestation, k.publicPem).journalHash, journalHash);
    assert.ok(!encoded.includes("tenant"));
    assert.throws(command, /EEXIST/);
    assert.equal(await readFile(outputPath, "utf8"), encoded);
  } finally { await rm(root, { recursive: true, force: true }); }
});
