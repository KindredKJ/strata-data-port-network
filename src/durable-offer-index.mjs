// Copyright 2026 Kindred Jermaine Cox and Kindred Labs.
// Persistent local discovery store. Requires Node 22.13+ (node:sqlite).
import { DatabaseSync } from 'node:sqlite';
import { canonical } from '../community/src/index.mjs';
import { verifyOffer } from './agent-offers.mjs';

export class DurableOfferIndex {
  #db;
  #capacity;
  #issuerQuota;
  constructor(filename, { capacity = 10000, issuerQuota = 100 } = {}) {
    if (typeof filename !== 'string' || !filename || !Number.isSafeInteger(capacity) ||
        capacity < 1 || capacity > 100000 || !Number.isSafeInteger(issuerQuota) ||
        issuerQuota < 1 || issuerQuota > capacity) throw new Error('Invalid index configuration');
    this.#capacity = capacity;
    this.#issuerQuota = issuerQuota;
    this.#db = new DatabaseSync(filename);
    try {
      this.#db.exec(`PRAGMA busy_timeout=5000;
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS offers (
          issuer TEXT NOT NULL, offer_id TEXT NOT NULL, revision INTEGER NOT NULL,
          issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL,
          envelope TEXT NOT NULL,
          PRIMARY KEY (issuer, offer_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS offers_active ON offers(status, expires_at, issued_at);
      `);
    } catch (error) { this.#db.close(); throw error; }
  }
  publish(envelope, now = Date.now()) {
    const body = verifyOffer(envelope, now);
    const record = { body, signature: envelope.signature };
    const db = this.#db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db.prepare('SELECT revision FROM offers WHERE issuer=? AND offer_id=?')
        .get(body.issuerPort, body.offerId);
      if (existing && body.revision <= existing.revision) throw new Error('Stale or repeated offer revision');
      if (!existing) {
        if (db.prepare('SELECT count(*) AS n FROM offers').get().n >= this.#capacity)
          throw new Error('Offer index capacity reached');
        if (db.prepare('SELECT count(*) AS n FROM offers WHERE issuer=?').get(body.issuerPort).n >= this.#issuerQuota)
          throw new Error('Issuer offer quota reached');
      }
      db.prepare(`INSERT INTO offers VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(issuer, offer_id) DO UPDATE SET
        revision=excluded.revision, issued_at=excluded.issued_at, expires_at=excluded.expires_at,
        status=excluded.status, envelope=excluded.envelope`)
        .run(body.issuerPort, body.offerId, body.revision, body.issuedAt,
          body.expiresAt, body.status, canonical(record).toString('utf8'));
      db.exec('COMMIT');
      return body;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  search(query = '', { now = Date.now(), limit = 20 } = {}) {
    if (typeof query !== 'string' || query.length > 120 || !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid search');
    const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
    const result = [];
    const rows = this.#db.prepare(`SELECT envelope FROM offers
      WHERE status='active' AND expires_at>? AND issued_at<=?
      ORDER BY issued_at DESC, issuer, offer_id`).iterate(now, now);
    for (const row of rows) {
      const envelope = JSON.parse(row.envelope);
      const { title, description, tags } = envelope.body;
      const haystack = [title, description, ...tags].join(' ').toLowerCase();
      if (!terms.every(t => haystack.includes(t))) continue;
      // Revalidate before serving a persisted record; corruption fails closed.
      verifyOffer(envelope, now);
      result.push(envelope);
      if (result.length === limit) break;
    }
    return result;
  }
  close() { this.#db.close(); }
}
