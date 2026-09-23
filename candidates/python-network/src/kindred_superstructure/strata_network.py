"""Persistent Strata Data Port directory and fail-closed production lifecycle."""
from __future__ import annotations
import json
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4
from .models import Classification, RouteMode, Signature
from .persistence import SQLiteState
from .security import DevelopmentHMACSigner, Signer, digest

class Health(str,Enum): HEALTHY="healthy"; DEGRADED="degraded"; UNAVAILABLE="unavailable"
class Readiness(str,Enum): READY="ready"; BLOCKED="blocked"; MAINTENANCE="maintenance"
class PortZeroStatus(str,Enum):
    RECEIVED="received"; IDENTITY_RESOLVED="identity_resolved"; POLICY_CHECKED="policy_checked"; CLASSIFIED="classified"; ROUTE_RESOLVED="route_resolved"; SIGNED="signed"; PERSISTED="persisted"; DISPATCHING="dispatching"; DISPATCHED="dispatched"; AWAITING_RECEIPT="awaiting_receipt"; RECONCILING="reconciling"; COMPLETED="completed"; FAILED="failed"; RETRYING="retrying"; RECOVERED="recovered"; QUARANTINED="quarantined"

@dataclass(frozen=True)
class PortRegistration:
    port_id:str; stratum:str; authority:str; repository:str; version:str
    capabilities:tuple[str,...]; organization_scope:str; tenant_scope:str
    accepted_classifications:tuple[str,...]; disclosure_requirements:tuple[str,...]
    required_identity_level:str; required_authority:str; route_modes:tuple[str,...]
    health:Health; readiness:Readiness; location:str; transport_protocol:str
    contract_versions:tuple[str,...]; maintenance:bool; blocker:str|None=None

class PortDirectory:
    def __init__(self,state:SQLiteState): self.state=state; self._migrate()
    def _migrate(self):
        with self.state.transaction() as db: db.executescript("""
        CREATE TABLE IF NOT EXISTS port_directory(port_id TEXT PRIMARY KEY,registration_json TEXT NOT NULL,authority_evidence TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS strata_transactions(transaction_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,tenant_id TEXT NOT NULL,envelope_json TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0,last_event_hash TEXT,retry_count INTEGER NOT NULL DEFAULT 0,blocker TEXT,reconciliation_status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS strata_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,transaction_id TEXT NOT NULL,event_json TEXT NOT NULL,event_hash TEXT NOT NULL,previous_hash TEXT,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS strata_dead_letters(dead_letter_id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL,port_id TEXT NOT NULL,attempts INTEGER NOT NULL,reason TEXT NOT NULL,payload_hash TEXT NOT NULL,evidence_hash TEXT NOT NULL,recovery_owner TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_strata_tenant ON strata_transactions(organization_id,tenant_id);
        """)
    def register(self,registration:PortRegistration,authority_evidence:str):
        if not authority_evidence or registration.authority != registration.required_authority: raise PermissionError("port registration authority validation failed")
        with self.state.transaction() as db: db.execute("INSERT INTO port_directory VALUES(?,?,?,1)",(registration.port_id,json.dumps(asdict(registration),sort_keys=True,default=lambda x:x.value),authority_evidence))
    def deregister(self,port_id,authority):
        row=self.resolve_raw(port_id)
        if row["authority"]!=authority: raise PermissionError("deregistration authority denied")
        with self.state.transaction() as db: db.execute("DELETE FROM port_directory WHERE port_id=?",(port_id,))
    def resolve_raw(self,port_id):
        row=self.state.connection.execute("SELECT registration_json FROM port_directory WHERE port_id=?",(port_id,)).fetchone()
        if not row: raise LookupError("unknown destination port")
        return json.loads(row[0])
    def resolve(self,port_id,capability,classification,route_mode,organization_id,tenant_id):
        r=self.resolve_raw(port_id)
        if not organization_id or not tenant_id: raise PermissionError("organization and tenant required")
        if r["maintenance"] or r["readiness"]!="ready" or r["health"]=="unavailable": raise RuntimeError("destination blocked: "+(r.get("blocker") or r["readiness"]))
        if capability not in r["capabilities"] or classification not in r["accepted_classifications"] or route_mode not in r["route_modes"]: raise PermissionError("destination compatibility denied")
        return r
    def discover(self,capability): return [json.loads(r[0]) for r in self.state.connection.execute("SELECT registration_json FROM port_directory") if capability in json.loads(r[0])["capabilities"]]
    def operations_snapshot(self):
        ports=[json.loads(r[0]) for r in self.state.connection.execute("SELECT registration_json FROM port_directory ORDER BY port_id")]
        counts={r[0]:r[1] for r in self.state.connection.execute("SELECT status,COUNT(*) FROM strata_transactions GROUP BY status")}
        unresolved=self.state.connection.execute("SELECT COUNT(*) FROM strata_transactions WHERE status IN ('failed','retrying')").fetchone()[0]
        return {"ports":ports,"transaction_counts":counts,"unresolved":unresolved,"tenant_isolation":"enforced-by-scoped-index-and-query","payloads_exposed":False}

