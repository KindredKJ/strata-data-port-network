import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunityIdentity, communityPortUri} from '../community/src/index.mjs';
import {signOffer,verifyOffer,OfferIndex} from '../src/agent-offers.mjs';

const now = 1800000000000;
const a = createCommunityIdentity(), b = createCommunityIdentity();
const offer = (identity, overrides = {}) => ({
  offerId:'compute',revision:1,title:'Agent compute',description:'Inference and analysis services',
  tags:['compute','ai'],contactUri:communityPortUri(identity.id,'business'),status:'active',...overrides
});
const issue = (identity=a, overrides={}, options={}) =>
  signOffer(identity,offer(identity,overrides),{now,ttlMs:60000,...options});

test('valid signed offer uses existing self-certifying identity and searchable tags',()=>{
  const signed=issue();
  assert.equal(verifyOffer(signed,now).issuerPort,a.id);
  const index=new OfferIndex();
  index.publish(signed,now);
  assert.equal(index.search('compute ai',{now}).length,1);
  assert.equal(index.search('unrelated',{now}).length,0);
  assert.deepEqual(index.search('compute',{now})[0],signed);
});
test('tampering, impostor signatures, foreign contacts and invalid input are rejected',()=>{
  const signed=issue();
  assert.throws(()=>verifyOffer({...signed,body:{...signed.body,title:'Tampered'}},now));
  assert.throws(()=>verifyOffer({...signed,signature:issue(b).signature},now));
  assert.throws(()=>issue(a,{contactUri:communityPortUri(b.id,'business')}));
  assert.throws(()=>issue(a,{tags:['ai','ai']}));
  assert.throws(()=>issue(a,{revision:0}));
  assert.throws(()=>issue(a,{title:'bad\nvalue'}));
  assert.throws(()=>issue(a,{}, {ttlMs:604800001}));
});
test('expiry and future timestamps prevent publication and expired discovery',()=>{
  const index=new OfferIndex();
  const signed=issue();
  index.publish(signed,now);
  assert.equal(index.search('',{now:now+60000}).length,0);
  assert.throws(()=>verifyOffer(signed,now+60000));
  assert.throws(()=>verifyOffer(signed,now-1));
});
test('revision ordering, withdrawal and issuer isolation prevent local replay',()=>{
  const index=new OfferIndex();
  const signed=issue();
  index.publish(signed,now);
  index.publish(issue(b),now);
  assert.throws(()=>index.publish(signed,now));
  index.publish(issue(a,{revision:2,status:'withdrawn'}),now);
  assert.equal(index.search('',{now}).length,1);
  assert.throws(()=>index.publish(signed,now));
  index.publish(issue(a,{revision:3}),now);
  assert.equal(index.search('',{now}).length,2);
});
test('bounded index and copy isolation',()=>{
  const index=new OfferIndex({capacity:1});
  const published=index.publish(issue(),now);
  published.title='Mutated';
  assert.throws(()=>index.publish(issue(b),now));
  const result=index.search('',{now})[0];
  assert.equal(result.body.title,'Agent compute');
  result.body.title='Mutated again';
  assert.equal(index.search('',{now})[0].body.title,'Agent compute');
  assert.throws(()=>index.search('',{now,limit:101}));
  assert.throws(()=>new OfferIndex({capacity:0}));
});
