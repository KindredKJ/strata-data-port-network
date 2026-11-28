import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { TWO_HOST_PROOF_SCHEMA, startProofReceiver, sendTwoHostProof, receiptTranscript } from "../src/two-machine-proof.mjs";

const secret = "isolated-test-only-proof-secret-32-characters";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const payload = Buffer.from('{"kindred":"hardening"}');
const hello = () => ({ schemaVersion: TWO_HOST_PROOF_SCHEMA,
  sourceHostFingerprint: "a".repeat(64), stateId: "kindred-state:test", stateHash: digest(payload),
  generation: 1, payloadSha256: digest(payload), payloadBytes: payload.length });
async function challenge(receiver, value = hello()) {
  return fetch(`http://127.0.0.1:${receiver.port}/proof/challenge`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value)
  });
}
function transfer(receiver, c, suffix = "") {
  const h = hello();
  const transcript = [TWO_HOST_PROOF_SCHEMA, c.sessionId, c.challenge, h.sourceHostFingerprint,
    c.destinationHostFingerprint, h.stateId, h.stateHash, "1", h.payloadSha256, String(payload.length)].join("|");
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.from(c.challenge, "hex"),
    Buffer.from(`kindred-sdpn-sw06f|${c.sessionId}`), 32));
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(transcript), { plaintextLength: payload.length });
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return () => fetch(`http://127.0.0.1:${receiver.port}/proof/transfer`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "x-kindred-session": c.sessionId,
      "x-kindred-proof-auth": createHmac("sha256", secret).update(transcript).digest("hex") + suffix,
      "x-kindred-proof-iv": iv.toString("base64url"), "x-kindred-proof-tag": cipher.getAuthTag().toString("base64url") },
    body: ciphertext
  });
}

test("session capacity rejects concurrent excess and recovers after expiry", async (t) => {
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret, maxSessions: 2, challengeTtlMs: 250 });
  t.after(() => receiver.close());
  const responses = await Promise.all(Array.from({ length: 6 }, () => challenge(receiver)));
  assert.equal(responses.filter(x => x.status === 200).length, 2);
  assert.equal(responses.filter(x => x.status === 429).length, 4);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal((await challenge(receiver)).status, 200);
});

test("authenticated session accepts only one simultaneous transfer", async (t) => {
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret });
  t.after(() => receiver.close());
  const c = await (await challenge(receiver)).json(), send = transfer(receiver, c);
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 401]);
});

test("valid MAC with nonhex suffix is rejected", async (t) => {
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret });
  t.after(() => receiver.close());
  const c = await (await challenge(receiver)).json();
  assert.equal((await transfer(receiver, c, "zz")()).status, 403);
});

test("expired session cannot transfer", async (t) => {
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret, challengeTtlMs: 25 });
  t.after(() => receiver.close());
  const c = await (await challenge(receiver)).json();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await transfer(receiver, c)()).status, 401);
});

test("ambiguous transcript identifiers and mismatching state hashes are rejected", async (t) => {
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret });
  t.after(() => receiver.close());
  for (const bad of [{ ...hello(), stateId: "state|injected" }, { ...hello(), sourceHostFingerprint: "arbitrary" },
    { ...hello(), stateHash: "b".repeat(64) }]) assert.equal((await challenge(receiver, bad)).status, 400);
});

test("sender rejects MAC-valid receipts bound to the wrong session or elevated claims", async (t) => {
  const receiver = await startProofReceiver({ host: "127.0.0.1", port: 0, secret });
  t.after(() => receiver.close());
  for (const mutation of [r => { r.sessionId = '00000000-0000-4000-8000-000000000000'; },
    r => { r.productionReadyClaim = true; }, r => { r.authenticationVerified = false; }]) {
    const proxy = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(`http://127.0.0.1:${receiver.port}${request.url}`, {
        method: request.method, headers: Object.fromEntries(Object.entries(request.headers).filter(([key]) => key.startsWith('x-kindred-') || key === 'content-type')),
        body: Buffer.concat(chunks)
      });
      const body = await upstream.json();
      if (request.url === '/proof/transfer' && upstream.ok) {
        mutation(body);
        body.receiptMac = createHmac('sha256', secret).update(receiptTranscript(body)).digest('hex');
      }
      response.writeHead(upstream.status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(sendTwoHostProof({ host: '127.0.0.1', port: proxy.address().port, secret,
        canonicalPayload: payload, stateId: hello().stateId, stateHash: digest(payload), generation: 1 }), /receipt identity, encryption, or integrity/);
    } finally { await new Promise(resolve => proxy.close(resolve)); }
  }
});
