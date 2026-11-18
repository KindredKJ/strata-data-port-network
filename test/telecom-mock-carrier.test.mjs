import test from 'node:test';
import assert from 'node:assert/strict';
import {MockCarrier} from '../src/telecom/mock-carrier.mjs';
test('mock carrier creates profile and advances sequentially',()=>{
 const carrier=new MockCarrier({now:()=> '2026-11-18T00:00:00Z'});
 const eid='1'.repeat(32);
 let line=carrier.provision({subscriberId:'subscriber1',deviceEid:eid});
 assert.equal(line.state,'requested');
 for(const next of ['carrier_accepted','profile_available','installed','network_attached','service_verified']) line=carrier.advance('subscriber1',next);
 assert.equal(line.state,'service_verified');
 assert.equal(carrier.events().length,6);
 assert.equal(carrier.events().every(e=>/^[a-f0-9]{64}$/.test(e.receiptHash)),true);
 assert.throws(()=>carrier.advance('subscriber1','requested'),/invalid/);
});
test('mock carrier rejects invalid EID and out-of-order state',()=>{
 const carrier=new MockCarrier();
 assert.throws(()=>carrier.provision({subscriberId:'a',deviceEid:'invalid'}),/EID/);
 carrier.provision({subscriberId:'a',deviceEid:'2'.repeat(32)});
 assert.throws(()=>carrier.advance('a','installed'),/invalid/);
 assert.throws(()=>carrier.provision({subscriberId:'a',deviceEid:'2'.repeat(32)}),/already exists/);
});
