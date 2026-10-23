import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SDPNPortOrchestrator } from "../src/port-orchestrator.mjs";
const dir = await mkdtemp(join(tmpdir(), "sdpn-bench-"));
let instance;
try {
  instance = await SDPNPortOrchestrator.open({
    journalPath: join(dir,"journal.ndjson"),
    authorize: async () => ({ allowed:true, authorityId:"benchmark-only" }),
    transport: async (r) => ({ accepted:true, transferId:r.transferId, destinationId:r.destinationId, stateId:r.stateId, payloadSha256:r.payloadSha256, integrityVerified:true })
  });
  const port = (id,scopes,allowedDestinations=[]) => ({
    id, ownerId:"benchmark", scopes, allowedDestinations,
    expiresAt:Date.now()+120000, consentGranted:true, identityVerified:true, health:"healthy"
  });
  await instance.registerPort({ actor:"benchmark", port:port("a",["transfer:send"],["b"]) });
  await instance.registerPort({ actor:"benchmark", port:port("b",["transfer:receive"]) });
  const elapsed = [];
  for (let n=0; n<32; n++) {
    const start = process.hrtime.bigint();
    await instance.dispatch({ actor:"benchmark", sourceId:"a", destinationIds:["b"], stateId:"benchmark", payload:Uint8Array.of(1,2,3), idempotencyKey:"case-"+n });
    elapsed.push(Number(process.hrtime.bigint()-start)/1e6);
  }
  elapsed.sort((a,b)=>a-b);
  process.stdout.write(JSON.stringify({ schemaVersion:"kindred.sdpn.orchestrator.benchmark.v1", classification:"LOCAL_MOCK_CONNECTOR", sampleCount:elapsed.length, medianMs:elapsed[15], p95Ms:elapsed[30], actualNetworkMeasured:false, physicalZeroCopyProven:false, journalEvents:instance.snapshot().sequence }, null, 2)+"\n");
} finally { await instance?.close(); await rm(dir,{recursive:true,force:true}); }
