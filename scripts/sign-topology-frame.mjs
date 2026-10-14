import { createPublicKey, createPrivateKey, createHash } from "node:crypto";
import { readFile, open, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { SDPNPortOrchestrator } from "../src/port-orchestrator.mjs";
import { toStrataCastRenderFrame } from "../src/stratacast-topology-bridge.mjs";
import { signTopologyAttestation } from "../src/topology-attestation.mjs";

const { values } = parseArgs({ strict: true, options: {
  journal: { type: "string" }, output: { type: "string" },
  "private-key": { type: "string" },
  "acknowledge-trusted-signing": { type: "boolean" }
} });
if (!values.journal || !values.output || !values["private-key"] ||
    values["acknowledge-trusted-signing"] !== true) {
  process.stderr.write("Usage: node scripts/sign-topology-frame.mjs --journal <existing-journal> --output <new-attestation.json> --private-key <trusted-ed25519-private.pem> --acknowledge-trusted-signing\n");
  process.exitCode = 2;
} else {
  const journalPath = resolve(values.journal);
  const outputPath = resolve(values.output);
  const keyPath = resolve(values["private-key"]);
  if (new Set([journalPath, outputPath, keyPath]).size !== 3 ||
      outputPath === journalPath + ".lock") throw new Error("Journal, key and output paths must be distinct");
  const keyFile = await stat(keyPath);
  const journalFile = await stat(journalPath);
  if (!keyFile.isFile() || keyFile.size > 65536 ||
      !journalFile.isFile() || journalFile.size > 32 * 1024 * 1024) {
    throw new Error("Existing bounded private key and journal files required");
  }
  if (process.platform !== "win32" && (keyFile.mode & 0o077) !== 0) {
    throw new Error("Private key must not be accessible to group or other users");
  }
  const privateKeyPem = await readFile(keyPath, "utf8");
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 identity key required");
  const coordinator = await SDPNPortOrchestrator.open({
    journalPath,
    authorize: async () => ({ allowed: false }),
    transport: async () => { throw new Error("Signed export may not send payload"); }
  });
  try {
    const snapshot = coordinator.snapshot();
    const frame = toStrataCastRenderFrame(snapshot);
    const attestation = signTopologyAttestation({
      frame, journalHash: snapshot.journalHash, privateKeyPem
    });
    const bytes = JSON.stringify(attestation, null, 2) + "\n";
    if (Buffer.byteLength(bytes) > 1024 * 1024) throw new Error("Attestation exceeds browser limit");
    const file = await open(outputPath, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    const publicKey = createPublicKey(key);
    process.stdout.write(JSON.stringify({
      schemaVersion: "kindred.sdpn.topology-export-receipt.v1",
      signatureAlgorithm: "Ed25519",
      signerKeyId: attestation.signerKeyId,
      publicKeySpkiDerBase64url: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      journalHash: snapshot.journalHash,
      evidenceSequence: frame.sourceSequence,
      outputPath, fileSha256: createHash("sha256").update(bytes).digest("hex"),
      publicNetworkOperational: false,
      independentHostAttestationVerified: false
    }) + "\n");
  } finally {
    await coordinator.close();
  }
}
