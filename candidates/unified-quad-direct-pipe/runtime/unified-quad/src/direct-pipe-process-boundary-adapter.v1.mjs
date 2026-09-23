import {
  DirectPipeRuntime
} from "./direct-pipe-runtime.v1.mjs";

export const
DIRECT_PIPE_PROCESS_ATTACHMENT_VERSION =
  "1.0.0";

export const
DIRECT_PIPE_PROCESS_ATTACHMENT_CONTRACT =
  "kindred.direct-pipe.process-attachment.v1";

export class DirectPipeProcessBoundaryAdapter {
  constructor({
    processBoundary,
    directPipeRuntime =
      new DirectPipeRuntime()
  } = {}) {
    if (
      !processBoundary ||
      typeof processBoundary.mapPort !== "function"
    ) {
      throw new TypeError(
        "A real ProcessIntelligenceBoundaryAdapter-compatible instance is required."
      );
    }

    if (
      !directPipeRuntime ||
      typeof directPipeRuntime.transfer !== "function"
    ) {
      throw new TypeError(
        "A DirectPipeRuntime-compatible instance is required."
      );
    }

    this.processBoundary =
      processBoundary;

    this.directPipeRuntime =
      directPipeRuntime;
  }

  mapPort(port) {
    return this.processBoundary.mapPort(
      port
    );
  }

  transferForProcessPort({
    port,
    input
  } = {}) {
    if (port === undefined || port === null) {
      throw new TypeError(
        "A Process Port value is required."
      );
    }

    const mappedPort =
      this.processBoundary.mapPort(
        port
      );

    const transfer =
      this.directPipeRuntime.transfer(
        input
      );

    return {
      mappedPort,

      output:
        transfer.output,

      measurement: {
        ...transfer.measurement,

        attachmentContract:
          DIRECT_PIPE_PROCESS_ATTACHMENT_CONTRACT,

        attachmentVersion:
          DIRECT_PIPE_PROCESS_ATTACHMENT_VERSION,

        processPort:
          port,

        processBoundaryMethod:
          "mapPort",

        directPipeMethod:
          "transfer"
      }
    };
  }

  boundaryEvidence() {
    if (
      typeof this.processBoundary.cacheEvidence !==
      "function"
    ) {
      return null;
    }

    return this.processBoundary.cacheEvidence();
  }

  close() {
    if (
      typeof this.processBoundary.close ===
      "function"
    ) {
      return this.processBoundary.close();
    }

    return undefined;
  }
}

export function createDirectPipeProcessBoundaryAdapter(
  options
) {
  return new DirectPipeProcessBoundaryAdapter(
    options
  );
}
