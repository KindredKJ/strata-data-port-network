# SDPN Native Terminal + First-Party Cognition Foundation

**Founder:** Kindred Jermaine Cox. **Implementation issue:** #63.

This additive PR installs a Node-side **local SDPN cognition client** for existing transport, portal, and agent services. It requires no third-party AI provider, credentials, external URL, external DNS resolution or production deployment. It is opt-in, not a replacement for Port Zero, the SW06-F runtime, agent identity or the current portal.

`src/native-cognition-client.mjs` exports `requestNativeCognition` with a strict literal loopback HTTP allowlist (`127.0.0.1` or `::1`), no redirects, bounded input, optional `SDPN_AI_LOCAL_TOKEN`, and versioned `kindred.sdpn.cognition.v1` responses. Calls do **not** execute terminal commands automatically.

```js
import { requestNativeCognition } from "./src/native-cognition-client.mjs";

const result = await requestNativeCognition({
  input: "diagnose SW06-F transfer timeout"
});
console.log(result.output, result.engine, result.generative);
```

Test locally: `node --test test/native-cognition.test.mjs`.

The cross-platform native terminal candidate exists as a separately built developer deliverable (Go standard-library source, standalone Windows/Linux x86-64 binaries, Python wheel). Its local tests, race test, Windows cross-build, native encrypted SW06-F loopback, Python HMAC receipt verification and first-party local cognition API were executed successfully in the founder's development session. **The native terminal source and binaries are not yet part of this PR**; issue #63 tracks their transparent integration and further acceptance.

The current native cognition implementation uses a deterministic **offline-rules** engine; this is not a generative/neural model. Integrating proven Auxiliary weights, tokenizer, inference kernels, safety/capability controls and first-party local APIs is separate, pending work. No false claim of complete polyglot compiler support, PTY/ConPTY parity, physical peer proofs, provider independence for OS toolchains or global SDPN readiness is made.

Do not mark any of the four global network launch gates 25/25 because this opt-in local SDK passes.
