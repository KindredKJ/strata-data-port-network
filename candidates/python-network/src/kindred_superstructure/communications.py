"""G3T Connected provider-of-record lifecycle and append-only evidence model."""
from __future__ import annotations
import json
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4

from .persistence import SQLiteState
from .security import digest

class _S(str, Enum): pass
class RequestStatus(_S):
    CREATED="created"; VALIDATED="validated"; AUTHORIZED="authorized"; REJECTED="rejected"; CANCELLED="cancelled"; EXPIRED="expired"
class G3TProviderStatus(_S):
    ACCEPTED="accepted"; POLICY_CHECKED="policy_checked"; SCHEDULED="scheduled"; QUEUED="queued"; ROUTING="routing"; SUBMITTED_TO_RAIL="submitted_to_rail"; PARTIALLY_COMPLETED="partially_completed"; COMPLETED="completed"; FAILED="failed"; RETRYING="retrying"; ESCALATED="escalated"; RECOVERED="recovered"; CANCELLED="cancelled"
class TransportRailStatus(_S):
    NOT_REQUIRED="not_required"; NOT_SUBMITTED="not_submitted"; SUBMITTED="submitted"; RAIL_ACCEPTED="rail_accepted"; RAIL_QUEUED="rail_queued"; RAIL_PROCESSING="rail_processing"; RAIL_SENT="rail_sent"; RAIL_DELIVERED="rail_delivered"; RAIL_FAILED="rail_failed"; RAIL_REJECTED="rail_rejected"; RAIL_EXPIRED="rail_expired"; RAIL_UNKNOWN="rail_unknown"
class RecipientStatus(_S):
    NOT_OBSERVED="not_observed"; RECEIVED="received"; OPENED="opened"; ACKNOWLEDGED="acknowledged"; RESPONDED="responded"; DECLINED="declined"; UNREACHABLE="unreachable"; UNKNOWN="unknown"
class ReconciliationStatus(_S):
    PENDING="pending"; PROVIDER_REPORTED="provider_reported"; RAIL_REPORTED="rail_reported"; RECIPIENT_CONFIRMED="recipient_confirmed"; RECONCILED="reconciled"; DISPUTED="disputed"; INCONCLUSIVE="inconclusive"; REVERSED="reversed"
class EvidenceStatus(_S):
    NOT_RECORDED="not_recorded"; RECORDED="recorded"; HASH_VERIFIED="hash_verified"; SIGNATURE_VERIFIED="signature_verified"; RECEIPT_VERIFIED="receipt_verified"; INDEPENDENTLY_VERIFIED="independently_verified"; INVALID="invalid"
class CommunicationTruth(_S):
    REQUESTED="requested"; INTERNALLY_OBSERVED="internally_observed"; G3T_REPORTED="g3t_reported"; RAIL_REPORTED="rail_reported"; RECIPIENT_CONFIRMED="recipient_confirmed"; RECONCILED="reconciled"; EXTERNALLY_VERIFIED="externally_verified"; DISPUTED="disputed"; UNKNOWN="unknown"

@dataclass(frozen=True)
class B2BContext:
    organization_id: str; tenant_id: str; partner_id: str; environment_id: str
    project_id: str; entitlement_id: str; requesting_identity: str
    delegated_authority: str; capability: str; provider_of_record: str
    transport_rail: str; brand_context: str; metering_context: str
    evidence_owner: str; disclosure_policy: str
    def __post_init__(self):
        if not self.organization_id or not self.tenant_id: raise ValueError("organization and tenant are required")
        if self.provider_of_record != "g3t-connected": raise ValueError("G3T Connected is communications provider of record")

@dataclass(frozen=True)
class CommunicationState:
    request_status: RequestStatus; g3t_provider_status: G3TProviderStatus
    transport_rail_status: TransportRailStatus; recipient_status: RecipientStatus
    reconciliation_status: ReconciliationStatus; evidence_status: EvidenceStatus
    truth_class: CommunicationTruth

@dataclass(frozen=True)
class CommunicationEvent:
    event_id: str; schema_version: str; timestamp: str; correlation_id: str; causation_id: str; trace_id: str
    message_id: str; campaign_id: str | None; organization_id: str; tenant_id: str
    requesting_identity: str; acting_identity: str; delegated_authority: str; g3t_provider_identity: str
    selected_transport_rail: str; channel: str; attempt_number: int; previous_state: CommunicationState | None
    new_state: CommunicationState; reason_code: str; provider_response_code: str | None
    rail_response_code: str | None; receipt_identifier: str | None; payload_hash: str
    evidence_hash: str; classification: str; disclosure_policy: str

