"""Kindred One partner SDK over production Port Zero and evidence interfaces."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from .models import Classification, RouteMode
from .security import Signer, digest
from .strata_network import ProductionEnvelope, SignedPortReceipt
from .tenancy import TenantDirectory

@dataclass(frozen=True)
class PartnerContext:
    organization_id:str; tenant_id:str; partner_id:str; environment_id:str; project_id:str
    entitlement_id:str; requesting_identity:str; delegated_authority:str; evidence_owner:str
    disclosure_policy:tuple[str,...]; metering_context:str

@dataclass(frozen=True)
class CredentialReference:
    identity_id:str; secret_reference:str
    def __post_init__(self):
        if not self.secret_reference or any(mark in self.secret_reference.lower() for mark in ("password=","secret=","token=")): raise ValueError("credential must be an opaque secret reference")

class PortZeroClient:
    def __init__(self,tenant_directory:TenantDirectory,submitter,signer:Signer,credential:CredentialReference): self.tenants=tenant_directory;self.submitter=submitter;self.signer=signer;self.credential=credential
    def create_envelope(self,context:PartnerContext,*,capability,destination_stratum,destination_port,payload,payload_type,route_targets,route_mode=RouteMode.DIRECT,classification=Classification.PROTECTED,ttl_seconds=60):
        if not self.tenants.authorize(context.organization_id,context.tenant_id,context.entitlement_id,capability): raise PermissionError("tenant entitlement denied")
        now=datetime.now(timezone.utc); transaction=str(uuid4()); message=str(uuid4())
        envelope=ProductionEnvelope("1.0.0","1.0.0",message,message,message,message,transaction,context.organization_id,context.tenant_id,context.partner_id,context.environment_id,context.project_id,context.requesting_identity,"partner","kindred-one-sdk","partner-organization",context.delegated_authority,"strata-data-port-zero",destination_stratum,destination_port,capability,route_mode,tuple(route_targets),payload_type,payload,digest(payload),classification,"requested",context.disclosure_policy,("protocol.default-deny",),("B2BContext@1","StrataTransportEnvelope@1"),now.isoformat(),(now+timedelta(seconds=ttl_seconds)).isoformat(),(now+timedelta(seconds=ttl_seconds)).isoformat(),str(uuid4()),1,transaction,1,(),{"key_reference":self.credential.secret_reference,"algorithm":"managed-envelope"})
        return envelope
    def submit(self,envelope): return self.submitter(envelope)
    def verify_receipt(self,receipt:SignedPortReceipt,envelope): return bool(receipt.signatures and self.signer.verify(receipt.unsigned(),receipt.signatures[0]) and receipt.organization_id==envelope.organization_id and receipt.tenant_id==envelope.tenant_id and receipt.parent_transaction_id==envelope.transaction_id and receipt.correlation_id==envelope.correlation_id)
    def submit_aoi_task(self,context,objective): return self.submit(self.create_envelope(context,capability="brainstem.objective",destination_stratum="protected-runtime",destination_port="brainstem",payload=objective,payload_type="NeedEnvelope",route_targets=("brainstem",)))
    def submit_watt_capability(self,context,request): return self.submit(self.create_envelope(context,capability="watt.analyze",destination_stratum="watt",destination_port="watt",payload=request,payload_type="WattCapabilityRequest",route_targets=("watt",)))
