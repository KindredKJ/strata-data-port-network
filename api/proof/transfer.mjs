import {
  createExternalProofReceipt,
  decryptExternalProofPayload,
  signExternalProofReceipt,
  verifyExternalProofToken
} from "../../src/external-proof-v1.mjs";

function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("cache-control", "no-store");
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const secret = (process.env.KINDRED_EXTERNAL_PROOF_SECRET ?? "").trim();
  const privateKeyPkcs8Base64 = (process.env.KINDRED_EXTERNAL_PROOF_SIGNING_KEY_PKCS8_B64 ?? "").trim();
  if (!secret || !privateKeyPkcs8Base64) {
    return res.status(503).json({ error: "external_proof_not_configured" });
  }

  try {
    const body = await readJson(req);
    const token = String(body.token ?? "");
    const claims = verifyExternalProofToken({ secret, token });
    const { receivedSha256, ciphertextBytes } = decryptExternalProofPayload({
      secret,
      token,
      claims,
      ciphertextB64: String(body.ciphertextB64 ?? ""),
      ivB64: String(body.ivB64 ?? ""),
      tagB64: String(body.tagB64 ?? "")
    });

    const receipt = createExternalProofReceipt({
      claims,
      receivedSha256,
      ciphertextBytes,
      destinationExecution: {
        provider: "vercel",
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
        deploymentUrl: process.env.VERCEL_URL ?? null,
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        region: process.env.VERCEL_REGION ?? null
      }
    });
    const envelope = signExternalProofReceipt({ receipt, privateKeyPkcs8Base64 });

    console.log(JSON.stringify({
      kindredExternalProofReceipt: true,
      challengeId: receipt.challengeId,
      stateHash: receipt.stateHash,
      sourceNodeId: receipt.sourceNodeId,
      destinationNodeId: receipt.destinationNodeId,
      keyId: envelope.keyId,
      observedAt: receipt.observedAt
    }));

    return res.status(200).json(envelope);
  } catch (error) {
    return res.status(400).json({
      error: "transfer_rejected",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
