import { readFile } from "node:fs/promises";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import os from "node:os";
import { generatePairingSecret, startProofReceiver, sendTwoHostProof } from "../src/two-machine-proof.mjs";

const role = process.argv[2];
const secret = (await readFile("/run/pairing-secret", "utf8")).trim();
const identity = {
  role, hostname: os.hostname(), bootId: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
  kernel: os.release(), pid: process.pid, runtime: process.version,
  interfaces: Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    entries.filter(x => !x.internal).map(x => ({ name, address: x.address, mac: x.mac })))
};
console.log("VM_IDENTITY " + JSON.stringify(identity));
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
function envelope(payload) {
  const payloadJson = JSON.stringify(payload);
  return {
    schema: "kindred.sdpn.ephemeral-guest-signature.v1",
    issuer: "EPHEMERAL_GUEST_TEST_RUNNER_NOT_FOUNDER_AUTHORITY",
    payloadJson,
    publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    signatureBase64: sign(null, Buffer.from(payloadJson), privateKey).toString("base64")
  };
}
if (role === "receiver") {
  const receiver = await startProofReceiver({ host: "10.77.0.2", port: 47900, secret,
    onReceipt: receipt => console.log("VM_RECEIVER_ENVELOPE " + JSON.stringify(envelope({ identity, receipt })))
  });
  console.log("VM_RECEIVER_READY");
} else {
  const payload = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 37 + 11) & 255;
  const stateHash = createHash("sha256").update(payload).digest("hex");
  const receipts = [], durations = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    const receipt = await sendTwoHostProof({ host: "10.77.0.2", port: 47900,
      secret, canonicalPayload: payload, stateId: "kindred-test/two-vm-state", stateHash,
      generation: i, timeoutMs: 60000 });
    if (!receipt.twoHostNetworkProofSatisfied || receipt.physicalMachineAttestationProven)
      throw new Error("Virtual-network proof boundary rejected");
    durations.push(performance.now() - start);
    receipts.push(receipt);
  }
  const wrong = generatePairingSecret();
  let wrongSecretRejected = false;
  try { await sendTwoHostProof({ host: "10.77.0.2", port: 47900, secret: wrong,
    canonicalPayload: payload, stateId: "kindred-test/wrong-key", stateHash,
    generation: 99, timeoutMs: 60000 }); } catch { wrongSecretRejected = true; }
  if (!wrongSecretRejected) throw new Error("Wrong pairing secret accepted");
  const sorted = [...durations].sort((a,b) => a-b);
  const result = {
    schema: "kindred.sdpn.executed-two-vm-proof.v1", founder: "Kindred Jermaine Cox", organization: "Kindred Labs",
    classification: "TWO_QEMU_GUESTS_ONE_PHYSICAL_HOST_PRIVATE_EMULATED_NETWORK",
    receipts, durationsMs: durations, p50Ms: sorted[3], p95Ms: sorted[6],
    wrongSecretRejected, physicalMachineAttestationProven: false,
    externalNetworkReachProven: false, productionAuthorized: false
  };
  console.log("VM_SENDER_ENVELOPE " + JSON.stringify(envelope({ identity, result })));
  console.log("VM_PROOF_RESULT " + JSON.stringify(result));
}
