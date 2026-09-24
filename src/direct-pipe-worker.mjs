import { parentPort } from "node:worker_threads";
import { createHash } from "node:crypto";

if (!parentPort) {
  throw new Error("Direct Pipe worker requires a parent port");
}

parentPort.on("message", ({ id, buffer }) => {
  if (!Number.isSafeInteger(id) || !(buffer instanceof ArrayBuffer)) {
    parentPort.postMessage({ id, error: "invalid_transfer" });
    return;
  }

  try {
    const byteLength = buffer.byteLength;
    const sha256 = createHash("sha256")
      .update(new Uint8Array(buffer))
      .digest("hex");

    // Transfer the same allocation back. The worker relinquishes ownership.
    parentPort.postMessage({ id, buffer, byteLength, sha256 }, [buffer]);
  } catch {
    parentPort.postMessage({ id, error: "worker_integrity_failed" });
  }
});
