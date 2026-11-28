import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { requestNativeCognition, requireNativeEndpoint } from "../src/native-cognition-client.mjs";

test("rejects provider URLs, DNS redirects and external inference", () => {
  for (const endpoint of [
    "https://example.com/v1/cognition",
    "http://localhost:18281/v1/cognition",
    "http://8.8.8.8:18281/v1/cognition",
    "http://127.0.0.1:18281/v1/cognition?redirect=https://example.com"
  ]) assert.throws(() => requireNativeEndpoint(endpoint));
});

test("validates local-only JSON protocol", async () => {
  const server = http.createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    const parsed = JSON.parse(data);
    assert.equal(parsed.input, "diagnose transport");
    assert.equal(parsed.source, "sdpn-agent");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ schema: "kindred.sdpn.cognition.v1", output: "Local guidance", engine: "offline-rules", generative: false }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const result = await requestNativeCognition({ input: "diagnose transport", endpoint: `http://127.0.0.1:${port}/v1/cognition` });
    assert.equal(result.output, "Local guidance");
    assert.equal(result.generative, false);
    assert.equal(Object.isFrozen(result), true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