class LifecycleStore:
    """Atomic transaction projection and append-only per-transaction hash chain."""
    def __init__(self,state:SQLiteState): self.state=state
    def create(self,envelope):
        now=datetime.now(timezone.utc).isoformat(); raw=json.dumps(asdict(envelope),sort_keys=True,default=lambda x:x.value)
        with self.state.transaction() as db: db.execute("INSERT INTO strata_transactions(transaction_id,organization_id,tenant_id,envelope_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",(envelope.transaction_id,envelope.organization_id,envelope.tenant_id,raw,"received",now,now))
        return self.transition(envelope,"received","request-received")
    def transition(self,envelope,new_state,reason,*,expected_version=None,retry_increment=0,blocker=None,reconciliation="pending",extra=None):
        with self.state.transaction() as db:
            projection=db.execute("SELECT version,last_event_hash,status FROM strata_transactions WHERE transaction_id=?",(envelope.transaction_id,)).fetchone()
            if not projection: raise LookupError("transaction not found")
            version,previous_hash,previous_state=projection
            if expected_version is not None and version!=expected_version: raise RuntimeError("optimistic version conflict")
            sequence=version+1; now=datetime.now(timezone.utc).isoformat(); event={"event_id":str(uuid4()),"schema_version":"1.0.0","timestamp":now,"organization_id":envelope.organization_id,"tenant_id":envelope.tenant_id,"partner_id":envelope.partner_id,"environment_id":envelope.environment_id,"project_id":envelope.project_id,"transaction_id":envelope.transaction_id,"destination_transaction_id":envelope.transaction_id,"message_id":envelope.message_id,"correlation_id":envelope.correlation_id,"causation_id":envelope.causation_id,"trace_id":envelope.trace_id,"source_identity":envelope.source_identity,"acting_identity":"strata-data-port-zero","delegated_authority":envelope.delegated_authority,"origin_port":envelope.origin_port,"destination_port":envelope.destination_port,"stratum":envelope.destination_stratum,"capability":envelope.destination_capability,"provider_of_record":"g3t-connected" if envelope.destination_stratum=="communications" else None,"transport_rail":None,"attempt":envelope.attempt,"sequence":sequence,"previous_state":previous_state,"new_state":new_state,"reason_code":reason,"provider_response_code":None,"rail_response_code":None,"receipt_id":None,"receipt_hash":None,"payload_hash":envelope.payload_hash,"reconciliation_state":reconciliation,"evidence_state":"recorded","truth_class":envelope.truth_class,"classification":envelope.classification.value,"disclosure_policy":list(envelope.disclosure_policy),"previous_event_hash":previous_hash,**(extra or {})}; event_hash=digest({"event":event,"previous_hash":previous_hash}); event["event_hash"]=event_hash
            db.execute("INSERT INTO strata_events(event_id,transaction_id,event_json,event_hash,previous_hash,created_at) VALUES(?,?,?,?,?,?)",(event["event_id"],envelope.transaction_id,json.dumps(event,sort_keys=True),event_hash,previous_hash,now))
            changed=db.execute("UPDATE strata_transactions SET status=?,version=?,last_event_hash=?,retry_count=retry_count+?,blocker=?,reconciliation_status=?,updated_at=? WHERE transaction_id=? AND version=?",(new_state,sequence,event_hash,retry_increment,blocker,reconciliation,now,envelope.transaction_id,version)).rowcount
            if changed!=1: raise RuntimeError("optimistic version conflict")
        return event_hash
    def verify(self,transaction_id):
        previous=None; expected_sequence=1
        rows=self.state.connection.execute("SELECT event_json,event_hash,previous_hash FROM strata_events WHERE transaction_id=? ORDER BY sequence",(transaction_id,)).fetchall()
        for raw,event_hash,linked in rows:
            try: event=json.loads(raw); stored=event.pop("event_hash")
            except (ValueError,KeyError): return False
            if event.get("sequence")!=expected_sequence or linked!=previous or stored!=event_hash or digest({"event":event,"previous_hash":previous})!=event_hash:return False
            previous=event_hash; expected_sequence+=1
        projection=self.state.connection.execute("SELECT version,last_event_hash FROM strata_transactions WHERE transaction_id=?",(transaction_id,)).fetchone()
        return bool(rows and projection==(len(rows),previous))

