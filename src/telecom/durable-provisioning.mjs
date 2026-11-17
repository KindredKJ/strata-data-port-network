import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SubscriberProvisioning } from './subscriber-provisioning.mjs';

const safe = (s) => typeof s === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(s);
const canonical = (value) => JSON.stringify(value);
export function verifyWebhook({ body, signature, secret }) {
  if (typeof body !== 'string' || typeof signature !== 'string' || typeof secret !== 'string' || secret.length < 32) return false;
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const actual = Buffer.from(signature.slice(7),'hex');
  const expected = createHmac('sha256',secret).update(body).digest();
  return actual.length === expected.length && timingSafeEqual(actual,expected);
}
export class DurableProvisioning {
  #engine;
  #path;
  #seen = new Set();
  #chain = Promise.resolve();
  constructor(path, engine, seen) { this.#path=path; this.#engine=engine; this.#seen=seen; }
  static async open(path) {
    if (typeof path !== 'string' || !path) throw new TypeError('path required');
    const engine = new SubscriberProvisioning();
    let snapshot;
    try { snapshot=JSON.parse(await readFile(path,'utf8')); }
    catch(e) { if(e.code !== 'ENOENT') throw e; }
    const seen = new Set();
    if(snapshot) {
      if(snapshot.schema!==1 || !Array.isArray(snapshot.operations)) throw new Error('invalid snapshot');
      for(const operation of snapshot.operations) {
        if(operation.type==='request') engine.request(operation.args);
        else if(operation.type==='transition') engine.transition(operation.args);
        else throw new Error('unknown operation');
        if(operation.webhookId) {
          if(seen.has(operation.webhookId)) throw new Error('duplicate persisted webhook');
          seen.add(operation.webhookId);
        }
      }
      if(!engine.verifyAudit()) throw new Error('audit replay failure');
    }
    const store=new DurableProvisioning(path,engine,seen);
    store.operations=snapshot?.operations ?? [];
    return store;
  }
  #queue(fn) {
    const pending=this.#chain.then(fn);
    this.#chain=pending.catch(()=>{});
    return pending;
  }
  async #persist(operations) {
    await mkdir(dirname(this.#path),{recursive:true});
    const temp=this.#path+'.tmp';
    const handle=await open(temp,'w',0o600);
    try { await handle.writeFile(canonical({schema:1,operations})); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp,this.#path);
  }
  request(args) { return this.#queue(async()=>{
    const old=this.#engine.get(args.subscriberId);
    const result=this.#engine.request(args);
    if(old) return result;
    const next=[...this.operations,{type:'request',args}];
    await this.#persist(next);
    this.operations=next;
    return result;
  }); }
  transition(args) { return this.#queue(async()=>{
    const record=this.#engine.get(args.subscriberId);
    if(!record) throw new Error('subscriber not found');
    // Validate using a replayed candidate before committing to disk.
    const candidate=new SubscriberProvisioning();
    for(const op of this.operations) candidate[op.type](op.args);
    const result=candidate.transition(args);
    const next=[...this.operations,{type:'transition',args}];
    await this.#persist(next);
    this.operations=next;
    this.#engine=candidate;
    return result;
  }); }
  acceptWebhook({body,signature,secret}) { return this.#queue(async()=>{
    if(!verifyWebhook({body,signature,secret})) throw new Error('invalid webhook signature');
    const message=JSON.parse(body);
    if(!safe(message.id) || !safe(message.subscriberId) || !safe(message.evidenceId)) throw new Error('invalid webhook identifiers');
    if(this.#seen.has(message.id)) return {duplicate:true};
    const args={subscriberId:message.subscriberId,nextState:message.nextState,expectedVersion:message.expectedVersion,evidenceId:message.evidenceId};
    const candidate=new SubscriberProvisioning();
    for(const op of this.operations) candidate[op.type](op.args);
    const result=candidate.transition(args);
    const next=[...this.operations,{type:'transition',args,webhookId:message.id}];
    await this.#persist(next);
    this.operations=next; this.#engine=candidate; this.#seen.add(message.id);
    return {duplicate:false,record:result};
  }); }
  get(id) { return this.#engine.get(id); }
  audit() { return this.#engine.audit(); }
  verifyAudit() { return this.#engine.verifyAudit(); }
}
