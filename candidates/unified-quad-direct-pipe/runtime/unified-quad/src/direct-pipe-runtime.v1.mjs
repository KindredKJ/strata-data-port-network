export const DIRECT_PIPE_RUNTIME_VERSION = "1.0.0";

export const DIRECT_PIPE_MEASUREMENT_SCHEMA_VERSION =
  "kindred.direct-pipe.measurement.v1";

export const DIRECT_PIPE_CLASSIFICATIONS =
  Object.freeze({
    ZERO_COPY: "ZERO_COPY",
    REDUCED_COPY: "REDUCED_COPY",
    PORTABLE_BUFFERED: "PORTABLE_BUFFERED"
  });

export const DIRECT_PIPE_LINEAGE =
  Object.freeze({
    contractAuthority: "D:\\KindredLabs\\kindred-labs-superstructure\\runtime\\unified-quad\\src\\process-intelligence.mjs",
    contractSha256: "A3F8B2B9842AB791A5BF80628CBDB08F7D0A557F633D180E0A17854E5ED6FF58",
    benchmarkAuthority: "D:\\KindredLabs\\kindred-labs-superstructure\\runtime\\unified-quad\\test\\process-intelligence.test.mjs",
    benchmarkSha256: "D7F7B3C70F0ACB933623ABF33246DA65953F99533A0EB476BFADB24B9F07E02D",
    implementationMode:
      "NEW_VERSIONED_EXECUTABLE_AUTHORITY_WITH_LINEAGE"
  });

function normalizeInput(input) {
  if (Buffer.isBuffer(input)) {
    return input;
  }

  if (ArrayBuffer.isView(input)) {
    return Buffer.from(
      input.buffer,
      input.byteOffset,
      input.byteLength
    );
  }

  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }

  if (typeof input === "string") {
    return Buffer.from(input, "utf8");
  }

  throw new TypeError(
    "DirectPipeRuntime requires Buffer, TypedArray, ArrayBuffer, or string input."
  );
}

export class DirectPipeRuntime {
  constructor(options = {}) {
    this.backend =
      options.backend ??
      "node-buffer-explicit-copy";
  }

  transfer(input) {
    const source =
      normalizeInput(input);

    const logicalBytes =
      source.byteLength;

    const cpuBefore =
      process.cpuUsage();

    const memoryBefore =
      process.memoryUsage();

    const start =
      process.hrtime.bigint();

    /*
     * Baseline implementation:
     *
     * ONE explicit destination allocation
     * ONE explicit source -> destination copy
     *
     * This is intentionally measurable and portable.
     */
    const destination =
      Buffer.allocUnsafe(logicalBytes);

    source.copy(destination);

    const stop =
      process.hrtime.bigint();

    const cpuDelta =
      process.cpuUsage(cpuBefore);

    const memoryAfter =
      process.memoryUsage();

    const latencyNs =
      Number(stop - start);

    return {
      output:
        destination,

      measurement: {
        schemaVersion:
          DIRECT_PIPE_MEASUREMENT_SCHEMA_VERSION,

        directPipe:
          "Kindred Direct Pipe",

        runtimeVersion:
          DIRECT_PIPE_RUNTIME_VERSION,

        backend:
          this.backend,

        logicalBytes,

        physicalBytesMoved:
          logicalBytes,

        copyCount:
          1,

        fallbacks:
          [],

        latencyNs,

        latencyMs:
          latencyNs / 1_000_000,

        cpuUserMicros:
          cpuDelta.user,

        cpuSystemMicros:
          cpuDelta.system,

        rssBeforeBytes:
          memoryBefore.rss,

        rssAfterBytes:
          memoryAfter.rss,

        rssDeltaBytes:
          memoryAfter.rss -
          memoryBefore.rss,

        externalBeforeBytes:
          memoryBefore.external,

        externalAfterBytes:
          memoryAfter.external,

        classification:
          DIRECT_PIPE_CLASSIFICATIONS.PORTABLE_BUFFERED,

        measurementBasis:
          "SOFTWARE_ACCOUNTED_EXPLICIT_COPY_BYTES",

        hardwarePhysicalTransferMeasured:
          false,

        zeroCopyClaimAuthorized:
          false
      }
    };
  }
}

export function createDirectPipeRuntime(
  options = {}
) {
  return new DirectPipeRuntime(options);
}

export function benchmarkDirectPipe({
  runtime =
    new DirectPipeRuntime(),

  input,

  iterations =
    16
}) {
  if (
    !Number.isInteger(iterations) ||
    iterations < 1
  ) {
    throw new RangeError(
      "iterations must be a positive integer"
    );
  }

  const samples =
    [];

  let output =
    null;

  for (
    let index = 0;
    index < iterations;
    index += 1
  ) {
    const result =
      runtime.transfer(input);

    output =
      result.output;

    samples.push(
      result.measurement
    );
  }

  const logicalBytes =
    samples.reduce(
      (sum, sample) =>
        sum + sample.logicalBytes,
      0
    );

  const physicalBytesMoved =
    samples.reduce(
      (sum, sample) =>
        sum + sample.physicalBytesMoved,
      0
    );

  const copyCount =
    samples.reduce(
      (sum, sample) =>
        sum + sample.copyCount,
      0
    );

  const latencyMs =
    samples.reduce(
      (sum, sample) =>
        sum + sample.latencyMs,
      0
    );

  const cpuUserMicros =
    samples.reduce(
      (sum, sample) =>
        sum + sample.cpuUserMicros,
      0
    );

  const cpuSystemMicros =
    samples.reduce(
      (sum, sample) =>
        sum + sample.cpuSystemMicros,
      0
    );

  const maxAbsRssDeltaBytes =
    samples.reduce(
      (max, sample) =>
        Math.max(
          max,
          Math.abs(
            sample.rssDeltaBytes
          )
        ),
      0
    );

  return {
    output,

    measurement: {
      schemaVersion:
        DIRECT_PIPE_MEASUREMENT_SCHEMA_VERSION,

      directPipe:
        "Kindred Direct Pipe",

      runtimeVersion:
        DIRECT_PIPE_RUNTIME_VERSION,

      backend:
        runtime.backend,

      iterations,

      logicalBytes,

      physicalBytesMoved,

      copyCount,

      copiesPerTransfer:
        copyCount / iterations,

      fallbacks:
        [],

      latencyMs,

      averageLatencyMs:
        latencyMs / iterations,

      cpuUserMicros,

      cpuSystemMicros,

      maxAbsRssDeltaBytes,

      classification:
        DIRECT_PIPE_CLASSIFICATIONS.PORTABLE_BUFFERED,

      measurementBasis:
        "SOFTWARE_ACCOUNTED_EXPLICIT_COPY_BYTES",

      hardwarePhysicalTransferMeasured:
        false,

      zeroCopyClaimAuthorized:
        false,

      samples
    }
  };
}
