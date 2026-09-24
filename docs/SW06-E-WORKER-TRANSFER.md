# SW06-E: worker ownership transfer candidate

**Founder and creator:** Kindred Jermaine Cox, Kindred Labs  
**Status:** locally executed candidate; no production or physical zero-copy claim

The inherited SW06 Direct Pipe uses an explicit destination allocation and one payload copy per transfer. This new module demonstrates a narrower boundary: an owned `ArrayBuffer` moves from the producer to a Node worker and back through a transfer list. The producer's buffer detaches immediately. The worker hashes the received bytes, returns the same transferable allocation, and the producer verifies length and SHA-256 again.

The implementation lives at [`src/direct-pipe-worker-transfer.mjs`](../src/direct-pipe-worker-transfer.mjs). It accepts only an owned `ArrayBuffer`, rejects views and shared buffers, limits message size and concurrent transfers, times out blocked work, and terminates the worker on a transport or integrity failure. Call `close()` when finished. This is a separate candidate; it does not alter the pinned source snapshots in `candidates/` or their lineage manifest.

```js
import { DirectPipeWorkerTransfer } from "./src/direct-pipe-worker-transfer.mjs";

const pipe = new DirectPipeWorkerTransfer();
try {
  const source = new ArrayBuffer(1024);
  new Uint8Array(source).fill(0xa5);
  const pending = pipe.transfer(source);
  // source.byteLength is now 0: ownership moved to the worker.
  const { output, measurement } = await pending;
  console.log(output.byteLength, measurement.classification);
} finally {
  await pipe.close();
}
```

Run `npm test` and `npm run measure` from the repository root. The latter makes 16 transfers of 4 MiB for both the inherited buffered baseline and the new worker boundary, checks the output digest, and prints a JSON result with the runtime version and limitations. It excludes input allocation and reports observed latency, which varies by host; it is not a throughput guarantee. Digest work is included in the worker path but not in the inherited baseline timing, so those latency values are not a controlled performance comparison.

The result qualifies as **reduced explicit JavaScript payload copies at the worker boundary**. Transfer lists may perform internal engine or hardware movement. We have not measured physical bytes, verified another machine or network transport, proven zero copy across storage/network boundaries, or reconciled this module with the Python Port Zero control plane. `zeroCopyClaimAuthorized` is therefore `false`.

Before using this path for external ports, require Port Zero authorization, durable receipts, revocation and replay enforcement, and an end-to-end two-device proof. The open Unified Quad review findings remain separate blockers.
