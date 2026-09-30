import { writeFile } from "node:fs/promises";
import { startProofReceiver } from "../src/two-machine-proof.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const host = arg("host", "0.0.0.0");
const port = Number(arg("port", "47900"));
const receiptPath = arg("status", "");
const secret = process.env.KINDRED_SDPN_PROOF_SECRET;

const receiver = await startProofReceiver({ host, port, secret });
const status = {
  listening: true,
  host: receiver.host,
  port: receiver.port,
  destinationHostFingerprint: receiver.destinationHostFingerprint,
  schemaVersion: "kindred.sdpn.two-host-proof.v1",
  physicalMachineAttestationProven: false
};
process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
if (receiptPath) await writeFile(receiptPath, JSON.stringify(status, null, 2));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await receiver.close();
    process.exit(0);
  });
}