@dataclass(frozen=True)
class ProductionEnvelope:
    schema_version:str; protocol_version:str; message_id:str; correlation_id:str; causation_id:str; trace_id:str; transaction_id:str
    organization_id:str; tenant_id:str; partner_id:str; environment_id:str; project_id:str
    source_identity:str; source_identity_type:str; source_component:str; source_authority:str; delegated_authority:str
    origin_port:str; destination_stratum:str; destination_port:str; destination_capability:str
    route_mode:RouteMode; route_targets:tuple[str,...]; payload_type:str; payload:dict[str,Any]; payload_hash:str
    classification:Classification; truth_class:str; disclosure_policy:tuple[str,...]; policy_references:tuple[str,...]; contract_references:tuple[str,...]
    issued_at:str; expires_at:str; deadline:str; nonce:str; sequence:int; idempotency_key:str; attempt:int
    signatures:tuple[Signature,...]; encryption_metadata:dict[str,Any]
    def unsigned(self):
        d=asdict(self); d.pop("signatures"); d["route_mode"]=self.route_mode.value; d["classification"]=self.classification.value; return d

class BlockedRoute(RuntimeError):
    def __init__(self,transaction_id,blocker,evidence_hash): super().__init__(blocker); self.transaction_id=transaction_id; self.blocker=blocker; self.evidence_hash=evidence_hash

class PortZeroNetwork:
    """Executes the real governed failure path until an authorized transport is ready."""
    def __init__(self,state:SQLiteState,directory:PortDirectory,signer:Signer,identities:dict[str,set[str]]):
        if isinstance(signer,DevelopmentHMACSigner): raise RuntimeError("managed key authority required")
        self.state=state;self.directory=directory;self.signer=signer;self.identities=identities
    def submit(self,envelope:ProductionEnvelope):
        if envelope.schema_version!="1.0.0" or envelope.protocol_version!="1.0.0": raise ValueError("unsupported envelope version")
        if envelope.origin_port!="strata-data-port-zero": raise PermissionError("Port Zero is sole origin")
        if envelope.source_identity not in self.identities or envelope.delegated_authority not in self.identities[envelope.source_identity]: raise PermissionError("identity or delegated authority denied")
        if datetime.fromisoformat(envelope.expires_at)<=datetime.now(timezone.utc): raise TimeoutError("request expired")
        if digest(envelope.payload)!=envelope.payload_hash: raise ValueError("payload integrity failure")
        signed=replace(envelope,signatures=(self.signer.sign(envelope.unsigned()),))
        lifecycle=LifecycleStore(self.state); lifecycle.create(signed)
        lifecycle.transition(signed,PortZeroStatus.IDENTITY_RESOLVED.value,"identity-and-authority-validated")
        lifecycle.transition(signed,PortZeroStatus.POLICY_CHECKED.value,"governance-policy-validated")
        lifecycle.transition(signed,PortZeroStatus.CLASSIFIED.value,"classification-and-disclosure-validated")
        try: self.directory.resolve(envelope.destination_port,envelope.destination_capability,envelope.classification.value,envelope.route_mode.value,envelope.organization_id,envelope.tenant_id)
        except (LookupError,PermissionError,RuntimeError) as exc:
            blocker=str(exc); evidence=self._persist(signed,PortZeroStatus.FAILED,blocker); raise BlockedRoute(envelope.transaction_id,blocker,evidence) from exc
        # No production transport is inferred. A ready directory entry without an injected dispatcher is a configuration fault.
        evidence=self._persist(signed,PortZeroStatus.FAILED,"authorized production dispatcher unavailable")
        raise BlockedRoute(envelope.transaction_id,"authorized production dispatcher unavailable",evidence)
    def _persist(self,envelope,status,reason):
        return LifecycleStore(self.state).transition(envelope,status.value,reason,blocker=reason)
    def audit_export(self,organization_id,tenant_id):
        return [{"transaction_id":r[0],"status":r[1],"blocker":r[2]} for r in self.state.connection.execute("SELECT transaction_id,status,blocker FROM strata_transactions WHERE organization_id=? AND tenant_id=? ORDER BY created_at",(organization_id,tenant_id))]

