import { readFile, writeFile } from "node:fs/promises";
import { sendTwoHostProof } from "../src/two-machine-proof.mjs";

function required(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`--${name} is required`);
  }
  return process.argv[index + 1];
}

const host = required("host");
const port = Number(required("port"));
const payloadPath = required("payload");
const stateId = required("state-id");
const stateHash = required("state-hash");
const generation = Number(required("generation"));
const receiptPath = required("receipt");
const secret = process.env.KINDRED_SDPN_PROOF_SECRET;

const canonicalPayload = await readFile(payloadPath);
const receipt = await sendTwoHostProof({
  host,
  port,
  secret,
  canonicalPayload,
  stateId,
  stateHash,
  generation
});
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
