import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmRunner = existsSync(npmCli) ? process.execPath : npm;
const npmPrefixArgs = existsSync(npmCli) ? [npmCli] : [];
const npmArgs = (args) => [...npmPrefixArgs, ...args];
const python = process.env.STRATA_PYTHON || (process.platform === "win32"
  ? join(root, "candidates", "python-network", ".venv", "Scripts", "python.exe")
  : join(root, "candidates", "python-network", ".venv", "bin", "python"));
const checks = [];

function commandText(command, args) {
  return [command, ...args].join(" ");
}

function runCheck(name, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const record = { name, command: commandText(command, args), exitCode };
  if (options.capture) {
    record.stdout = result.stdout || "";
    record.stderr = result.stderr || "";
  }
  checks.push(record);
  if (exitCode !== 0) {
    console.error(`RELEASE GATE STOPPED: ${name} exit code ${exitCode}`);
    if (options.capture) console.error(`${record.stdout}${record.stderr}`);
    return null;
  }
  return result;
}

function parseNodeResults(output) {
  const value = (pattern) => Number(output.match(pattern)?.[1] || 0);
  return { passed: value(/# pass (\d+)/), failed: value(/# fail (\d+)/), skipped: value(/# skipped (\d+)/) };
}

function parsePythonResults(output) {
  const summary = output.match(/(\d+) passed(?:, (\d+) failed)?(?:, (\d+) skipped)?(?:, (\d+) warnings?)?.* in ([\d.]+)s/);
  const subtests = Number(output.match(/(\d+) subtests passed/)?.[1] || 0);
  return {
    passed: Number(summary?.[1] || 0),
    failed: Number(summary?.[2] || 0),
    skipped: Number(summary?.[3] || 0),
    warnings: Number(summary?.[4] || 0),
    subtests,
    durationSeconds: Number(summary?.[5] || 0)
  };
}

function fail(message, exitCode = 1) {
  console.error(`RELEASE GATE STOPPED: ${message}`);
  process.exitCode = exitCode;
  return false;
}

function captureLineage() {
  const commit = spawnSync("git", ["-c", `safe.directory=${root}`, "rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const commitExitCode = typeof commit.status === "number" ? commit.status : 1;
  checks.push({ name: "implementation commit metadata", command: "git rev-parse HEAD", exitCode: commitExitCode });
  const branch = spawnSync("git", ["-c", `safe.directory=${root}`, "branch", "--show-current"], { cwd: root, encoding: "utf8" });
  const branchExitCode = typeof branch.status === "number" ? branch.status : 1;
  checks.push({ name: "implementation branch metadata", command: "git branch --show-current", exitCode: branchExitCode });
  const status = spawnSync("git", ["-c", `safe.directory=${root}`, "status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" });
  const statusExitCode = typeof status.status === "number" ? status.status : 1;
  checks.push({ name: "tracked source status", command: "git status --porcelain --untracked-files=no", exitCode: statusExitCode });
  if (commitExitCode !== 0 || branchExitCode !== 0 || statusExitCode !== 0) return null;
  return {
    testedCommit: commit.stdout.trim(),
    implementationCommit: commit.stdout.trim(),
    branch: branch.stdout.trim(),
    trackedSourceDirtyAtStart: Boolean(status.stdout.trim())
  };
}

function packageGate() {
  const tempRoot = mkdtempSync(join(tmpdir(), "strata-release-package-"));
  try {
    writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ name: "strata-release-probe", private: true }, null, 2));
    const dryPack = runCheck("npm package contents", npmRunner, npmArgs(["pack", "--dry-run", "--json"]), { capture: true });
    if (!dryPack) return false;
    let dryPackJson;
    try { dryPackJson = JSON.parse(dryPack.stdout); } catch (error) { return fail(`npm pack dry-run output invalid: ${error.message}`); }
    const dryPackRecord = Array.isArray(dryPackJson) ? dryPackJson[0] : dryPackJson[packageJson.name] || Object.values(dryPackJson)[0];
    const files = dryPackRecord?.files?.map((entry) => entry.path) || [];
    const requiredFiles = ["package.json", "src/direct-pipe-worker-transfer.mjs", "src/direct-pipe-worker.mjs"];
    const missing = requiredFiles.filter((file) => !files.includes(file));
    if (missing.length) return fail(`package missing ${missing.join(", ")}`);

    const packed = runCheck("npm local tarball creation", npmRunner, npmArgs(["pack", "--json", "--pack-destination", tempRoot]), { capture: true });
    if (!packed) return false;
    let packedJson;
    try { packedJson = JSON.parse(packed.stdout); } catch (error) { return fail(`npm pack output invalid: ${error.message}`); }
    const packedRecord = Array.isArray(packedJson) ? packedJson[0] : packedJson[packageJson.name] || Object.values(packedJson)[0];
    const filename = packedRecord?.filename;
    if (!filename) return fail("npm pack did not report a tarball");
    const tarball = resolve(tempRoot, filename);
    const installed = runCheck("npm local tarball install", npmRunner, npmArgs(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball]), { cwd: tempRoot });
    if (!installed) return false;
    const smoke = runCheck("npm local tarball smoke test", process.execPath, ["--input-type=module", "-e", "import { DirectPipeWorkerTransfer } from '@kindred-labs/strata-data-port-network/worker-transfer'; const pipe = new DirectPipeWorkerTransfer(); await pipe.close();"], { cwd: tempRoot });
    return Boolean(smoke);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeGreenReceipt({ nodeResults, pythonResults, benchmark, packageValidated, lineage }) {
  const allGatesGreen = checks.every((check) => check.exitCode === 0) && nodeResults.failed === 0 && pythonResults.failed === 0;
  if (!allGatesGreen) return fail("required gate results were not all green");
  const timestamp = new Date().toISOString();
  const receiptDirectory = join(root, ".strata", "receipts");
  mkdirSync(receiptDirectory, { recursive: true });
  const receiptPath = join(receiptDirectory, `${timestamp.replaceAll(/[-:.TZ]/g, "")}-release-candidate.json`);
  const receipt = {
    schemaVersion: "strata.release.receipt.v1",
    project: "Strata Data Port Network",
    founder: "Kindred Jermaine Cox",
    organization: "Kindred Labs",
    repository: "https://github.com/KindredKJ/strata-data-port-network",
    commit: lineage.testedCommit,
    testedCommit: lineage.testedCommit,
    implementationCommit: lineage.implementationCommit,
    branch: lineage.branch,
    trackedSourceDirtyAtStart: lineage.trackedSourceDirtyAtStart,
    timestampUtc: timestamp,
    machine: process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown",
    powershellVersion: process.env.STRATA_POWERSHELL_VERSION || null,
    nodeVersion: process.version,
    npmVersion: process.env.STRATA_NPM_VERSION || null,
    pythonExecutable: python,
    pythonVersion: process.env.STRATA_PYTHON_VERSION || null,
    nodeTests: { status: nodeResults.failed === 0 ? "GREEN" : "NOT GREEN", ...nodeResults },
    sw06eMeasurement: {
      classification: benchmark.worker.classification,
      bytesPerTransfer: benchmark.payloadBytes,
      iterations: benchmark.iterations,
      warmupIterations: benchmark.warmupIterations,
      explicitPayloadCopiesPerTransfer: benchmark.worker.explicitPayloadCopiesPerTransfer,
      sourceDetached: benchmark.integrity.workerSourceDetached,
      integrityVerified: benchmark.integrity.workerAndOutputIntegrityVerified,
      meanBoundaryLatencyMs: benchmark.worker.meanMs,
      p50BoundaryLatencyMs: benchmark.worker.p50Ms,
      p95BoundaryLatencyMs: benchmark.worker.p95Ms,
      setupCosts: benchmark.setupCosts
    },
    pythonVerification: { status: pythonResults.failed === 0 ? "GREEN" : "NOT GREEN", ...pythonResults },
    contractVerification: { status: checks.find((check) => check.name === "python contract validation")?.exitCode === 0 ? "GREEN" : "NOT GREEN" },
    packageVerification: { status: packageValidated ? "GREEN" : "NOT GREEN", private: packageJson.private, name: packageJson.name, version: packageJson.version, localTarballInstall: packageValidated },
    checks: checks.map(({ name, command, exitCode }) => ({ name, command, exitCode })),
    knownLimitations: {
      hardwarePhysicalTransferMeasured: benchmark.limits.hardwarePhysicalTransferMeasured,
      twoMachineTransportProven: benchmark.limits.twoMachineTransportProven,
      zeroCopyClaimAuthorized: benchmark.limits.zeroCopyClaimAuthorized,
      productionReadinessProven: benchmark.limits.productionReadinessProven,
      speedupClaim: false
    },
    overall: { status: "GREEN", allRequiredGatesPassed: true }
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const hash = createHash("sha256").update(readFileSync(receiptPath)).digest("hex");
  writeFileSync(`${receiptPath}.sha256`, `${hash}  ${receiptPath.split(/[\\/]/).pop()}\n`, "utf8");
  console.log(`RELEASE GATE GREEN: ${receiptPath}`);
  console.log(`RECEIPT SHA256: ${hash}`);
  return true;
}

function main() {
  const lineage = captureLineage();
  if (!lineage) return fail("implementation lineage could not be captured; no green receipt created");
  if (lineage.trackedSourceDirtyAtStart) return fail("tracked source is dirty at verification start; commit implementation before verification");
  const nodeTest = runCheck("node tests", npmRunner, npmArgs(["test"]), { capture: true });
  if (!nodeTest) return fail("node tests failed; no green receipt created");
  const nodeResults = parseNodeResults(`${nodeTest.stdout}\n${nodeTest.stderr}`);
  console.log(`${nodeTest.stdout}${nodeTest.stderr}`);
  if (nodeResults.failed > 0) return fail("node test failure; no green receipt created");

  const pythonRoot = join(root, "candidates", "python-network");
  if (!runCheck("python contract validation", python, ["scripts/generate_contracts.py", "--check"], { cwd: pythonRoot })) return fail("contract validation failed; no green receipt created");
  const pythonTest = runCheck("python tests", python, ["-m", "pytest", "-q"], { cwd: pythonRoot, capture: true });
  if (!pythonTest) return fail("python tests failed; no green receipt created");
  const pythonResults = parsePythonResults(`${pythonTest.stdout}\n${pythonTest.stderr}`);
  console.log(`${pythonTest.stdout}${pythonTest.stderr}`);
  if (pythonResults.failed > 0) return fail("python test failure; no green receipt created");

  const measurement = runCheck("fair benchmark", process.execPath, ["scripts/measure-worker-transfer.mjs"], { capture: true });
  if (!measurement) return fail("benchmark failed; no green receipt created");
  let benchmark;
  try { benchmark = JSON.parse(measurement.stdout); } catch (error) { return fail(`benchmark JSON invalid: ${error.message}`); }
  console.log(JSON.stringify(benchmark, null, 2));

  const packageValidated = packageGate();
  if (!packageValidated) return fail("package validation failed; no green receipt created");
  if (!runCheck("git diff check", "git", ["-c", `safe.directory=${root}`, "diff", "--check"])) return fail("git diff --check failed; no green receipt created");
  const powershell = spawnSync("pwsh", ["--version"], { encoding: "utf8" });
  const powershellExitCode = typeof powershell.status === "number" ? powershell.status : 1;
  checks.push({ name: "PowerShell metadata", command: "pwsh --version", exitCode: powershellExitCode });
  const npmVersion = spawnSync(npmRunner, npmArgs(["--version"]), { encoding: "utf8" });
  const npmExitCode = typeof npmVersion.status === "number" ? npmVersion.status : 1;
  checks.push({ name: "npm metadata", command: "npm --version", exitCode: npmExitCode });
  process.env.STRATA_POWERSHELL_VERSION = powershell.stdout.trim();
  process.env.STRATA_NPM_VERSION = npmVersion.stdout.trim();
  process.env.STRATA_PYTHON_VERSION = "unknown";
  const pythonVersion = spawnSync(python, ["--version"], { encoding: "utf8" });
  const pythonVersionExitCode = typeof pythonVersion.status === "number" ? pythonVersion.status : 1;
  checks.push({ name: "Python metadata", command: `${python} --version`, exitCode: pythonVersionExitCode });
  process.env.STRATA_PYTHON_VERSION = `${pythonVersion.stdout}${pythonVersion.stderr}`.trim();
  if ([powershellExitCode, npmExitCode, pythonVersionExitCode].some((code) => code !== 0)) return fail("runtime metadata gate failed; no green receipt created");
  return writeGreenReceipt({ nodeResults, pythonResults, benchmark, packageValidated, lineage });
}

main();
