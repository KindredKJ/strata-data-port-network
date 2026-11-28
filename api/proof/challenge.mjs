import { issueExternalProofChallenge } from "../../src/external-proof-v1.mjs";

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
    if (total > 64 * 1024) throw new Error("request_too_large");
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
  const destinationNodeId = (process.env.KINDRED_EXTERNAL_PROOF_NODE_ID ?? process.env.VERCEL_URL ?? "").trim();
  if (!secret || !destinationNodeId) {
    return res.status(503).json({ error: "external_proof_not_configured" });
  }

  try {
    const body = await readJson(req);
    const challenge = issueExternalProofChallenge({
      secret,
      request: body,
      destinationNodeId
    });
    return res.status(200).json(challenge);
  } catch (error) {
    return res.status(400).json({
      error: "challenge_rejected",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
