import { createHash, randomUUID } from 'node:crypto';

export const STATES = Object.freeze(['requested','carrier_accepted','profile_available','installed','network_attached','service_verified','failed']);
const ALLOWED = Object.freeze({
  requested: ['carrier_accepted','failed'],
  carrier_accepted: ['profile_available','failed'],
  profile_available: ['installed','failed'],
  installed: ['network_attached','failed'],
  network_attached: ['service_verified','failed'],
  service_verified: [],
  failed: []
});
const canonical = (value) => JSON.stringify(value);
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
export class SubscriberProvisioning {
  #records = new Map();
  #idempotency = new Map();
  #events = [];
  constructor({ now = () => new Date().toISOString() } = {}) {
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.now = now;
  }
  request({ subscriberId, idempotencyKey, provider }) {
    if (![subscriberId,idempotencyKey,provider].every(validId)) throw new TypeError('invalid subscriber, provider or idempotency key');
    const existing = this.#idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.subscriberId !== subscriberId || existing.provider !== provider) throw new Error('idempotency key conflict');
      return structuredClone(this.#records.get(subscriberId));
    }
    if (this.#records.has(subscriberId)) throw new Error('subscriber already exists');
    const record = { subscriberId, provider, state:'requested', version:1, requestId:randomUUID() };
    this.#records.set(subscriberId,record);
    this.#idempotency.set(idempotencyKey,{subscriberId,provider});
    this.#append(record,'request');
    return structuredClone(record);
  }
  transition({ subscriberId, nextState, expectedVersion, evidenceId }) {
    const record=this.#records.get(subscriberId);
    if (!record) throw new Error('subscriber not found');
    if (!STATES.includes(nextState) || !ALLOWED[record.state].includes(nextState)) throw new Error('invalid transition');
    if (!Number.isSafeInteger(expectedVersion) || record.version !== expectedVersion) throw new Error('version conflict');
    if (!validId(evidenceId)) throw new TypeError('evidenceId required');
    if (this.#events.some(e=>e.subscriberId===subscriberId && e.evidenceId===evidenceId)) throw new Error('duplicate evidence');
    record.state=nextState;
    record.version+=1;
    this.#append(record,'transition',evidenceId);
    return structuredClone(record);
  }
  get(subscriberId) {
    const record=this.#records.get(subscriberId);
    return record ? structuredClone(record) : null;
  }
  audit() { return structuredClone(this.#events); }
  verifyAudit() {
    let previousHash='0'.repeat(64);
    for (const event of this.#events) {
      if (event.previousHash !== previousHash) return false;
      const {hash,...unsigned}=event;
      if (digest(unsigned)!==hash) return false;
      previousHash=hash;
    }
    return true;
  }
  #append(record,action,evidenceId=null) {
    const previousHash=this.#events.at(-1)?.hash ?? '0'.repeat(64);
    const unsigned={sequence:this.#events.length+1,at:this.now(),action,subscriberId:record.subscriberId,provider:record.provider,state:record.state,version:record.version,evidenceId,previousHash};
    this.#events.push({...unsigned,hash:digest(unsigned)});
  }
}
