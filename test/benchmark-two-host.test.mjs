import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startProofReceiver } from "../src/two-machine-proof.mjs";
import { percentile, requirePrivateIpv4, runSw06fBenchmark } from "../scripts/benchmark-two-host.mjs";

const secret = "kindred-isolated-benchmark-test-secret-not-for-production";

test("private address policy accepts RFC1918 and loopback only", () => {
  for (const address of ["10.1.2.3", "172.16.5.7", "172.31.255.254", "192.168.1.11"]) {
    assert.equal(requirePrivateIpv4(address).isLoopback, false);
  }
  assert.equal(requirePrivateIpv4("127.0.0.1").isLoopback, true);
  for (const address of ["8.8.8.8", "169.254.1.1", "172.32.1.1", "1.1.1.1",
    "localhost", "192.168.001.2", "256.1.1.1", "0.0.0.0"]) {
    assert.throws(() => requirePrivateIpv4(address));
  }
});

test("nearest-rank percentiles are deterministic", () => {
  assert.equal(percentile([12, 2, 8, 1, 4], 0.5), 4);
  assert.equal(percentile([12, 2, 8, 1, 4], 0.95), 12);
  assert.throws(() => percentile([], 0.5));
  assert.throws(() => percentile([2, -1], 0.95));
});

test("real encrypted loopback measurement retains receipts but denies physical claims", async (t) => {
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret });
  t.after(() => receiver.close());
  const report = await runSw06fBenchmark({
    host: "127.0.0.1", port: receiver.port, secret,
    sizesMiB: [1], trials: 2, warmup: 1
  });
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].samples.length, 2);
  assert.equal(report.results[0].payloadBytes, 2 * 1024 * 1024);
  assert.ok(report.results[0].applicationGoodputMbps > 0);
  assert.equal(report.observation.loopbackTarget, true);
  assert.equal(report.observation.twoHostSoftwareProofObserved, false);
  assert.equal(report.observation.physicalMachineAttestationProven, false);
  assert.equal(report.observation.physicalSeparationVerified, false);
  assert.equal(report.observation.productionAuthorized, false);
  assert.equal(report.results[0].samples[0].receipt.loopbackObserved, true);
  assert.equal(report.results[0].samples[0].receipt.encryptedOnWire, true);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("wrong secret and physical-gate mismatch fail closed", async (t) => {
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret });
  t.after(() => receiver.close());
  await assert.rejects(runSw06fBenchmark({
    host: "127.0.0.1", port: receiver.port,
    secret: "a-different-valid-length-test-secret-123456",
    sizesMiB: [1], trials: 1, warmup: 0
  }), /403/);
  await assert.rejects(runSw06fBenchmark({
    host: "127.0.0.1", port: receiver.port, secret, sizesMiB: [1],
    trials: 1, warmup: 0, requireNonloopback: true
  }), /non-loopback/);
});

test("CLI produces private local evidence without overwriting it or leaking secret", async (t) => {
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret });
  t.after(() => receiver.close());
  const directory = await mkdtemp(join(tmpdir(), "kindred-sw06f-benchmark-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "report.json");
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const args = [
    "scripts/benchmark-two-host.mjs", "--host", "127.0.0.1",
    "--port", String(receiver.port), "--sizes-mib", "1",
    "--trials", "1", "--warmup", "0", "--allow-loopback",
    "--output", output
  ];
  const run = () => new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, KINDRED_SDPN_PROOF_SECRET: secret }
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
  const first = await run();
  assert.equal(first.code, 0, first.stderr);
  const fileContent = await readFile(output, "utf8");
  assert.equal(JSON.parse(fileContent).results[0].trials, 1);
  assert.equal(fileContent.includes(secret), false);
  assert.equal(first.stdout.includes(secret), false);
  const second = await run();
  assert.equal(second.code, 1);
  assert.match(second.stderr, /EEXIST/);
  assert.equal(await readFile(output, "utf8"), fileContent);
});