@dataclass(frozen=True)
class SignedPortReceipt:
    receipt_id:str; parent_transaction_id:str; destination_transaction_id:str; message_id:str; correlation_id:str
    port_id:str; destination_authority:str; organization_id:str; tenant_id:str; capability:str; attempt:int
    accepted_at:str; completed_at:str; port_status:str; provider_status:str; rail_status:str; destination_status:str
    reconciliation_status:str; evidence_status:str; truth_class:str; result_hash:str; blocker:str|None
    expires_at:str; signatures:tuple[Signature,...]=()
    def unsigned(self): d=asdict(self);d.pop("signatures");return d

class DestinationCapability:
    """Production destination contract. Implementations must never infer success."""
    authority:str
    def readiness_blocker(self)->str|None: raise NotImplementedError
    def execute(self,envelope:ProductionEnvelope)->tuple[str,str]: raise NotImplementedError

class ExternalExecutionPort:
    def __init__(self,registration:PortRegistration,state:SQLiteState,signer:Signer,destination:DestinationCapability): self.registration=registration;self.state=state;self.signer=signer;self.destination=destination
    def execute(self,envelope:ProductionEnvelope,destination_transaction_id:str)->SignedPortReceipt:
        if envelope.origin_port!="strata-data-port-zero" or not envelope.signatures or not self.signer.verify(envelope.unsigned(),envelope.signatures[0]): raise PermissionError("Port Zero authentication failed")
        if not envelope.organization_id or not envelope.tenant_id or envelope.destination_capability not in self.registration.capabilities: raise PermissionError("tenant or capability denied")
        now=datetime.now(timezone.utc); blocker=self.destination.readiness_blocker()
        if blocker: statuses=("failed","blocked","not_submitted","failed","port_reported") ; result_hash=digest({"blocker":blocker,"destination_transaction_id":destination_transaction_id})
        else:
            destination_status,result_hash=self.destination.execute(envelope); blocker=None; statuses=("completed","completed","completed",destination_status,"destination_confirmed")
        port,provider,rail,destination_status,truth=statuses
        receipt=SignedPortReceipt(str(uuid4()),envelope.transaction_id,destination_transaction_id,envelope.message_id,envelope.correlation_id,self.registration.port_id,self.registration.authority,envelope.organization_id,envelope.tenant_id,envelope.destination_capability,envelope.attempt,now.isoformat(),datetime.now(timezone.utc).isoformat(),port,provider,rail,destination_status,"pending","receipt_verified",truth,result_hash,blocker,envelope.expires_at)
        return replace(receipt,signatures=(self.signer.sign(receipt.unsigned()),))
    def verify_receipt(self,receipt,envelope):
        return bool(receipt.signatures and self.signer.verify(receipt.unsigned(),receipt.signatures[0]) and receipt.parent_transaction_id==envelope.transaction_id and receipt.message_id==envelope.message_id and receipt.correlation_id==envelope.correlation_id and receipt.organization_id==envelope.organization_id and receipt.tenant_id==envelope.tenant_id and receipt.capability==envelope.destination_capability and receipt.attempt==envelope.attempt and datetime.fromisoformat(receipt.expires_at)>datetime.now(timezone.utc))

