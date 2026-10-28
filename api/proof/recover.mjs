import {
  createCrossProviderRecoveryRecord,
  openRecoveryCapsule,
  signCrossProviderRecovery
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
    if (total > 160 * 1024) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const secret = (process.env.KINDRED_RECOVERY_CAPSULE_SECRET ?? "").trim();
  const privateKeyPkcs8Base64 = (process.env.KINDRED_EXTERNAL_PROOF_SIGNING_KEY_PKCS8_B64 ?? "").trim();
  const allowedSourceNodeId = (process.env.KINDRED_RECOVERY_ALLOWED_SOURCE_NODE_ID ?? "").trim();
  const recoveryNodeId = (process.env.KINDRED_EXTERNAL_RECOVERY_NODE_ID ?? process.env.VERCEL_URL ?? "").trim();
  if (!secret || !privateKeyPkcs8Base64 || !allowedSourceNodeId || !recoveryNodeId) {
    return res.status(503).json({ error: "cross_provider_recovery_not_configured" });
  }

  try {
    const body = await readJson(req);
    const capsule = body?.capsule;
    const { state, executed } = openRecoveryCapsule({ secret, capsule });
    if (state.sourceNodeId !== allowedSourceNodeId) {
      throw new Error("recovery capsule source node is not authorized");
    }

    const recovery = createCrossProviderRecoveryRecord({
      state,
      executed,
      capsuleSha256: capsule.capsuleSha256,
      recoveryNodeId,
      execution: {
        provider: "vercel",
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
        deploymentUrl: process.env.VERCEL_URL ?? null,
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        region: process.env.VERCEL_REGION ?? null
      }
    });
    const envelope = signCrossProviderRecovery({ recovery, privateKeyPkcs8Base64 });

    console.log(JSON.stringify({
      kindredCrossProviderRecovery: true,
      recoveryId: recovery.recoveryId,
      capsuleSha256: recovery.capsuleSha256,
      originalSourceNodeId: recovery.originalSourceNodeId,
      recoveryNodeId: recovery.recoveryNodeId,
      outputHash: recovery.outputHash,
      keyId: envelope.keyId,
      observedAt: recovery.observedAt
    }));

    return res.status(200).json(envelope);
  } catch (error) {
    return res.status(400).json({
      error: "cross_provider_recovery_rejected",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
