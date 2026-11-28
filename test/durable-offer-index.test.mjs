import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommunityIdentity, communityPortUri } from '../community/src/index.mjs';
import { signOffer } from '../src/agent-offers.mjs';
import { DurableOfferIndex } from '../src/durable-offer-index.mjs';
const now=1800000000000;
const a=createCommunityIdentity(), b=createCommunityIdentity();
const issue=(identity=a,revision=1,status='active',offerId='compute')=>signOffer(identity,{offerId,revision,status,title:'Agent compute',description:'Inference services',tags:['compute','ai'],contactUri:communityPortUri(identity.id,'business')},{now,ttlMs:60000});
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'sdpn-offers-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'offers.sqlite');}
test('offers, revisions and withdrawals survive restart',t=>{
 const file=fixture(t); let index=new DurableOfferIndex(file);
 try{index.publish(issue(),now);assert.equal(index.search('compute ai',{now}).length,1);index.publish(issue(a,2,'withdrawn'),now);index.publish(issue(b),now);}finally{index.close();}
 index=new DurableOfferIndex(file);
 try{assert.throws(()=>index.publish(issue(),now),/Stale/);assert.deepEqual(index.search('',{now}),[issue(b)]);index.publish(issue(a,3),now);assert.equal(index.search('',{now}).length,2);assert.equal(index.search('',{now:now+60000}).length,0);assert.throws(()=>index.publish(issue(a,2),now),/Stale/);}finally{index.close();}
});
test('durable quotas and independent handles preserve revision ordering',t=>{
 const file=fixture(t);const first=new DurableOfferIndex(file,{capacity:2,issuerQuota:1});const second=new DurableOfferIndex(file,{capacity:2,issuerQuota:1});
 try{first.publish(issue(a,2),now);assert.throws(()=>second.publish(issue(),now),/Stale/);assert.throws(()=>second.publish(issue(a,1,'active','other'),now),/quota/);second.publish(issue(b),now);assert.throws(()=>first.publish(issue(createCommunityIdentity()),now),/capacity/);assert.equal(first.search('',{now,limit:1}).length,1);assert.equal(second.search('unrelated',{now}).length,0);const tampered=issue(a,3);tampered.body.title='Changed';assert.throws(()=>first.publish(tampered,now),/signature/);}finally{first.close();second.close();}
});
