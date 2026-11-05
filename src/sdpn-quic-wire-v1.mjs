import { canonicalBytes } from "./native-port-identity.mjs";

export const SDPN_QUIC_PROFILE_V1 = Object.freeze({
  profileId: "kindred.sdpn.quic-wire.v1",
  creator: "Kindred Jermaine Cox",
  organization: "Kindred Labs",
  officialProjectDomain: "kindredlabs.ai",
  alpn: "sdpn/1",
  quicVersion: 1,
  tlsMinimumVersion: "1.3",
  carrier: "UDP/IP",
  logicalRouting: false
});

export const SDPN_STREAM_RECORD_TYPES = Object.freeze({
  PORT_BIND: 0x01,
  SESSION_OFFER: 0x02,
  SESSION_ACCEPT: 0x03,
  NATIVE_FRAME: 0x10,
  RECEIPT: 0x20
});

export const SDPN_PROBE_TYPES = Object.freeze({
  PROBE: 0x40,
  ECHO: 0x41
});

export const SDPN_STREAM_HEADER_BYTES = 12;
export const SDPN_NATIVE_FRAME_PREFIX_BYTES = 40;
export const SDPN_MAX_CIPHERTEXT_BYTES = 32 * 1024 * 1024;
export const SDPN_MAX_STREAM_BODY_BYTES =
  SDPN_MAX_CIPHERTEXT_BYTES + SDPN_NATIVE_FRAME_PREFIX_BYTES;
export const SDPN_PROBE_DATAGRAM_BYTES = 40;
export const SDPN_NATIVE_FRAME_SCHEMA = "kindred.sdpn.native-frame.v1";

const MAGIC = Buffer.from("SDPN", "ascii");
const STREAM_TYPES = new Set(Object.values(SDPN_STREAM_RECORD_TYPES));
const CONTROL_TYPES = new Set([
  SDPN_STREAM_RECORD_TYPES.PORT_BIND,
  SDPN_STREAM_RECORD_TYPES.SESSION_OFFER,
  SDPN_STREAM_RECORD_TYPES.SESSION_ACCEPT,
  SDPN_STREAM_RECORD_TYPES.RECEIPT
]);

function requireBytes(value, name) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${name} must be a Uint8Array`);
  }
  return Buffer.from(value);
}

function exactObjectFields(value, expected, name) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length ||
      actual.some((field, index) => field !== wanted[index])) {
    throw new TypeError(`${name} fields rejected`);
  }
}

function uuidToBytes(value, name = "sessionId") {
  if (typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(`${name} must be a canonical UUID`);
  }
  const result = Buffer.from(value.replaceAll("-", ""), "hex");
  if (result.length !== 16) throw new TypeError(`${name} is invalid`);
  return result;
}

function bytesToUuid(value) {
  if (value.length !== 16) throw new RangeError("UUID bytes must be 16 bytes");
  const hex = value.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalBase64(value, name, expectedBytes) {
  if (typeof value !== "string" || value.length > Math.ceil(SDPN_MAX_CIPHERTEXT_BYTES / 3) * 4 + 4) {
    throw new TypeError(`${name} must be bounded base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value ||
      (expectedBytes !== undefined && bytes.length !== expectedBytes)) {
    throw new TypeError(`${name} encoding rejected`);
  }
  return bytes;
}

function requireU64(value, name) {
  let result;
  if (typeof value === "bigint") {
    result = value;
  } else if (Number.isSafeInteger(value) && value >= 0) {
    result = BigInt(value);
  } else {
    throw new TypeError(`${name} must be a non-negative safe integer or bigint`);
  }
  if (result < 0n || result > 0xffffffffffffffffn) {
    throw new RangeError(`${name} exceeds uint64`);
  }
  return result;
}

function typeName(type) {
  for (const [name, value] of Object.entries(SDPN_PROBE_TYPES)) {
    if (value === type) return name;
  }
  return null;
}

export function encodeStreamRecord(type, bodyValue) {
  if (!STREAM_TYPES.has(type)) throw new RangeError("unknown SDPN stream record type");
  const body = requireBytes(bodyValue, "body");
  if (body.length > SDPN_MAX_STREAM_BODY_BYTES) {
    throw new RangeError("SDPN stream record body exceeds profile limit");
  }
  const record = Buffer.allocUnsafe(SDPN_STREAM_HEADER_BYTES + body.length);
  MAGIC.copy(record, 0);
  record.writeUInt8(1, 4);
  record.writeUInt8(type, 5);
  record.writeUInt16BE(0, 6);
  record.writeUInt32BE(body.length, 8);
  body.copy(record, SDPN_STREAM_HEADER_BYTES);
  return record;
}

export function decodeStreamRecord(recordValue) {
  const bytes = requireBytes(recordValue, "record");
  if (bytes.length < SDPN_STREAM_HEADER_BYTES) {
    throw new RangeError("truncated SDPN stream header");
  }
  if (!bytes.subarray(0, 4).equals(MAGIC)) {
    throw new Error("SDPN stream magic rejected");
  }
  const version = bytes.readUInt8(4);
  const type = bytes.readUInt8(5);
  const flags = bytes.readUInt16BE(6);
  const bodyLength = bytes.readUInt32BE(8);
  if (version !== 1) throw new Error("unsupported SDPN wire version");
  if (!STREAM_TYPES.has(type)) throw new Error("unknown SDPN stream record type");
  if (flags !== 0) throw new Error("reserved SDPN stream flags must be zero");
  if (bodyLength > SDPN_MAX_STREAM_BODY_BYTES) {
    throw new RangeError("SDPN stream record body exceeds profile limit");
  }
  if (bytes.length !== SDPN_STREAM_HEADER_BYTES + bodyLength) {
    throw new RangeError("SDPN stream record length mismatch");
  }
  return Object.freeze({
    version,
    type,
    body: Buffer.from(bytes.subarray(SDPN_STREAM_HEADER_BYTES))
  });
}

