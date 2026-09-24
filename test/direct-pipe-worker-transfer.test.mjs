import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DirectPipeWorkerTransfer } from "../src/direct-pipe-worker-transfer.mjs";

test("worker owns payload and returns integrity-checked bytes", async (t) => {
  const pipe = new DirectPipeWorkerTransfer();
  t.after(() => pipe.close());
  const source = new ArrayBuffer(1024 * 1024);
  const bytes = new Uint8Array(source);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const expected = createHash("sha256").update(bytes).digest("hex");

  const pending = pipe.transfer(source);
  assert.equal(source.byteLength, 0, "the producer must lose ownership immediately");
  const { output, measurement } = await pending;
  assert.equal(output.byteLength, 1024 * 1024);
  assert.equal(createHash("sha256").update(output).digest("hex"), expected);
  assert.equal(measurement.workerSha256, expected);
  assert.equal(measurement.explicitPayloadCopies, 0);
  assert.equal(measurement.classification, "REDUCED_COPY");
  assert.equal(measurement.zeroCopyClaimAuthorized, false);
});

test("rejects shared, aliased, oversized and empty sources before ownership transfer", async (t) => {
  const pipe = new DirectPipeWorkerTransfer({ maxBytes: 8 });
  t.after(() => pipe.close());
  await assert.rejects(pipe.transfer(new SharedArrayBuffer(8)), TypeError);
  await assert.rejects(pipe.transfer(new Uint8Array(8)), TypeError);
  await assert.rejects(pipe.transfer(new ArrayBuffer(0)), RangeError);
  const oversized = new ArrayBuffer(9);
  await assert.rejects(pipe.transfer(oversized), RangeError);
  assert.equal(oversized.byteLength, 9);
});

test("capacity limits and close reject pending work", async () => {
  const pipe = new DirectPipeWorkerTransfer({ maxInflight: 1 });
  const first = pipe.transfer(new ArrayBuffer(8));
  await assert.rejects(pipe.transfer(new ArrayBuffer(8)), /capacity exceeded/);
  await first;
  await pipe.close();
  await assert.rejects(pipe.transfer(new ArrayBuffer(8)), /closed/);

  const interrupted = new DirectPipeWorkerTransfer();
  const pending = interrupted.transfer(new ArrayBuffer(8));
  const rejection = assert.rejects(pending, /closed/);
  await interrupted.close();
  await rejection;
});
