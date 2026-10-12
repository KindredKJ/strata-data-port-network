import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const COMPATIBILITY_SCHEMA = "kindred.sdpn.compatibility-registry.v1";
export class SDPNCompatibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = "SDPNCompatibilityError";
  }
}
const cleanVersion = (v) => {
  if (typeof v !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v)) {
    throw new SDPNCompatibilityError("Versions must use pinned major.minor.patch");
  }
  return v.split(".").map(Number);
};
export function loadCompatibilityRegistry(path = fileURLToPath(
  new URL("../contracts/compatibility-manifest.v1.json", import.meta.url)
)) {
  const registry = JSON.parse(readFileSync(path, "utf8"));
  if (registry?.schemaVersion !== COMPATIBILITY_SCHEMA ||
      !Array.isArray(registry.components) || registry.components.length < 1 ||
      registry.components.length > 256 ||
      registry.releasePolicy?.failClosedOnIncompatibility !== true) {
    throw new SDPNCompatibilityError("Incompatible or unsafe SDPN registry");
  }
  const components = new Map();
  for (const entry of registry.components) {
    if (!entry || typeof entry.id !== "string" || components.has(entry.id) ||
        !/^[a-z0-9.-]+$/.test(entry.id) ||
        typeof entry.schemaId !== "string" || !entry.schemaId ||
        entry.schemaId.length > 128 ||
        typeof entry.releaseVersion !== "string" ||
        typeof entry.schemaVersion !== "string") {
      throw new SDPNCompatibilityError("Malformed or duplicate component");
    }
    cleanVersion(entry.releaseVersion);
    cleanVersion(entry.schemaVersion);
    components.set(entry.id, entry);
  }
  for (const entry of components.values()) {
    for (const requirement of entry.compatibleWith ?? []) {
      if (!components.has(requirement.component) ||
          !Number.isSafeInteger(requirement.major) || requirement.major < 0 ||
          cleanVersion(components.get(requirement.component).schemaVersion)[0] !== requirement.major) {
        throw new SDPNCompatibilityError("Missing or incompatible dependency for " + entry.id);
      }
    }
  }
  if (registry.networkClaims?.publicNetworkOperational !== false ||
      registry.networkClaims?.physicalZeroCopyProven !== false ||
      registry.releasePolicy.automaticProductionDeployment !== false) {
    throw new SDPNCompatibilityError("Preproduction evidence cannot certify production");
  }
  return registry;
}
export function assertComponentCompatibility(registry, componentId, offeredSchemaId, offeredVersion) {
  const component = registry.components?.find((item) => item.id === componentId);
  if (!component || offeredSchemaId !== component.schemaId) {
    throw new SDPNCompatibilityError("Unknown component or schema identifier");
  }
  const [expectedMajor, expectedMinor] = cleanVersion(component.schemaVersion);
  const [offeredMajor, offeredMinor] = cleanVersion(offeredVersion);
  if (offeredMajor !== expectedMajor || offeredMinor < expectedMinor) {
    throw new SDPNCompatibilityError("Incompatible schema major or minimum minor version");
  }
  return Object.freeze({
    componentId, schemaId: offeredSchemaId, negotiatedMajor: expectedMajor,
    acceptedSchemaVersion: offeredVersion
  });
}
