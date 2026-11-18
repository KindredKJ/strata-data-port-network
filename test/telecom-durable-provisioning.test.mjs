import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { DurableProvisioning, verifyWebhook } from '../src/telecom/durable-provisioning.mjs';

test('reopen restores subscriber state and idempotency',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kindred-telecom-'));
 try {
  const path=join(dir,'state.json');
  let store=await DurableProvisioning.open(path);
  await store.request({subscriberId:'s1',provider:'mock',idempotencyKey:'k1'});
  await store.transition({subscriberId:'s1',nextState:'carrier_accepted',expectedVersion:1,evidenceId:'e1'});
  store=await DurableProvisioning.open(path);
  assert.equal(store.get('s1').state,'carrier_accepted');
  assert.equal(store.verifyAudit(),true);
  const same=await store.request({subscriberId:'s1',provider:'mock',idempotencyKey:'k1'});
  assert.equal(same.version,2);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('authenticated webhook replay is rejected across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kindred-telecom-'));
 try {
  const path=join(dir,'state.json'),secret='test-secret-with-at-least-32-characters';
  let store=await DurableProvisioning.open(path);
  await store.request({subscriberId:'s2',provider:'mock',idempotencyKey:'k2'});
  const body=JSON.stringify({id:'w1',subscriberId:'s2',nextState:'carrier_accepted',expectedVersion:1,evidenceId:'e2'});
  const signature='sha256='+createHmac('sha256',secret).update(body).digest('hex');
  assert.equal(verifyWebhook({body,signature,secret}),true);
  assert.equal((await store.acceptWebhook({body,signature,secret})).duplicate,false);
  store=await DurableProvisioning.open(path);
  assert.equal((await store.acceptWebhook({body,signature,secret})).duplicate,true);
  await assert.rejects(store.acceptWebhook({body,signature:'sha256='+'0'.repeat(64),secret}),/signature/);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
