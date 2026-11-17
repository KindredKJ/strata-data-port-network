import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { SDPNPortOrchestrator } from "../src/port-orchestrator.mjs";

test("topology exporter produces a sanitized non-overwriting StrataCast frame", async () => {
  const root = await mkdtemp(join(tmpdir(), "sdpn-topology-export-"));
  const journal = join(root, "journal.ndjson");
  const output = join(root, "render-frame.json");
  try {
    const instance = await SDPNPortOrchestrator.open({
      journalPath: journal,
      authorize: async () => ({ allowed: true, authorityId: "test-authority" }),
      transport: async () => { throw new Error("not used"); },
    });
    try {
      await instance.registerPort({
        actor: "auditor",
        port: { id: "dev1", ownerId: "tenant", scopes: ["transfer:send"],
          allowedDestinations: [], expiresAt: Date.now() + 60000,
          identityVerified: true, consentGranted: true, health: "healthy" }
      });
    } finally { await instance.close(); }
    const cmd = (args) => execFileSync(process.execPath,
      ["scripts/export-topology-frame.mjs", ...args], { encoding: "utf8" });
    assert.throws(() => cmd(["--journal", journal, "--output", output]), /acknowledge-local-topology/);
    const receipt = JSON.parse(cmd([
      "--journal", journal, "--output", output, "--acknowledge-local-topology"
    ]));
    assert.equal(receipt.transportExecuted, false);
    assert.equal(receipt.portCount, 1);
    const json = await readFile(output, "utf8");
    const frame = JSON.parse(json);
    assert.equal(frame.schemaVersion, "stratacast.kindred/v1");
    assert.equal(frame.objects[0].assetId, "sdpn.port.healthy");
    assert.equal(json.includes("tenant"), false);
    assert.equal(json.includes("transfer:send"), false);
    assert.throws(() => cmd(["--journal", journal, "--output", output,
      "--acknowledge-local-topology"]), /EEXIST/);
    assert.equal(await readFile(output, "utf8"), json);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
