import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { SDPNPortOrchestrator } from "../src/port-orchestrator.mjs";
import { toStrataCastRenderFrame } from "../src/stratacast-topology-bridge.mjs";

const { values } = parseArgs({
  strict: true,
  options: {
    journal: { type: "string" },
    output: { type: "string" },
    "acknowledge-local-topology": { type: "boolean" },
  },
});

if (!values.journal || !values.output || values["acknowledge-local-topology"] !== true) {
  process.stderr.write(
    "Usage: node scripts/export-topology-frame.mjs --journal <absolute-existing-journal> " +
    "--output <new-local-output.json> --acknowledge-local-topology\n"
  );
  process.exitCode = 2;
} else {
  const journalPath = resolve(values.journal);
  const outputPath = resolve(values.output);
  if (journalPath === outputPath || outputPath === journalPath + ".lock") {
    throw new Error("Output cannot overwrite SDPN audit journal or its lock");
  }
  const metadata = await stat(journalPath);
  if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024) {
    throw new Error("A bounded existing journal file is required");
  }
  const orchestrator = await SDPNPortOrchestrator.open({
    journalPath,
    authorize: async () => ({ allowed: false }),
    transport: async () => { throw new Error("Read-only export must not transport data"); },
  });
  try {
    const snapshot = orchestrator.snapshot();
    const frame = toStrataCastRenderFrame(snapshot);
    if (frame.objects.length > 2000) throw new Error("Renderer maximum is 2000 ports");
    const canonical = JSON.stringify(frame, null, 2) + "\n";
    if (Buffer.byteLength(canonical) > 1024 * 1024) {
      throw new Error("Renderer export exceeds 1 MiB viewer input limit");
    }
    const outputFile = await open(outputPath, "wx", 0o600);
    try {
      await outputFile.writeFile(canonical, "utf8");
      await outputFile.sync();
    } finally {
      await outputFile.close();
    }
    process.stdout.write(JSON.stringify({
      schemaVersion: "kindred.sdpn.local-topology-export.v1",
      output: outputPath, portCount: frame.objects.length,
      evidenceSequence: frame.sourceSequence,
      sha256: createHash("sha256").update(canonical).digest("hex"),
      transportExecuted: false, liveNetworkProof: false,
      sourceIsCryptographicallyAttested: false
    }) + "\n");
  } finally {
    await orchestrator.close();
  }
}
