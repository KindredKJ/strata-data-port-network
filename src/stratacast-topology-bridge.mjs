import { ORCHESTRATOR_SCHEMA } from "./port-orchestrator.mjs";

export const STRATACAST_RENDER_FRAME_SCHEMA = "stratacast.kindred/v1";
const HEALTH_ASSETS = Object.freeze({
  healthy: "sdpn.port.healthy", degraded: "sdpn.port.degraded",
  offline: "sdpn.port.offline", revoked: "sdpn.port.revoked",
  expired: "sdpn.port.expired"
});

/** Pure, read-only conversion to StrataCast RenderFrameV1. No control-plane privilege. */
export function toStrataCastRenderFrame(snapshot) {
  if (snapshot?.schemaVersion !== ORCHESTRATOR_SCHEMA ||
      !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 ||
      !Array.isArray(snapshot.ports) || snapshot.ports.length > 10_000) {
    throw new TypeError("Invalid SDPN topology snapshot");
  }
  const ids = new Set();
  const ports = [...snapshot.ports].sort((a, b) => a.id.localeCompare(b.id));
  for (const port of ports) {
    if (typeof port.id !== "string" || port.id.length === 0 ||
        ids.has(port.id) || !Object.hasOwn(HEALTH_ASSETS, port.health)) {
      throw new TypeError("Invalid topology port");
    }
    ids.add(port.id);
  }
  const radius = Math.max(4, ports.length / 3);
  return Object.freeze({
    schemaVersion: STRATACAST_RENDER_FRAME_SCHEMA,
    kind: "RenderFrame",
    worldId: "sdpn.network.topology",
    sourceTick: snapshot.sequence,
    sourceSequence: snapshot.sequence,
    objects: ports.map((port, index) => {
      const angle = 2 * Math.PI * index / Math.max(ports.length, 1);
      return {
        entityId: "sdpn.port:" + port.id,
        assetId: HEALTH_ASSETS[port.health],
        position: { x: Math.round(radius * Math.cos(angle) * 1000) / 1000,
          y: 0, z: Math.round(radius * Math.sin(angle) * 1000) / 1000 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      };
    })
  });
}
