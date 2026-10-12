import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export const ORCHESTRATOR_SCHEMA = "kindred.sdpn.orchestrator.v1";
const HEALTH = new Set(["healthy", "degraded", "offline"]);
const hex = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const identifier = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 128 &&
  /^[a-zA-Z0-9_.:-]+$/.test(value);
const limited = (items, length = 128) =>
  Array.isArray(items) && items.length <= length && items.every(identifier) &&
  new Set(items).size === items.length;

function checkPort(port) {
  if (!port || !identifier(port.id) || !identifier(port.ownerId) ||
      !limited(port.scopes) || !limited(port.allowedDestinations) ||
      !Number.isSafeInteger(port.expiresAt) || port.expiresAt <= 0 ||
      port.consentGranted !== true || port.identityVerified !== true ||
      !HEALTH.has(port.health)) {
    throw new TypeError("Port must have verified identity, opt-in consent and valid bounded policy");
  }
  return Object.freeze({
    id: port.id, ownerId: port.ownerId, scopes: [...port.scopes],
    allowedDestinations: [...port.allowedDestinations], expiresAt: port.expiresAt,
    consentGranted: true, identityVerified: true, health: port.health
  });
}

/** Single-writer durable journal. Hash chain detects corruption, not privileged rewrites. */
class AuditJournal {
  #file;
  #lock;
  #path;
  entries = [];
  hash = "0".repeat(64);
  async open(path) {
    this.#path = path;
    await mkdir(dirname(path), { recursive: true });
    this.#lock = await open(path + ".lock", "wx", 0o600);
    try {
      let raw;
      try { raw = await readFile(path, "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; raw = ""; }
      if (raw && !raw.endsWith("\n")) throw new Error("Audit journal contains a partial final record");
      for (const line of raw.split("\n").filter(Boolean)) {
        const entry = JSON.parse(line);
        const { hash, ...core } = entry;
        if (core.schemaVersion !== ORCHESTRATOR_SCHEMA ||
            core.sequence !== this.entries.length + 1 || core.previousHash !== this.hash ||
            !hex(hash) || sha256(JSON.stringify(core)) !== hash) {
          throw new Error("Audit journal integrity failure: refusing startup");
        }
        this.entries.push(entry);
        this.hash = hash;
      }
      this.#file = await open(path, "a", 0o600);
    } catch (error) {
      await this.#lock.close();
      await unlink(path + ".lock");
      throw error;
    }
  }
  async append(type, data, at) {
    const core = { schemaVersion: ORCHESTRATOR_SCHEMA, sequence: this.entries.length + 1,
      previousHash: this.hash, type, at, data };
    const entry = { ...core, hash: sha256(JSON.stringify(core)) };
    await this.#file.writeFile(JSON.stringify(entry) + "\n");
    await this.#file.sync();
    this.entries.push(entry);
    this.hash = entry.hash;
    return entry;
  }
  async close() {
    if (!this.#lock) return;
    try { await this.#file?.close(); } finally {
      await this.#lock.close();
      await unlink(this.#path + ".lock");
      this.#lock = undefined;
    }
  }
}

/**
 * Fail-closed state-port coordinator. Authorization and actual transport are
 * injected trusted services. No discovery, payment, remote shell or network
 * exposure is implied. This coordinator never stores plaintext payload bytes.
 */
export class SDPNPortOrchestrator {
  #journal;
  #authorize;
  #transport;
  #clock;
  #ports = new Map();
  #revoked = new Set();
  #usedKeys = new Set();
  #closed = false;
  #busy = false;

  static async open({ journalPath, authorize, transport, now = Date.now }) {
    if (typeof journalPath !== "string" || !journalPath ||
        typeof authorize !== "function" || typeof transport !== "function" ||
        typeof now !== "function") throw new TypeError("Durable path, authority and transport are required");
    const instance = new SDPNPortOrchestrator();
    instance.#authorize = authorize;
    instance.#transport = transport;
    instance.#clock = now;
    instance.#journal = new AuditJournal();
    await instance.#journal.open(journalPath);
    for (const entry of instance.#journal.entries) instance.#apply(entry);
    return instance;
  }
  #apply({ type, data }) {
    if (type === "port.registered") {
      this.#ports.set(data.port.id, data.port);
      this.#revoked.delete(data.port.id);
    }
    if (type === "port.health") this.#ports.set(data.id, {
      ...this.#ports.get(data.id), health: data.health
    });
    if (type === "port.revoked") this.#revoked.add(data.id);
    if (type === "transfer.reserved") this.#usedKeys.add(data.idempotencyKey);
  }
  async #record(type, data) {
    const entry = await this.#journal.append(type, data, this.#clock());
    this.#apply(entry);
    return entry;
  }
  async #permit(actor, action, context) {
    if (!identifier(actor)) throw new Error("Authenticated principal ID required");
    const result = await this.#authorize({ actor, action, context });
    if (result?.allowed !== true || !identifier(result.authorityId)) {
      throw new Error("Authorization denied");
    }
  }
  #requirePort(id, scope) {
    const p = this.#ports.get(id);
    if (!p || this.#revoked.has(id) || p.expiresAt <= this.#clock() ||
        !p.identityVerified || !p.consentGranted || p.health === "offline" ||
        !p.scopes.includes(scope)) throw new Error("Port unavailable or not authorized");
    return p;
  }
  async registerPort({ actor, port }) {
    this.#active();
    const checked = checkPort(port);
    if (checked.expiresAt <= this.#clock()) throw new Error("Port consent has expired");
    await this.#permit(actor, "port.register", { portId: checked.id, ownerId: checked.ownerId });
    if (this.#ports.has(checked.id)) throw new Error("Existing port must be explicitly revoked before re-registration");
    await this.#record("port.registered", { port: checked });
    return checked.id;
  }
  async updateHealth({ actor, portId, health }) {
    this.#active();
    if (!identifier(portId) || !HEALTH.has(health) || !this.#ports.has(portId)) {
      throw new TypeError("Invalid health update");
    }
    await this.#permit(actor, "port.health", { portId, health });
    await this.#record("port.health", { id: portId, health });
  }
  async revokePort({ actor, portId }) {
    this.#active();
    if (!this.#ports.has(portId)) throw new Error("Unknown port");
    await this.#permit(actor, "port.revoke", { portId });
    await this.#record("port.revoked", { id: portId });
  }
  #active() {
    if (this.#closed) throw new Error("Orchestrator closed");
    if (this.#busy) throw new Error("Orchestrator single-writer dispatch already in progress");
  }
  /**
   * Automatic failover occurs ONLY following a verified non-committed refusal.
   * Indeterminate timeouts/errors stop immediately to prevent duplicate effects.
   */
  async dispatch({ actor, sourceId, destinationIds, stateId, payload, idempotencyKey }) {
    this.#active();
    if (!identifier(stateId) || !identifier(idempotencyKey) ||
        !limited(destinationIds, 8) || destinationIds.length === 0 ||
        !(payload instanceof Uint8Array) || payload.byteLength < 1 ||
        payload.byteLength > 16 * 1024 * 1024) throw new TypeError("Invalid bounded transfer request");
    if (this.#usedKeys.has(idempotencyKey)) throw new Error("Replay or previous indeterminate transfer");
    const source = this.#requirePort(sourceId, "transfer:send");
    const digest = sha256(payload);
    await this.#permit(actor, "transfer.dispatch", {
      sourceId, destinationIds, stateId, payloadSha256: digest, payloadBytes: payload.byteLength
    });
    const permitted = destinationIds.map((id) => {
      const destination = this.#requirePort(id, "transfer:receive");
      if (!source.allowedDestinations.includes(id)) throw new Error("Source destination not approved");
      return destination;
    });
    this.#busy = true;
    try {
      const transferId = randomUUID();
      await this.#record("transfer.reserved", {
        transferId, idempotencyKey, sourceId, destinationIds, stateId,
        payloadSha256: digest, payloadBytes: payload.byteLength
      });
      for (const destination of permitted) {
        // Check again immediately before invoking the transport.
        this.#requirePort(sourceId, "transfer:send");
        this.#requirePort(destination.id, "transfer:receive");
        const call = { transferId, idempotencyKey, sourceId, destinationId: destination.id,
          stateId, payloadSha256: digest, payloadBytes: payload.byteLength,
          payload, signalRequired: true };
        let receipt;
        try { receipt = await this.#transport(call); }
        catch {
          await this.#record("transfer.indeterminate", { transferId, destinationId: destination.id });
          throw new Error("Transport outcome indeterminate; do not retry without reconciliation");
        }
        if (receipt?.accepted === true) {
          if (receipt.transferId !== transferId || receipt.destinationId !== destination.id ||
              receipt.payloadSha256 !== digest || receipt.integrityVerified !== true ||
              receipt.stateId !== stateId) {
            await this.#record("transfer.indeterminate", { transferId, destinationId: destination.id });
            throw new Error("Transfer receipt invalid: reconciliation required");
          }
          await this.#record("transfer.succeeded", {
            transferId, sourceId, destinationId: destination.id,
            stateId, payloadSha256: digest, classification: "CONNECTOR_RECEIPT_VERIFIED"
          });
          return { transferId, destinationId: destination.id, payloadSha256: digest,
            classification: "CONNECTOR_RECEIPT_VERIFIED", physicalZeroCopyProven: false,
            twoMachineTransportProven: false };
        }
        if (receipt?.accepted !== false || receipt?.committed !== false ||
            receipt?.safeToRetry !== true || receipt?.transferId !== transferId) {
          await this.#record("transfer.indeterminate", { transferId, destinationId: destination.id });
          throw new Error("Unverified refusal; failover blocked");
        }
        await this.#record("transfer.refused", { transferId, destinationId: destination.id });
      }
      await this.#record("transfer.exhausted", { transferId });
      throw new Error("All approved healthy destinations definitively refused");
    } finally {
      this.#busy = false;
    }
  }
  snapshot() {
    this.#active();
    return Object.freeze({
      schemaVersion: ORCHESTRATOR_SCHEMA, sequence: this.#journal.entries.length,
      journalHash: this.#journal.hash,
      ports: [...this.#ports.values()].map((p) => ({
        id: p.id, health: this.#revoked.has(p.id) ? "revoked" :
          p.expiresAt <= this.#clock() ? "expired" : p.health,
        allowedDestinations: p.allowedDestinations.filter((x) => this.#ports.has(x))
      })).sort((a, b) => a.id.localeCompare(b.id)),
      transfers: this.#journal.entries.filter((e) => e.type === "transfer.succeeded")
        .map(({ data }) => ({ sourceId: data.sourceId, destinationId: data.destinationId,
          transferId: data.transferId, classification: data.classification })),
      operational: true,
      physicalZeroCopyProven: false,
      publicNetworkOperational: false
    });
  }
  async close() {
    if (this.#closed) return;
    if (this.#busy) throw new Error("Cannot close during active dispatch");
    this.#closed = true;
    await this.#journal.close();
  }
}
