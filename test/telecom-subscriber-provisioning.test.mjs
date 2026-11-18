import test from 'node:test';
import assert from 'node:assert/strict';
import {SubscriberProvisioning,STATES} from '../src/telecom/subscriber-provisioning.mjs';
test('complete lifecycle with local evidence',()=>{
 const p=new SubscriberProvisioning({now:()=> '2026-11-16T00:00:00.000Z'});
 let r=p.request({subscriberId:'demo1',idempotencyKey:'request1',provider:'mock'});
 assert.equal(r.state,'requested');
 assert.deepEqual(p.request({subscriberId:'demo1',idempotencyKey:'request1',provider:'mock'}),r);
 for(const [i,state] of STATES.slice(1,-1).entries()){
  r=p.transition({subscriberId:'demo1',nextState:state,expectedVersion:r.version,evidenceId:'event'+i});
 }
 assert.equal(r.state,'service_verified');
 assert.equal(p.audit().length,6);
 assert.equal(p.verifyAudit(),true);
 assert.throws(()=>p.transition({subscriberId:'demo1',nextState:'failed',expectedVersion:r.version,evidenceId:'late'}),/invalid transition/);
});
test('reject conflicts, skipped stages and duplicate evidence',()=>{
 const p=new SubscriberProvisioning();
 let r=p.request({subscriberId:'demo2',idempotencyKey:'key2',provider:'mock'});
 assert.throws(()=>p.request({subscriberId:'demo3',idempotencyKey:'key2',provider:'mock'}),/conflict/);
 assert.throws(()=>p.transition({subscriberId:'demo2',nextState:'installed',expectedVersion:1,evidenceId:'e1'}),/invalid transition/);
 r=p.transition({subscriberId:'demo2',nextState:'carrier_accepted',expectedVersion:1,evidenceId:'e1'});
 assert.throws(()=>p.transition({subscriberId:'demo2',nextState:'profile_available',expectedVersion:1,evidenceId:'e2'}),/version conflict/);
 assert.throws(()=>p.transition({subscriberId:'demo2',nextState:'profile_available',expectedVersion:2,evidenceId:'e1'}),/duplicate evidence/);
 assert.equal(p.verifyAudit(),true);
});
