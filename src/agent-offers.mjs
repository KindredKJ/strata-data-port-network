// Copyright 2026 Kindred Jermaine Cox and Kindred Labs.
// Signed commercial discovery records; no authority to contract or move money.
import { createPublicKey, verify } from 'node:crypto';
import { canonical, portIdentifier, parseCommunityPortUri } from '../community/src/index.mjs';

export const OFFER_SCHEMA = 'kindred.sdpn.commercial-offer.v1';
const MAX_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 8192;
const fields = ['schema','issuerPort','issuerPublicKey','offerId','revision','issuedAt','expiresAt','title','description','tags','contactUri','status'];
const exact = (value, keys) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('Unexpected offer fields');
};
const boundedText = (s,min,max) => typeof s === 'string' && s.length >= min && s.length <= max && s === s.trim() && !/[\u0000-\u001f\u007f]/u.test(s);
function validate(body, now) {
  exact(body, fields);
  if (!Number.isSafeInteger(now) || body.schema !== OFFER_SCHEMA ||
      portIdentifier(body.issuerPublicKey) !== body.issuerPort ||
      typeof body.offerId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(body.offerId) ||
      !Number.isSafeInteger(body.revision) || body.revision < 1 ||
      !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt) ||
      body.issuedAt > now || body.expiresAt <= now || body.expiresAt <= body.issuedAt ||
      body.expiresAt - body.issuedAt > MAX_TTL ||
      !boundedText(body.title, 1, 120) || !boundedText(body.description, 1, 1200) ||
      !Array.isArray(body.tags) || body.tags.length > 12 ||
      body.tags.some(t => typeof t !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(t)) ||
      new Set(body.tags).size !== body.tags.length ||
      !['active','withdrawn'].includes(body.status)) throw new Error('Invalid commercial offer');
  if (parseCommunityPortUri(body.contactUri).ownerPort !== body.issuerPort) throw new Error('Contact must belong to issuer');
  if (canonical(body).length > MAX_BYTES) throw new Error('Offer exceeds size limit');
}

export function signOffer(identity, offer, {now = Date.now(), ttlMs = 86400000} = {}) {
  exact(offer, ['offerId','revision','title','description','tags','contactUri','status']);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL) throw new Error('Invalid offer TTL');
  const body = {...offer, schema: OFFER_SCHEMA, issuerPort: identity.id,
    issuerPublicKey: identity.publicKey, issuedAt: now, expiresAt: now + ttlMs};
  validate(body, now);
  return identity.signRecord(body);
}

export function verifyOffer(envelope, now = Date.now()) {
  exact(envelope, ['body','signature']);
  validate(envelope.body, now);
  const {body, signature} = envelope;
  if (typeof signature !== 'string' || signature.length !== 88) throw new Error('Invalid signature encoding');
  const bytes = Buffer.from(signature, 'base64');
  const key = createPublicKey({key: Buffer.from(body.issuerPublicKey,'base64'), type:'spki', format:'der'});
  if (bytes.length !== 64 || bytes.toString('base64') !== signature ||
      !verify(null, canonical(body), key, bytes)) throw new Error('Invalid offer signature');
  return JSON.parse(canonical(body));
}

// A process-local discovery index. Durable storage, federation and operator authorization
// belong to a later service layer; this is not proof of business registration or contact reachability.
export class OfferIndex {
  #entries = new Map();
  #capacity;
  constructor({capacity = 10000} = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100000) throw new Error('Invalid capacity');
    this.#capacity = capacity;
  }
  publish(envelope, now = Date.now()) {
    const body = verifyOffer(envelope, now);
    const key = body.issuerPort + '/' + body.offerId;
    const previous = this.#entries.get(key);
    if (previous && body.revision <= previous.body.revision) throw new Error('Stale or repeated offer revision');
    if (!previous && this.#entries.size >= this.#capacity) throw new Error('Offer index capacity reached');
    this.#entries.set(key, {body, signature: envelope.signature});
    return structuredClone(body);
  }
  search(query = '', {now = Date.now(), limit = 20} = {}) {
    if (typeof query !== 'string' || query.length > 120 || !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid search');
    const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
    return [...this.#entries.values()].filter(({body}) => {
      if (body.status !== 'active' || body.expiresAt <= now || body.issuedAt > now) return false;
      const searchable = [body.title,body.description,...body.tags].join(' ').toLowerCase();
      return terms.every(term => searchable.includes(term));
    }).sort((a,b) => b.body.issuedAt-a.body.issuedAt ||
      a.body.issuerPort.localeCompare(b.body.issuerPort) || a.body.offerId.localeCompare(b.body.offerId))
      .slice(0,limit).map(record => structuredClone(record));
  }
}
