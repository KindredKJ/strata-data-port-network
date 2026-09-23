"""Durable state and accounting primitives for protected runtime authorities.

SQLite is the supported single-node store.  The schema is deliberately usable by
the future PostgreSQL adapter: state transitions use transactions, unique keys,
foreign keys, and append-only evidence and journal rows.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Iterator, Sequence

from .models import Receipt, ReceiptState, Signature, TruthClass


SCHEMA_VERSION = 1


class PersistenceUnavailable(RuntimeError):
    """Required durable state cannot be opened or validated."""


class SQLiteState:
    """Transactional durable store; never silently falls back to memory."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        if str(path) == ":memory:":
            raise PersistenceUnavailable("in-memory SQLite is test-only and not accepted here")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.connection = sqlite3.connect(self.path, isolation_level=None)
            self.connection.execute("PRAGMA foreign_keys=ON")
            self.connection.execute("PRAGMA journal_mode=WAL")
            self.migrate()
            if self.connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise PersistenceUnavailable("database integrity check failed")
        except (OSError, sqlite3.Error) as exc:
            raise PersistenceUnavailable(f"durable persistence unavailable: {exc}") from exc

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            yield self.connection
        except Exception:
            self.connection.rollback()
            raise
        else:
            self.connection.commit()

    def migrate(self) -> None:
        with self.transaction() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
              CREATE TABLE IF NOT EXISTS replay_nonces(port_id TEXT NOT NULL, nonce TEXT NOT NULL, seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(port_id, nonce));
              CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY, receipts_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
              CREATE TABLE IF NOT EXISTS evidence(sequence INTEGER PRIMARY KEY AUTOINCREMENT, evidence_hash TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
              CREATE TABLE IF NOT EXISTS identities(identity_id TEXT PRIMARY KEY, authority TEXT NOT NULL, revoked_at TEXT);
              CREATE TABLE IF NOT EXISTS capabilities(capability_id TEXT PRIMARY KEY, owner_identity TEXT NOT NULL REFERENCES identities(identity_id), manifest_json TEXT NOT NULL, revoked_at TEXT);
              CREATE TABLE IF NOT EXISTS routes(route_id TEXT PRIMARY KEY, configuration_json TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0));
              CREATE TABLE IF NOT EXISTS accounts(account_id TEXT PRIMARY KEY, currency TEXT NOT NULL, owner_identity TEXT NOT NULL REFERENCES identities(identity_id));
              CREATE TABLE IF NOT EXISTS journals(journal_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('pending','posted','reversed')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
              CREATE TABLE IF NOT EXISTS journal_entries(journal_id TEXT NOT NULL REFERENCES journals(journal_id), line_no INTEGER NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(account_id), amount_minor INTEGER NOT NULL CHECK(amount_minor != 0), PRIMARY KEY(journal_id,line_no));
              CREATE TABLE IF NOT EXISTS budgets(budget_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(account_id), limit_minor INTEGER NOT NULL CHECK(limit_minor >= 0), reserved_minor INTEGER NOT NULL DEFAULT 0 CHECK(reserved_minor >= 0 AND reserved_minor <= limit_minor));
              CREATE TABLE IF NOT EXISTS obligations(obligation_id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES budgets(budget_id), amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), state TEXT NOT NULL CHECK(state IN ('reserved','settled','released','disputed','reversed')));
              CREATE TABLE IF NOT EXISTS a2a_contracts(contract_id TEXT PRIMARY KEY, requester TEXT NOT NULL REFERENCES identities(identity_id), executor TEXT NOT NULL REFERENCES identities(identity_id), obligation_id TEXT REFERENCES obligations(obligation_id), acceptance_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('offered','accepted','submitted','verified','rejected','disputed','revoked')));
              CREATE TABLE IF NOT EXISTS disputes(dispute_id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
              INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
            """)

    def claim_nonce(self, port_id: str, nonce: str) -> bool:
        try:
            with self.transaction() as db:
                db.execute("INSERT INTO replay_nonces(port_id,nonce) VALUES (?,?)", (port_id, nonce))
            return True
        except sqlite3.IntegrityError:
            return False

    def get_receipts(self, key: str) -> list[Receipt] | None:
        row = self.connection.execute("SELECT receipts_json FROM idempotency WHERE key=?", (key,)).fetchone()
        if not row:
            return None
        return [_receipt_from_dict(item) for item in json.loads(row[0])]

    def record_outcome(self, key: str, receipts: Sequence[Receipt]) -> None:
        encoded = json.dumps([_receipt_dict(item) for item in receipts], sort_keys=True)
        with self.transaction() as db:
            db.execute("INSERT INTO idempotency(key,receipts_json) VALUES (?,?)", (key, encoded))
            db.executemany("INSERT INTO evidence(evidence_hash,message_id) VALUES (?,?)",
                           [(item.evidence_hash, item.message_id) for item in receipts])

    def evidence_hashes(self) -> list[str]:
        return [row[0] for row in self.connection.execute("SELECT evidence_hash FROM evidence ORDER BY sequence")]

    def post_journal(self, journal_id: str, entries: Sequence[tuple[str, int]]) -> None:
        if not entries or sum(amount for _, amount in entries) != 0:
            raise ValueError("double-entry journal must balance to zero")
        with self.transaction() as db:
            db.execute("INSERT INTO journals(journal_id,state) VALUES (?,'posted')", (journal_id,))
            db.executemany("INSERT INTO journal_entries(journal_id,line_no,account_id,amount_minor) VALUES (?,?,?,?)",
                           [(journal_id, index, account, amount) for index, (account, amount) in enumerate(entries, 1)])

    def reserve_budget(self, budget_id: str, obligation_id: str, amount_minor: int) -> None:
        if amount_minor <= 0:
            raise ValueError("reservation must be positive")
        with self.transaction() as db:
            changed = db.execute(
                "UPDATE budgets SET reserved_minor=reserved_minor+? "
                "WHERE budget_id=? AND reserved_minor+?<=limit_minor",
                (amount_minor, budget_id, amount_minor),
            ).rowcount
            if changed != 1:
                raise ValueError("budget missing or available limit exceeded")
            db.execute("INSERT INTO obligations(obligation_id,budget_id,amount_minor,state) VALUES (?,?,?,'reserved')",
                       (obligation_id, budget_id, amount_minor))

    def admit_agent(self, identity_id: str, owner_authority: str, capability_id: str,
                    manifest: dict) -> None:
        required = {"permitted_actions", "permitted_strata", "financial_policy", "revocation_state"}
        if not required.issubset(manifest) or manifest["revocation_state"] != "active":
            raise ValueError("agent conformance requirements not satisfied")
        with self.transaction() as db:
            db.execute("INSERT INTO identities(identity_id,authority) VALUES (?,?)", (identity_id, owner_authority))
            db.execute("INSERT INTO capabilities(capability_id,owner_identity,manifest_json) VALUES (?,?,?)",
                       (capability_id, identity_id, json.dumps(manifest, sort_keys=True)))

    def create_a2a_contract(self, contract_id: str, requester: str, executor: str,
                            obligation_id: str, acceptance_hash: str) -> None:
        with self.transaction() as db:
            admitted = db.execute(
                "SELECT COUNT(*) FROM identities i JOIN capabilities c ON c.owner_identity=i.identity_id "
                "WHERE i.identity_id IN (?,?) AND i.revoked_at IS NULL AND c.revoked_at IS NULL",
                (requester, executor),
            ).fetchone()[0]
            if admitted != 2:
                raise PermissionError("both agents must pass conformance")
            db.execute("INSERT INTO a2a_contracts(contract_id,requester,executor,obligation_id,acceptance_hash,state) "
                       "VALUES (?,?,?,?,?,'offered')",
                       (contract_id, requester, executor, obligation_id, acceptance_hash))

    def backup(self, destination: str | Path) -> Path:
        target = Path(destination)
        target.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(target) as backup:
            self.connection.backup(backup)
        return target

    @classmethod
    def restore(cls, backup: str | Path, destination: str | Path) -> "SQLiteState":
        source, target = Path(backup), Path(destination)
        if not source.is_file() or target.exists():
            raise PersistenceUnavailable("restore requires an existing backup and absent destination")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        return cls(target)

    def close(self) -> None:
        self.connection.close()


def _receipt_dict(receipt: Receipt) -> dict:
    value = asdict(receipt)
    value["state"] = receipt.state.value
    value["truth_class"] = receipt.truth_class.value
    return value


def _receipt_from_dict(value: dict) -> Receipt:
    signature = Signature(**value["signature"])
    return Receipt(value["message_id"], value["port_id"], ReceiptState(value["state"]), value["detail"],
                   TruthClass(value["truth_class"]), value["evidence_hash"], signature, value["attempt"])
