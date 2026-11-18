import { createHash, randomUUID } from 'node:crypto';

const clone = (value) => structuredClone(value);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const supported = Object.freeze(['requested','carrier_accepted','profile_available','installed','network_attached','service_verified']);
export class MockCarrier {
  #lines = new Map();
  #events = [];
  constructor({provider='mock-carrier',now=()=>new Date().toISOString()}={}) {
    this.provider=provider; this.now=now;
  }
  provision({subscriberId,deviceEid}) {
    if(typeof subscriberId!=='string'||!/^[a-zA-Z0-9:_-]{1,128}$/.test(subscriberId)) throw new TypeError('invalid subscriber ID');
    if(typeof deviceEid!=='string'||!/^[0-9]{32}$/.test(deviceEid)) throw new TypeError('EID must be 32 digits');
    if(this.#lines.has(subscriberId)) throw new Error('line already exists');
    const line={subscriberId,deviceEid,provider:this.provider,profileId:randomUUID(),state:'requested',revision:1};
    this.#lines.set(subscriberId,line);
    this.#record(line);
    return clone(line);
  }
  advance(subscriberId,nextState) {
    const line=this.#lines.get(subscriberId);
    if(!line) throw new Error('unknown line');
    const from=supported.indexOf(line.state),to=supported.indexOf(nextState);
    if(to!==from+1) throw new Error('invalid carrier lifecycle transition');
    line.state=nextState;line.revision++;
    this.#record(line);
    return clone(line);
  }
  #record(line) {
    const event={id:randomUUID(),at:this.now(),subscriberId:line.subscriberId,state:line.state,revision:line.revision};
    this.#events.push({...event,receiptHash:hash(event)});
  }
  get(subscriberId) {const line=this.#lines.get(subscriberId);return line?clone(line):null;}
  events() {return clone(this.#events);}
}