class EmitCoreReconciler:
    version="1.0.0"
    connected=False
    def reconcile(self,receipts):
        if not self.connected:return {"status":"blocked","blocker":"emit_core_authority_not_connected","truth_class":"port_reported","receipt_hashes":[digest(asdict(r)) for r in receipts]}
        raise NotImplementedError

class AuthenticatedDispatcher:
    production_ready=False
    def dispatch(self,port_id,envelope,destination_transaction_id)->SignedPortReceipt: raise NotImplementedError

class RouteExecutionEngine:
    def __init__(self,state:SQLiteState,directory:PortDirectory,dispatcher:AuthenticatedDispatcher,reconciler:EmitCoreReconciler,signer:Signer,max_attempts=3):
        if not dispatcher.production_ready: raise RuntimeError("authenticated production transport unavailable")
        self.state=state;self.directory=directory;self.dispatcher=dispatcher;self.reconciler=reconciler;self.signer=signer;self.max_attempts=max_attempts
    def _dispatch(self,target,child):
        error=None
        for attempt in range(1,self.max_attempts+1):
            try:return self.dispatcher.dispatch(target,replace(child,attempt=attempt),child.transaction_id)
            except Exception as exc:error=exc
        now=datetime.now(timezone.utc).isoformat(); reason=f"{type(error).__name__}: transport dispatch failed"; evidence=digest({"transaction_id":child.transaction_id,"port_id":target,"attempts":self.max_attempts,"reason":reason,"payload_hash":child.payload_hash})
        with self.state.transaction() as db: db.execute("INSERT INTO strata_dead_letters VALUES(?,?,?,?,?,?,?,?,?,?)",(str(uuid4()),child.transaction_id,target,self.max_attempts,reason,child.payload_hash,evidence,"strata-operations","pending",now))
        raise RuntimeError("retry exhaustion; dead letter persisted") from error
    def dead_letters(self): return [{"transaction_id":r[0],"port_id":r[1],"attempts":r[2],"reason":r[3],"payload_hash":r[4],"evidence_hash":r[5],"recovery_owner":r[6],"state":r[7]} for r in self.state.connection.execute("SELECT transaction_id,port_id,attempts,reason,payload_hash,evidence_hash,recovery_owner,state FROM strata_dead_letters ORDER BY created_at")]
    def execute(self,envelope:ProductionEnvelope):
        targets=envelope.route_targets
        if envelope.route_mode is RouteMode.DIRECT and len(targets)!=1: raise ValueError("direct requires one target")
        if envelope.route_mode in {RouteMode.SPLIT,RouteMode.MULTICAST} and len(targets)<2: raise ValueError("multi-target route requires at least two targets")
        receipts=[]
        for index,target in enumerate(targets):
            self.directory.resolve(target,envelope.destination_capability,envelope.classification.value,envelope.route_mode.value,envelope.organization_id,envelope.tenant_id)
            payload=envelope.payload
            if envelope.route_mode is RouteMode.SPLIT:
                allowed=envelope.disclosure_policy[index].split(",") if index<len(envelope.disclosure_policy) else []
                payload={key:value for key,value in envelope.payload.items() if key in allowed}
            child=replace(envelope,destination_port=target,payload=payload,payload_hash=digest(payload),transaction_id=f"{envelope.transaction_id}:{target}",signatures=())
            child=replace(child,signatures=(self.signer.sign(child.unsigned()),))
            receipts.append(self._dispatch(target,child))
        decision=self.reconciler.reconcile(receipts)
        complete=all(r.port_status=="completed" for r in receipts) and decision["status"]=="reconciled"
        return {"receipts":receipts,"reconciliation":decision,"complete":complete,"partial":any(r.port_status=="completed" for r in receipts) and not complete}
