/**
 * SDPN first-party local cognition protocol client (no hosted provider).
 * Sends requests exclusively to literal loopback, never follows redirects.
 * Use in existing SDPN transport/portal/agent layers through explicit imports.
 */
export const SDPN_COGNITION_SCHEMA = "kindred.sdpn.cognition.v1";

export function requireNativeEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" ||
      !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password ||
      url.pathname !== "/v1/cognition" ||
      url.search || url.hash) {
    throw new Error("SDPN native cognition requires a literal loopback HTTP endpoint");
  }
  return url.href;
}

export async function requestNativeCognition({
  input,
  source = "sdpn-agent",
  endpoint = "http://127.0.0.1:18281/v1/cognition",
  token = process.env.SDPN_AI_LOCAL_TOKEN ?? "",
  timeoutMs = 15000
} = {}) {
  if (typeof input !== "string" || input.length < 1 || input.length > 16384) {
    throw new TypeError("input must be nonempty text up to 16384 characters");
  }
  if (typeof source !== "string" || source.length > 128) {
    throw new TypeError("invalid source");
  }
  const url = requireNativeEndpoint(endpoint);
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ input, source, mode: "local" })
  });
  if (!response.ok) throw new Error(`SDPN cognition HTTP ${response.status}`);
  const result = await response.json();
  if (result.schema !== SDPN_COGNITION_SCHEMA ||
      typeof result.output !== "string" || !result.output ||
      typeof result.engine !== "string" ||
      typeof result.generative !== "boolean") {
    throw new Error("unrecognized SDPN local cognition response");
  }
  return Object.freeze(result);
}
