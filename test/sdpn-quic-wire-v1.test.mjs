import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SDPN_MAX_STREAM_BODY_BYTES,
  SDPN_NATIVE_FRAME_SCHEMA,
  SDPN_PROBE_DATAGRAM_BYTES,
  SDPN_PROBE_TYPES,
  SDPN_QUIC_PROFILE_V1,
  SDPN_STREAM_RECORD_TYPES,
  decodeCanonicalControlRecord,
  decodeNativeFrameRecord,
  decodeProbeDatagram,
  decodeStreamRecord,
  encodeCanonicalControlRecord,
  encodeNativeFrameRecord,
  encodeProbeDatagram,
  encodeProbeEcho,
  encodeStreamRecord
} from "../src/sdpn-quic-wire-v1.mjs";

const manifest = JSON.parse(readFileSync(
  new URL("../protocol/sdpn-quic-wire-v1.json", import.meta.url),
  "utf8"
));

test("wire profile pins Kindred Labs authorship, domain, QUIC, and no-routing semantics", () => {
  assert.equal(manifest.creator, "Kindred Jermaine Cox");
  assert.equal(manifest.organization, "Kindred Labs");
  assert.equal(manifest.officialProjectDomain, "kindredlabs.ai");
  assert.equal(manifest.profileId, SDPN_QUIC_PROFILE_V1.profileId);
  assert.equal(manifest.alpn, "sdpn/1");
  assert.equal(manifest.logicalRouting, false);
  assert.equal(manifest.routeTableChanges, false);
  assert.equal(manifest.forwardingOrTransit, false);
  assert.equal(manifest.quicVersion, "1");
  assert.equal(manifest.tlsMinimumVersion, "1.3");
});

test("canonical control records round-trip using the existing SDPN canonical JSON", () => {
  const value = {
    schema: "kindred.sdpn.peer-record.v1",
    body: { portId: "strata:port:ed25519:" + "a".repeat(64), revision: 1 },
    signature: "c2lnbmF0dXJl"
  };
  const encoded = encodeCanonicalControlRecord(SDPN_STREAM_RECORD_TYPES.PORT_BIND, value);
  const decoded = decodeCanonicalControlRecord(encoded);
  assert.equal(decoded.type, SDPN_STREAM_RECORD_TYPES.PORT_BIND);
  assert.deepEqual(decoded.value, value);
  assert.equal(encoded.readUInt32BE(8), encoded.length - 12);
});

test("stream records reject unknown versions, flags, lengths, types, and oversized bodies", () => {
  const encoded = encodeStreamRecord(SDPN_STREAM_RECORD_TYPES.RECEIPT, Buffer.from("{}"));
  const badVersion = Buffer.from(encoded);
  badVersion[4] = 2;
  assert.throws(() => decodeStreamRecord(badVersion), /version/);

  const badFlags = Buffer.from(encoded);
  badFlags.writeUInt16BE(1, 6);
  assert.throws(() => decodeStreamRecord(badFlags), /flags/);

  const badType = Buffer.from(encoded);
  badType[5] = 0xff;
  assert.throws(() => decodeStreamRecord(badType), /type/);

  const badLength = Buffer.from(encoded);
  badLength.writeUInt32BE(3, 8);
  assert.throws(() => decodeStreamRecord(badLength), /length mismatch/);

  assert.throws(
    () => encodeStreamRecord(SDPN_STREAM_RECORD_TYPES.NATIVE_FRAME, Buffer.alloc(SDPN_MAX_STREAM_BODY_BYTES + 1)),
    /exceeds profile limit/
  );
});

test("native session frames use compact binary ciphertext and preserve authenticated fields", () => {
  const frame = {
    schema: SDPN_NATIVE_FRAME_SCHEMA,
    sessionId: "00000000-0000-4000-8000-000000000001",
    sequence: 17,
    ciphertext: Buffer.from([0, 1, 2, 255]).toString("base64"),
    tag: Buffer.alloc(16, 0xa5).toString("base64")
  };
  const encoded = encodeNativeFrameRecord(frame);
  const decoded = decodeNativeFrameRecord(encoded);
  assert.deepEqual(decoded, frame);
  assert.equal(encoded[5], SDPN_STREAM_RECORD_TYPES.NATIVE_FRAME);

  assert.throws(
    () => encodeNativeFrameRecord({ ...frame, sequence: 1024 }),
    /sequence/
  );
  assert.throws(
    () => encodeNativeFrameRecord({ ...frame, tag: Buffer.alloc(15).toString("base64") }),
    /encoding/
  );
  assert.throws(
    () => encodeNativeFrameRecord({ ...frame, ciphertext: "YQ===" }),
    /encoding/
  );
});

test("QUIC DATAGRAM probe and echo are fixed-size and use sender monotonic time", () => {
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const probe = encodeProbeDatagram({
    sessionId,
    sequence: 0xffffffffffffffffn,
    sentAtNs: 1234567890123456789n
  });
  assert.equal(probe.length, SDPN_PROBE_DATAGRAM_BYTES);
  assert.equal(probe[5], SDPN_PROBE_TYPES.PROBE);

  const decoded = decodeProbeDatagram(probe);
  assert.equal(decoded.kind, "PROBE");
  assert.equal(decoded.sessionId, sessionId);
  assert.equal(decoded.sequence, 0xffffffffffffffffn);
  assert.equal(decoded.sentAtNs, 1234567890123456789n);

  const echo = decodeProbeDatagram(encodeProbeEcho(decoded));
  assert.equal(echo.kind, "ECHO");
  assert.equal(echo.sessionId, decoded.sessionId);
  assert.equal(echo.sequence, decoded.sequence);
  assert.equal(echo.sentAtNs, decoded.sentAtNs);
  assert.throws(() => decodeProbeDatagram(Buffer.alloc(39)), /40 bytes/);

  const badFlags = Buffer.from(probe);
  badFlags.writeUInt16BE(1, 6);
  assert.throws(() => decodeProbeDatagram(badFlags), /flags/);
});