class CommunicationLedger:
    def __init__(self, state: SQLiteState): self.state=state; self._migrate()
    def _migrate(self):
        with self.state.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS communication_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,callback_id TEXT UNIQUE,message_id TEXT NOT NULL,attempt INTEGER NOT NULL,event_json TEXT NOT NULL,event_hash TEXT NOT NULL,previous_hash TEXT,created_at TEXT NOT NULL)")
    def append(self, *, context:B2BContext, message_id:str, new_state:CommunicationState, correlation_id:str, causation_id:str, trace_id:str, acting_identity:str, channel:str, attempt_number:int, reason_code:str, payload_hash:str, callback_id:str|None=None, campaign_id:str|None=None, provider_response_code:str|None=None, rail_response_code:str|None=None, receipt_identifier:str|None=None)->CommunicationEvent:
        prior=self.events(message_id); previous=prior[-1].new_state if prior else None
        self._validate(previous,new_state,reason_code)
        event=CommunicationEvent(str(uuid4()),"1.0.0",datetime.now(timezone.utc).isoformat(),correlation_id,causation_id,trace_id,message_id,campaign_id,context.organization_id,context.tenant_id,context.requesting_identity,acting_identity,context.delegated_authority,"g3t-connected",context.transport_rail,channel,attempt_number,previous,new_state,reason_code,provider_response_code,rail_response_code,receipt_identifier,payload_hash,"pending", "protected",context.disclosure_policy)
        raw=json.dumps(asdict(event),sort_keys=True,default=lambda v:v.value); previous_hash=prior[-1].evidence_hash if prior else None; event_hash=digest({"event":json.loads(raw),"previous_hash":previous_hash}); event=replace(event,evidence_hash=event_hash)
        raw=json.dumps(asdict(event),sort_keys=True,default=lambda v:v.value)
        try:
            with self.state.transaction() as db: db.execute("INSERT INTO communication_events(event_id,callback_id,message_id,attempt,event_json,event_hash,previous_hash,created_at) VALUES(?,?,?,?,?,?,?,?)",(event.event_id,callback_id,message_id,attempt_number,raw,event_hash,previous_hash,event.timestamp))
        except Exception:
            if callback_id:
                row=self.state.connection.execute("SELECT event_json FROM communication_events WHERE callback_id=?",(callback_id,)).fetchone()
                if row: return self._decode(row[0])
            raise
        return event
    def events(self,message_id): return [self._decode(r[0]) for r in self.state.connection.execute("SELECT event_json FROM communication_events WHERE message_id=? ORDER BY sequence",(message_id,))]
    def verify(self,message_id):
        previous=None
        try:
            for row in self.state.connection.execute("SELECT event_json,event_hash,previous_hash FROM communication_events WHERE message_id=? ORDER BY sequence",(message_id,)):
                raw,event_hash,linked=row; event=json.loads(raw); stored=event["evidence_hash"]; event["evidence_hash"]="pending"
                if linked!=previous or digest({"event":event,"previous_hash":previous})!=event_hash or stored!=event_hash:return False
                previous=event_hash
            return True
        except (KeyError,TypeError,ValueError,json.JSONDecodeError): return False
    def _decode(self,raw):
        d=json.loads(raw); d["new_state"]=CommunicationState(**{k:globals()[{"request_status":"RequestStatus","g3t_provider_status":"G3TProviderStatus","transport_rail_status":"TransportRailStatus","recipient_status":"RecipientStatus","reconciliation_status":"ReconciliationStatus","evidence_status":"EvidenceStatus","truth_class":"CommunicationTruth"}[k]](v) for k,v in d["new_state"].items()}); d["previous_state"]=None if d["previous_state"] is None else CommunicationState(**{k:globals()[{"request_status":"RequestStatus","g3t_provider_status":"G3TProviderStatus","transport_rail_status":"TransportRailStatus","recipient_status":"RecipientStatus","reconciliation_status":"ReconciliationStatus","evidence_status":"EvidenceStatus","truth_class":"CommunicationTruth"}[k]](v) for k,v in d["previous_state"].items()}); return CommunicationEvent(**d)
    def _validate(self,previous,new,reason):
        if new.recipient_status is RecipientStatus.ACKNOWLEDGED and new.truth_class not in {CommunicationTruth.RECIPIENT_CONFIRMED,CommunicationTruth.RECONCILED,CommunicationTruth.EXTERNALLY_VERIFIED}: raise ValueError("recipient acknowledgement requires recipient evidence")
        if new.reconciliation_status is ReconciliationStatus.RECONCILED and new.truth_class not in {CommunicationTruth.RECONCILED,CommunicationTruth.EXTERNALLY_VERIFIED}: raise ValueError("reconciliation truth required")
        if new.truth_class is CommunicationTruth.EXTERNALLY_VERIFIED and new.evidence_status is not EvidenceStatus.INDEPENDENTLY_VERIFIED: raise ValueError("independent evidence required")
        if new.g3t_provider_status is G3TProviderStatus.FAILED and not reason: raise ValueError("failure reason required")
        if previous and new.transport_rail_status != previous.transport_rail_status and new.reconciliation_status is ReconciliationStatus.PROVIDER_REPORTED: raise ValueError("conflicting rail callback requires reconciliation")
