"""Kindred Agent Economy v1: durable, tenant-isolated port actors and economic state.

Additive integration. Does not replace Strata/ASP, does not custody funds.
SQLite WAL is a durable single-host profile; use a transactional shared database
before running multiple hosts against the same economic ledger.
"""
from __future__ import annotations
import contextlib
import hashlib
import hmac
import json
import os
import sqlite3
import time
from pathlib import Path

VERSION = "kindred.port-agent.v1"

def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def digest(value):
    return hashlib.sha256(canon(value).encode()).hexdigest()

def nonnegative(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 2**63 - 1:
        raise ValueError("invalid integer minor-unit amount")
    return value

def required(value, name):
    if not isinstance(value, str) or not value or len(value) > 200:
        raise ValueError("invalid " + name)
    return value

class StateConflict(Exception):
    pass

class EconomyStore:
    def __init__(self, path):
        self.path = str(Path(path).resolve())
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as c:
            c.executescript("""
            CREATE TABLE IF NOT EXISTS agents (
                agent_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, port_id TEXT NOT NULL,
                owner_id TEXT NOT NULL, lineage TEXT NOT NULL, policy_version TEXT NOT NULL,
                lifecycle TEXT NOT NULL DEFAULT 'active', memory_namespace TEXT NOT NULL,
                created_at INTEGER NOT NULL, UNIQUE(tenant_id,port_id));
            CREATE TABLE IF NOT EXISTS grants (
                grant_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL,
                capability TEXT NOT NULL, budget_id TEXT NOT NULL, ceiling INTEGER NOT NULL,
                expires_at INTEGER NOT NULL, revoked_at INTEGER, signed_digest TEXT NOT NULL,
                FOREIGN KEY(agent_id) REFERENCES agents(agent_id));
            CREATE TABLE IF NOT EXISTS budgets (
                budget_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL,
                asset TEXT NOT NULL, capacity INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0,
                spent INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(agent_id) REFERENCES agents(agent_id),
                CHECK(capacity>=0 AND reserved>=0 AND spent>=0 AND reserved+spent<=capacity));
            CREATE TABLE IF NOT EXISTS reservations (
                operation_id TEXT PRIMARY KEY, budget_id TEXT NOT NULL, grant_id TEXT NOT NULL,
                request_digest TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
                created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS mailboxes (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL,
                message_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
                completed_at INTEGER, UNIQUE(agent_id,message_id));
            CREATE TABLE IF NOT EXISTS leases (
                agent_id TEXT PRIMARY KEY, holder TEXT NOT NULL, epoch INTEGER NOT NULL,
                expires_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS memories (
                agent_id TEXT NOT NULL, tenant_id TEXT NOT NULL, key TEXT NOT NULL,
                value TEXT NOT NULL, updated_at INTEGER NOT NULL,
                PRIMARY KEY(agent_id,key));
            CREATE TABLE IF NOT EXISTS checkpoints (
                workflow_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL,
                state TEXT NOT NULL, epoch INTEGER NOT NULL, payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS purchases (
                purchase_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL,
                request_digest TEXT NOT NULL, requirement TEXT NOT NULL,
                status TEXT NOT NULL, signature_digest TEXT, facilitator_receipt TEXT,
                chain_receipt TEXT, tx_hash TEXT UNIQUE, updated_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS money_events (
                event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_ref TEXT NOT NULL,
                purchase_id TEXT NOT NULL, kind TEXT NOT NULL, asset TEXT NOT NULL,
                amount INTEGER NOT NULL, state TEXT NOT NULL, raw TEXT NOT NULL,
                created_at INTEGER NOT NULL, UNIQUE(provider,provider_ref,kind));
            CREATE TABLE IF NOT EXISTS journal (
                tx_id TEXT NOT NULL, account TEXT NOT NULL, asset TEXT NOT NULL,
                delta INTEGER NOT NULL, created_at INTEGER NOT NULL,
                PRIMARY KEY(tx_id,account));
            CREATE TABLE IF NOT EXISTS evidence (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, prev_hash TEXT NOT NULL,
                event_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS mailbox_pending ON mailboxes(tenant_id,agent_id,completed_at,seq);
            CREATE INDEX IF NOT EXISTS evidence_chain ON evidence(sequence);
            """)
    def connect(self):
        c = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=FULL")
        c.execute("PRAGMA busy_timeout=15000")
        return c

    @contextlib.contextmanager
    def tx(self):
        c = self.connect()
        try:
            c.execute("BEGIN IMMEDIATE")
            yield c
            c.commit()
        except:
            c.rollback()
            raise
        finally:
            c.close()

    def _event(self, c, data):
        previous = c.execute("SELECT event_hash FROM evidence ORDER BY sequence DESC LIMIT 1").fetchone()
        prev = previous["event_hash"] if previous else "0" * 64
        body = canon(data)
        event_hash = hashlib.sha256((prev + body).encode()).hexdigest()
        c.execute("INSERT INTO evidence(event,prev_hash,event_hash,created_at) VALUES(?,?,?,?)",
                  (body, prev, event_hash, int(time.time())))
        return event_hash

    def register_agent(self, *, agent_id, tenant_id, port_id, owner_id, parent_agent_id=None):
        for name, value in (("agent_id",agent_id),("tenant_id",tenant_id),
                            ("port_id",port_id),("owner_id",owner_id)):
            required(value,name)
        now = int(time.time())
        with self.tx() as c:
            c.execute("""INSERT INTO agents(agent_id,tenant_id,port_id,owner_id,lineage,
                policy_version,memory_namespace,created_at) VALUES(?,?,?,?,?,?,?,?)""",
                (agent_id,tenant_id,port_id,owner_id,canon({"parent":parent_agent_id}),
                 VERSION,tenant_id + ":" + agent_id,now))
            self._event(c,{"type":"agent.registered","agent_id":agent_id,
                           "tenant_id":tenant_id,"port_id":port_id})
        return agent_id

    def agent(self, tenant_id, agent_id):
        with self.connect() as c:
            x = c.execute("SELECT * FROM agents WHERE tenant_id=? AND agent_id=?",
                          (tenant_id,agent_id)).fetchone()
            return dict(x) if x else None

    def grant(self, payload, signature, brainstem_key):
        """Only Brainstem may authorize: HMAC of canonical grant, shared via secret manager."""
        if not brainstem_key or len(brainstem_key) < 32:
            raise PermissionError("Brainstem issuer key required")
        expected = hmac.new(brainstem_key.encode(),canon(payload).encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected,signature):
            raise PermissionError("invalid Brainstem grant signature")
        keys = ("grant_id","tenant_id","agent_id","capability","budget_id","ceiling","expires_at")
        if set(payload) != set(keys): raise ValueError("invalid grant fields")
        for x in keys[:5]: required(payload[x],x)
        nonnegative(payload["ceiling"])
        if type(payload["expires_at"]) is not int or payload["expires_at"] <= time.time():
            raise ValueError("expired grant")
        with self.tx() as c:
            actor=c.execute("SELECT 1 FROM agents WHERE agent_id=? AND tenant_id=? AND lifecycle='active'",
                            (payload["agent_id"],payload["tenant_id"])).fetchone()
            budget=c.execute("SELECT 1 FROM budgets WHERE budget_id=? AND agent_id=? AND tenant_id=?",
                             (payload["budget_id"],payload["agent_id"],payload["tenant_id"])).fetchone()
            if not actor or not budget: raise PermissionError("agent or budget mismatched")
            c.execute("INSERT INTO grants VALUES(?,?,?,?,?,?,?,?,NULL,?)",
                      (*[payload[x] for x in keys],expected))
            self._event(c,{"type":"brainstem.grant","grant_id":payload["grant_id"]})
        return payload["grant_id"]

    def revoke(self, grant_id):
        with self.tx() as c:
            cur=c.execute("UPDATE grants SET revoked_at=? WHERE grant_id=? AND revoked_at IS NULL",
                          (int(time.time()),grant_id))
            if cur.rowcount != 1: raise StateConflict("grant not active")
            self._event(c,{"type":"brainstem.revoked","grant_id":grant_id})

    def create_budget(self, budget_id,tenant_id,agent_id,asset,capacity):
        nonnegative(capacity)
        for n,v in (("budget_id",budget_id),("asset",asset)): required(v,n)
        with self.tx() as c:
            if not c.execute("SELECT 1 FROM agents WHERE agent_id=? AND tenant_id=?",
                             (agent_id,tenant_id)).fetchone():
                raise PermissionError("agent not in tenant")
            c.execute("INSERT INTO budgets(budget_id,tenant_id,agent_id,asset,capacity) VALUES(?,?,?,?,?)",
                      (budget_id,tenant_id,agent_id,asset,capacity))
            self._event(c,{"type":"budget.created","budget_id":budget_id,"capacity":capacity,"asset":asset})

    def reserve(self, *, operation_id,grant_id,tenant_id,agent_id,capability,amount,request):
        nonnegative(amount)
        if amount == 0: raise ValueError("reservation must be positive")
        request_digest = digest(request)
        with self.tx() as c:
            prior=c.execute("SELECT * FROM reservations WHERE operation_id=?",(operation_id,)).fetchone()
            if prior:
                if prior["request_digest"] != request_digest or prior["amount"] != amount or prior["grant_id"] != grant_id:
                    raise StateConflict("idempotency conflict")
                return dict(prior)
            g=c.execute("""SELECT g.*,a.lifecycle,b.asset,b.capacity,b.spent,b.reserved
                 FROM grants g JOIN agents a ON a.agent_id=g.agent_id AND a.tenant_id=g.tenant_id
                 JOIN budgets b ON b.budget_id=g.budget_id AND b.agent_id=g.agent_id
                 WHERE g.grant_id=? AND g.tenant_id=? AND g.agent_id=? AND g.capability=?""",
                 (grant_id,tenant_id,agent_id,capability)).fetchone()
            if not g or g["revoked_at"] is not None or g["expires_at"]<=time.time() or g["lifecycle"]!="active":
                raise PermissionError("Brainstem authority denied")
            if amount>g["ceiling"] or amount>g["capacity"]-g["reserved"]-g["spent"]:
                raise PermissionError("spending cap exceeded")
            c.execute("UPDATE budgets SET reserved=reserved+? WHERE budget_id=?",
                      (amount,g["budget_id"]))
            c.execute("""INSERT INTO reservations VALUES(?,?,?,?,?,?,?)""",
                      (operation_id,g["budget_id"],grant_id,request_digest,amount,"reserved",int(time.time())))
            self._event(c,{"type":"budget.reserved","operation_id":operation_id,"amount":amount})
            return {"operation_id":operation_id,"status":"reserved","amount":amount}

    def finalize_reservation(self,operation_id,result):
        if result not in ("captured","released"):
            raise ValueError("ambiguous external result must reconcile first")
        with self.tx() as c:
            r=c.execute("SELECT * FROM reservations WHERE operation_id=?",(operation_id,)).fetchone()
            if not r: raise KeyError(operation_id)
            if r["status"]==result: return result
            if r["status"]!="reserved": raise StateConflict("reservation already final")
            c.execute("UPDATE budgets SET reserved=reserved-?, spent=spent+? WHERE budget_id=?",
                      (r["amount"],r["amount"] if result=="captured" else 0,r["budget_id"]))
            c.execute("UPDATE reservations SET status=? WHERE operation_id=?",(result,operation_id))
            self._event(c,{"type":"budget."+result,"operation_id":operation_id})
        return result

    def mailbox_put(self,tenant_id,agent_id,message_id,body):
        if not self.agent(tenant_id,agent_id): raise PermissionError("tenant mismatch")
        with self.tx() as c:
            row=c.execute("SELECT body FROM mailboxes WHERE agent_id=? AND message_id=?",
                          (agent_id,message_id)).fetchone()
            if row:
                if row["body"] != canon(body): raise StateConflict("mailbox idempotency mismatch")
                return False
            c.execute("INSERT INTO mailboxes(tenant_id,agent_id,message_id,body,created_at) VALUES(?,?,?,?,?)",
                      (tenant_id,agent_id,message_id,canon(body),int(time.time())))
            self._event(c,{"type":"mailbox.enqueued","agent_id":agent_id,"message_id":message_id})
            return True

    def mailbox_pending(self,tenant_id,agent_id,limit=100):
        if not isinstance(limit,int) or limit<1 or limit>500: raise ValueError("invalid limit")
        with self.connect() as c:
            return [dict(x) for x in c.execute("""SELECT seq,message_id,body FROM mailboxes
                WHERE tenant_id=? AND agent_id=? AND completed_at IS NULL ORDER BY seq LIMIT ?""",
                (tenant_id,agent_id,limit))]

    def acquire_lease(self,tenant_id,agent_id,holder,ttl=30):
        if not self.agent(tenant_id,agent_id): raise PermissionError("tenant mismatch")
        if not 1<=ttl<=3600: raise ValueError("ttl out of bounds")
        now=int(time.time())
        with self.tx() as c:
            r=c.execute("SELECT * FROM leases WHERE agent_id=?",(agent_id,)).fetchone()
            if r and r["expires_at"]>now and r["holder"]!=holder:
                raise StateConflict("lease held by another worker")
            epoch=(r["epoch"]+1 if r else 1)
            c.execute("""INSERT INTO leases(agent_id,holder,epoch,expires_at) VALUES(?,?,?,?)
                ON CONFLICT(agent_id) DO UPDATE SET holder=excluded.holder,
                  epoch=excluded.epoch,expires_at=excluded.expires_at""",
                (agent_id,holder,epoch,now+ttl))
            return epoch

    def checkpoint(self,tenant_id,agent_id,holder,epoch,workflow_id,state,payload,ack_message=None):
        with self.tx() as c:
            lease=c.execute("SELECT * FROM leases WHERE agent_id=?",(agent_id,)).fetchone()
            if not lease or lease["holder"]!=holder or lease["epoch"]!=epoch or lease["expires_at"]<=time.time():
                raise StateConflict("stale worker lease")
            if not c.execute("SELECT 1 FROM agents WHERE tenant_id=? AND agent_id=? AND lifecycle='active'",
                             (tenant_id,agent_id)).fetchone(): raise PermissionError("tenant mismatch")
            c.execute("""INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?)
                  ON CONFLICT(workflow_id) DO UPDATE SET state=excluded.state,
                  epoch=excluded.epoch,payload=excluded.payload,updated_at=excluded.updated_at""",
                      (workflow_id,tenant_id,agent_id,state,epoch,canon(payload),int(time.time())))
            if ack_message:
                c.execute("""UPDATE mailboxes SET completed_at=?
                         WHERE tenant_id=? AND agent_id=? AND message_id=?""",
                          (int(time.time()),tenant_id,agent_id,ack_message))
            self._event(c,{"type":"workflow.checkpoint","workflow_id":workflow_id,"state":state})

    def memory_put(self,tenant_id,agent_id,key,value):
        required(key,"memory key")
        if not self.agent(tenant_id,agent_id): raise PermissionError("tenant mismatch")
        with self.tx() as c:
            c.execute("""INSERT INTO memories VALUES(?,?,?,?,?)
             ON CONFLICT(agent_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at""",
             (agent_id,tenant_id,key,canon(value),int(time.time())))
            self._event(c,{"type":"memory.updated","agent_id":agent_id,"key":key})

    def memory_get(self,tenant_id,agent_id,key):
        with self.connect() as c:
            row=c.execute("SELECT value FROM memories WHERE tenant_id=? AND agent_id=? AND key=?",
                          (tenant_id,agent_id,key)).fetchone()
            return json.loads(row["value"]) if row else None

    def begin_purchase(self,purchase_id,tenant_id,agent_id,request,requirement):
        req_digest=digest(request)
        with self.tx() as c:
            prior=c.execute("SELECT * FROM purchases WHERE purchase_id=?",(purchase_id,)).fetchone()
            if prior:
                if (prior["request_digest"]!=req_digest or prior["requirement"]!=canon(requirement)
                    or prior["tenant_id"]!=tenant_id or prior["agent_id"]!=agent_id):
                    raise StateConflict("purchase identity reused with different request")
                return dict(prior)
            if not c.execute("SELECT 1 FROM agents WHERE tenant_id=? AND agent_id=? AND lifecycle='active'",
                             (tenant_id,agent_id)).fetchone(): raise PermissionError("tenant mismatch")
            c.execute("INSERT INTO purchases VALUES(?,?,?,?,?,'required',NULL,NULL,NULL,NULL,?)",
                      (purchase_id,tenant_id,agent_id,req_digest,canon(requirement),int(time.time())))
            self._event(c,{"type":"payment.required","purchase_id":purchase_id})
            return {"status":"required"}

    def payment_transition(self,purchase_id,expected,status,signature=None,facilitator=None,chain=None,tx_hash=None):
        states={"required":"verifying","verifying":"verified","verified":"settlement_pending",
                "settlement_pending":"settled","settlement_pending:retry":"settlement_pending"}
        if status != states.get(expected) and not (expected=="settlement_pending" and status=="failed"):
            raise ValueError("invalid payment transition")
        with self.tx() as c:
            r=c.execute("SELECT * FROM purchases WHERE purchase_id=?",(purchase_id,)).fetchone()
            if not r: raise KeyError(purchase_id)
            if r["status"]!=expected: raise StateConflict("payment state changed; reconcile")
            old_sig=r["signature_digest"]
            sig=digest(signature) if signature else old_sig
            if old_sig and sig!=old_sig: raise StateConflict("signature switched mid-purchase")
            c.execute("""UPDATE purchases SET status=?, signature_digest=?, facilitator_receipt=?,
                chain_receipt=?, tx_hash=?, updated_at=? WHERE purchase_id=?""",
               (status,sig,canon(facilitator) if facilitator else r["facilitator_receipt"],
                canon(chain) if chain else r["chain_receipt"],tx_hash or r["tx_hash"],
                int(time.time()),purchase_id))
            self._event(c,{"type":"payment."+status,"purchase_id":purchase_id,"tx_hash":tx_hash})

    def purchase(self,purchase_id):
        with self.connect() as c:
            r=c.execute("SELECT * FROM purchases WHERE purchase_id=?",(purchase_id,)).fetchone()
            return dict(r) if r else None

    def money_event(self,event_id,provider,provider_ref,purchase_id,kind,asset,amount,state,raw):
        nonnegative(amount)
        with self.tx() as c:
            prior=c.execute("SELECT * FROM money_events WHERE event_id=?",(event_id,)).fetchone()
            if prior:
                if any(prior[x]!=v for x,v in (("provider",provider),("provider_ref",provider_ref),
                    ("purchase_id",purchase_id),("kind",kind),("asset",asset),("amount",amount))):
                    raise StateConflict("payment event collision")
                return dict(prior)
            c.execute("INSERT INTO money_events VALUES(?,?,?,?,?,?,?,?,?,?)",
                (event_id,provider,provider_ref,purchase_id,kind,asset,amount,state,
                 canon(raw),int(time.time())))
            self._event(c,{"type":"provider."+kind,"event_id":event_id,"state":state})
            return {"event_id":event_id,"state":state}

    def journal_post(self,tx_id,asset,entries):
        """Balanced integer-minor-unit entry set; never mixes USD cents with USDC atoms."""
        if not isinstance(entries,dict) or len(entries)<2 or any(
            not isinstance(n,int) or isinstance(n,bool) or n==0 for n in entries.values()
        ) or sum(entries.values())!=0: raise ValueError("journal must balance")
        with self.tx() as c:
            exists=c.execute("SELECT account,delta FROM journal WHERE tx_id=?",(tx_id,)).fetchall()
            if exists:
                if {x["account"]:x["delta"] for x in exists}!=entries: raise StateConflict("journal conflict")
                return False
            for account,delta in entries.items():
                c.execute("INSERT INTO journal VALUES(?,?,?,?,?)",
                          (tx_id,required(account,"account"),asset,delta,int(time.time())))
            self._event(c,{"type":"journal.posted","tx_id":tx_id,"asset":asset})
            return True

    def verify_evidence(self):
        with self.connect() as c:
            prev="0"*64
            for r in c.execute("SELECT * FROM evidence ORDER BY sequence"):
                if r["prev_hash"]!=prev or hashlib.sha256((prev+r["event"]).encode()).hexdigest()!=r["event_hash"]:
                    return False
                prev=r["event_hash"]
        return True
