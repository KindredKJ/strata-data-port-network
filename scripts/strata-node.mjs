import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DirectPipeWorkerTransfer } from "../src/direct-pipe-worker-transfer.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const strataRoot = join(root, ".strata");
const directories = {
  runtime: join(strataRoot, "runtime"),
  receipts: join(strataRoot, "receipts"),
  logs: join(strataRoot, "logs"),
  state: join(strataRoot, "state"),
  node: join(strataRoot, "node")
};
const host = "127.0.0.1";
const port = Number(process.env.STRATA_NODE_PORT || process.argv[process.argv.indexOf("--port") + 1] || 8787);
const runtimeVersion = "strata-node.v1";
const commit = process.env.STRATA_NODE_COMMIT || "unknown";
const branch = process.env.STRATA_NODE_BRANCH || "unknown";
const identityPath = join(directories.node, "port-zero.json");
const pidPath = join(directories.node, "node.pid.json");
const statePath = join(directories.state, "node-state.json");

for (const directory of Object.values(directories)) mkdirSync(directory, { recursive: true });

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const identity = readJson(identityPath, null) || {
  schemaVersion: "strata.port-zero.identity.v1",
  nodeId: randomUUID(),
  createdAtUtc: new Date().toISOString()
};
if (!/^[0-9a-f-]{36}$/i.test(identity.nodeId)) throw new Error("Port Zero identity is invalid");
writeJson(identityPath, identity);

const state = readJson(statePath, { schemaVersion: "strata.node.state.v1", operationCount: 0, lastReceipt: null });
writeJson(statePath, state);
writeJson(pidPath, { pid: process.pid, host, port, startedAtUtc: new Date().toISOString(), commit, branch, runtimeVersion });

const worker = new DirectPipeWorkerTransfer({ maxBytes: 1024 * 1024 });
let ready = true;
let shuttingDown = false;

function send(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

function metadata() {
  return {
    nodeId: identity.nodeId,
    runtimeVersion,
    canonicalCommit: commit,
    branch,
    health: "alive",
    readiness: ready ? "ready" : "not_ready",
    capabilities: ["port-zero", "direct-pipe-worker-transfer", "local-receipts", "persistent-state"],
    verifiedTransportClassification: "REDUCED_COPY",
    bind: `${host}:${port}`
  };
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function transfer(payload) {
  if (typeof payload !== "string" || payload.length < 1 || Buffer.byteLength(payload, "utf8") > 1024 * 1024) {
    throw new Error("payload must be a non-empty string no larger than 1 MiB");
  }
  const bytes = Buffer.from(payload, "utf8");
  const source = new ArrayBuffer(bytes.length);
  new Uint8Array(source).set(bytes);
  const result = await worker.transfer(source);
  const receipt = {
    schemaVersion: "strata.node.transfer.receipt.v1",
    receiptId: randomUUID(),
    timestampUtc: new Date().toISOString(),
    nodeId: identity.nodeId,
    canonicalCommit: commit,
    operation: "port-zero.local-transfer",
    bytes: result.measurement.logicalBytes,
    classification: result.measurement.classification,
    explicitPayloadCopies: result.measurement.explicitPayloadCopies,
    sourceDetached: result.measurement.sourceDetached,
    integrityVerified: result.measurement.outputSha256 === result.measurement.workerSha256,
    outputSha256: result.measurement.outputSha256,
    externalEffects: false
  };
  const receiptPath = join(directories.receipts, `${receipt.timestampUtc.replaceAll(/[-:.TZ]/g, "")}-${receipt.receiptId}.json`);
  writeJson(receiptPath, receipt);
  const receiptHash = createHash("sha256").update(readFileSync(receiptPath)).digest("hex");
  writeFileSync(`${receiptPath}.sha256`, `${receiptHash}  ${receiptPath.split(/[\\/]/).pop()}\n`, "utf8");
  state.operationCount += 1;
  state.lastReceipt = receipt.receiptId;
  state.updatedAtUtc = new Date().toISOString();
  writeJson(statePath, state);
  return { receipt, receiptHash };
}

const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, `http://${host}:${port}`).pathname;
    if (request.method === "GET" && path === "/health") return send(response, 200, { status: "alive", processAlive: true, runtimeVersion });
    if (request.method === "GET" && path === "/ready") return send(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", processAlive: true, runtimeReady: ready, portZeroIdentityLoaded: Boolean(identity.nodeId), stateLoaded: Boolean(state), workerRuntimeStarted: ready });
    if (request.method === "GET" && path === "/v1/node") return send(response, 200, metadata());
    if (request.method === "POST" && path === "/v1/transfer") return send(response, 200, await transfer((await bodyJson(request)).payload));
    return send(response, 404, { error: "not_found" });
  } catch (error) {
    send(response, 400, { error: error.message });
  }
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  await worker.close();
  server.close(() => {
    if (existsSync(pidPath)) unlinkSync(pidPath);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
  console.log(`Strata Node stopping: ${signal}`);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
server.listen(port, host, () => console.log(`Strata Node listening on http://${host}:${port}`));