export function encodeCanonicalControlRecord(type, value) {
  if (!CONTROL_TYPES.has(type)) {
    throw new RangeError("record type is not a canonical control record");
  }
  const body = canonicalBytes(value);
  return encodeStreamRecord(type, body);
}

export function decodeCanonicalControlRecord(recordValue) {
  const record = decodeStreamRecord(recordValue);
  if (!CONTROL_TYPES.has(record.type)) {
    throw new Error("record type is not a canonical control record");
  }
  let value;
  try {
    value = JSON.parse(record.body.toString("utf8"));
  } catch {
    throw new Error("control record JSON rejected");
  }
  if (!canonicalBytes(value).equals(record.body)) {
    throw new Error("control record is not canonical JSON");
  }
  return Object.freeze({ type: record.type, value });
}

export function encodeNativeFrameRecord(frame) {
  exactObjectFields(
    frame,
    ["schema", "sessionId", "sequence", "ciphertext", "tag"],
    "native frame"
  );
  if (frame.schema !== SDPN_NATIVE_FRAME_SCHEMA) {
    throw new Error("native frame schema rejected");
  }
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0 || frame.sequence > 1023) {
    throw new RangeError("native frame sequence exceeds session limit");
  }
  const sessionId = uuidToBytes(frame.sessionId);
  const ciphertext = canonicalBase64(frame.ciphertext, "ciphertext");
  if (ciphertext.length > SDPN_MAX_CIPHERTEXT_BYTES) {
    throw new RangeError("native ciphertext exceeds profile limit");
  }
  const tag = canonicalBase64(frame.tag, "tag", 16);
  const body = Buffer.allocUnsafe(SDPN_NATIVE_FRAME_PREFIX_BYTES + ciphertext.length);
  sessionId.copy(body, 0);
  body.writeBigUInt64BE(BigInt(frame.sequence), 16);
  tag.copy(body, 24);
  ciphertext.copy(body, SDPN_NATIVE_FRAME_PREFIX_BYTES);
  return encodeStreamRecord(SDPN_STREAM_RECORD_TYPES.NATIVE_FRAME, body);
}

export function decodeNativeFrameRecord(recordValue) {
  const record = decodeStreamRecord(recordValue);
  if (record.type !== SDPN_STREAM_RECORD_TYPES.NATIVE_FRAME) {
    throw new Error("record is not a native frame");
  }
  if (record.body.length < SDPN_NATIVE_FRAME_PREFIX_BYTES ||
      record.body.length > SDPN_MAX_STREAM_BODY_BYTES) {
    throw new RangeError("native frame body length rejected");
  }
  const sequence = record.body.readBigUInt64BE(16);
  if (sequence > 1023n) throw new RangeError("native frame sequence exceeds session limit");
  return Object.freeze({
    schema: SDPN_NATIVE_FRAME_SCHEMA,
    sessionId: bytesToUuid(record.body.subarray(0, 16)),
    sequence: Number(sequence),
    tag: record.body.subarray(24, 40).toString("base64"),
    ciphertext: record.body.subarray(40).toString("base64")
  });
}

export function encodeProbeDatagram({
  kind = "PROBE",
  sessionId,
  sequence,
  sentAtNs
}) {
  const type = SDPN_PROBE_TYPES[kind];
  if (type === undefined) throw new RangeError("unknown SDPN probe datagram type");
  const id = uuidToBytes(sessionId);
  const seq = requireU64(sequence, "sequence");
  const timestamp = requireU64(sentAtNs, "sentAtNs");
  const datagram = Buffer.allocUnsafe(SDPN_PROBE_DATAGRAM_BYTES);
  MAGIC.copy(datagram, 0);
  datagram.writeUInt8(1, 4);
  datagram.writeUInt8(type, 5);
  datagram.writeUInt16BE(0, 6);
  id.copy(datagram, 8);
  datagram.writeBigUInt64BE(seq, 24);
  datagram.writeBigUInt64BE(timestamp, 32);
  return datagram;
}

export function decodeProbeDatagram(datagramValue) {
  const datagram = requireBytes(datagramValue, "datagram");
  if (datagram.length !== SDPN_PROBE_DATAGRAM_BYTES) {
    throw new RangeError("SDPN probe datagram must be exactly 40 bytes");
  }
  if (!datagram.subarray(0, 4).equals(MAGIC)) {
    throw new Error("SDPN probe magic rejected");
  }
  if (datagram.readUInt8(4) !== 1) throw new Error("unsupported SDPN probe version");
  const kind = typeName(datagram.readUInt8(5));
  if (!kind) throw new Error("unknown SDPN probe datagram type");
  if (datagram.readUInt16BE(6) !== 0) {
    throw new Error("reserved SDPN probe flags must be zero");
  }
  return Object.freeze({
    kind,
    sessionId: bytesToUuid(datagram.subarray(8, 24)),
    sequence: datagram.readBigUInt64BE(24),
    sentAtNs: datagram.readBigUInt64BE(32)
  });
}

export function encodeProbeEcho(probe) {
  if (!probe || probe.kind !== "PROBE") {
    throw new TypeError("probe echo requires a decoded PROBE datagram");
  }
  return encodeProbeDatagram({ ...probe, kind: "ECHO" });
}
