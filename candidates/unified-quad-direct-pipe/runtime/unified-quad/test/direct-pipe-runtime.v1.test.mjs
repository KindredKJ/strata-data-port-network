import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import {
  DirectPipeRuntime,
  benchmarkDirectPipe,
  DIRECT_PIPE_CLASSIFICATIONS,
  DIRECT_PIPE_LINEAGE
} from "../src/direct-pipe-runtime.v1.mjs";

test(
  "Kindred Direct Pipe v1 measured portable baseline",
  () => {
    const bytesPerTransfer =
      4 * 1024 * 1024;

    const iterations =
      16;

    const input =
      Buffer.alloc(
        bytesPerTransfer,
        0xa5
      );

    const runtime =
      new DirectPipeRuntime();

    const result =
      benchmarkDirectPipe({
        runtime,
        input,
        iterations
      });

    assert.ok(
      Buffer.isBuffer(result.output)
    );

    assert.equal(
      Buffer.compare(
        input,
        result.output
      ),
      0
    );

    const measurement =
      result.measurement;

    assert.equal(
      measurement.iterations,
      iterations
    );

    assert.equal(
      measurement.logicalBytes,
      bytesPerTransfer * iterations
    );

    assert.equal(
      measurement.copyCount,
      iterations
    );

    assert.equal(
      measurement.copiesPerTransfer,
      1
    );

    assert.equal(
      measurement.physicalBytesMoved,
      measurement.logicalBytes
    );

    assert.equal(
      measurement.backend,
      "node-buffer-explicit-copy"
    );

    assert.equal(
      measurement.classification,
      DIRECT_PIPE_CLASSIFICATIONS.PORTABLE_BUFFERED
    );

    assert.equal(
      measurement.zeroCopyClaimAuthorized,
      false
    );

    assert.equal(
      measurement.hardwarePhysicalTransferMeasured,
      false
    );

    assert.equal(
      measurement.measurementBasis,
      "SOFTWARE_ACCOUNTED_EXPLICIT_COPY_BYTES"
    );

    assert.ok(
      Number.isFinite(
        measurement.averageLatencyMs
      )
    );

    assert.ok(
      measurement.averageLatencyMs >= 0
    );

    assert.ok(
      Number.isFinite(
        measurement.cpuUserMicros
      )
    );

    assert.ok(
      Number.isFinite(
        measurement.cpuSystemMicros
      )
    );

    assert.ok(
      Number.isFinite(
        measurement.maxAbsRssDeltaBytes
      )
    );

    const evidencePath =
      process.env.KINDRED_DIRECT_PIPE_EVIDENCE;

    assert.ok(
      evidencePath,
      "KINDRED_DIRECT_PIPE_EVIDENCE is required"
    );

    const evidence = {
      schemaVersion:
        "kindred.direct-pipe.proof.v1",

      generatedAt:
        new Date().toISOString(),

      directPipe:
        "Kindred Direct Pipe",

      lineage:
        DIRECT_PIPE_LINEAGE,

      measurement,

      proof: {
        execution:
          "REAL_LOCAL_NODE_RUNTIME",

        byteIntegrity:
          true,

        simulation:
          false,

        zeroCopyClaim:
          false
      }
    };

    writeFileSync(
      evidencePath,
      JSON.stringify(
        evidence,
        null,
        2
      ),
      "utf8"
    );
  }
);
