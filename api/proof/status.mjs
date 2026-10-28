import { sha256 } from "../../src/external-proof-v1.mjs";

export default function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const publicKeySpkiBase64 = (process.env.KINDRED_EXTERNAL_PROOF_PUBLIC_KEY_SPKI_B64 ?? "").trim();
  const configured = Boolean(
    (process.env.KINDRED_EXTERNAL_PROOF_SECRET ?? "").trim() &&
    (process.env.KINDRED_EXTERNAL_PROOF_SIGNING_KEY_PKCS8_B64 ?? "").trim() &&
    publicKeySpkiBase64
  );

  return res.status(configured ? 200 : 503).json({
    service: "strata-external-proof",
    ready: configured,
    schemaVersion: "kindred.external-proof.receipt.v1",
    destinationNodeId: process.env.KINDRED_EXTERNAL_PROOF_NODE_ID ?? process.env.VERCEL_URL ?? null,
    keyId: publicKeySpkiBase64 ? sha256(Buffer.from(publicKeySpkiBase64, "base64")) : null,
    transport: "HTTPS + AES-256-GCM",
    signature: "Ed25519",
    physicalMachineAttestationProven: false,
    productionReadyClaim: false
  });
}
