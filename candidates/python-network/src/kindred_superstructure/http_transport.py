"""Credential-free configuration surface for real HTTPS/mTLS Strata transport."""
from __future__ import annotations
import json, ssl
from dataclasses import asdict, fields
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import HTTPSHandler, Request, build_opener
from .models import Signature
from .strata_network import AuthenticatedDispatcher, ProductionEnvelope, SignedPortReceipt

class MTLSConfigurationError(RuntimeError): pass

class HttpMTLSDispatcher(AuthenticatedDispatcher):
    """Real HTTPS dispatcher; fails closed until certificate references exist."""
    production_ready=True
    def __init__(self,endpoints:dict[str,str],certificate:Path,private_key:Path,ca_bundle:Path,timeout_seconds:float=10):
        if not endpoints or any(urlparse(url).scheme!="https" for url in endpoints.values()): raise MTLSConfigurationError("HTTPS port endpoints required")
        for path in (certificate,private_key,ca_bundle):
            if not path.is_file(): raise MTLSConfigurationError(f"mTLS file reference unavailable: {path.name}")
        context=ssl.create_default_context(cafile=str(ca_bundle)); context.load_cert_chain(str(certificate),str(private_key)); self.opener=build_opener(HTTPSHandler(context=context)); self.endpoints=endpoints;self.timeout=timeout_seconds
    def dispatch(self,port_id,envelope:ProductionEnvelope,destination_transaction_id)->SignedPortReceipt:
        if port_id not in self.endpoints: raise LookupError("authenticated endpoint not registered")
        body=json.dumps(asdict(envelope),sort_keys=True,default=lambda value:value.value).encode(); request=Request(self.endpoints[port_id],data=body,method="POST",headers={"Content-Type":"application/json","Idempotency-Key":envelope.idempotency_key,"X-Transaction-ID":destination_transaction_id})
        with self.opener.open(request,timeout=self.timeout) as response:
            if response.status<200 or response.status>=300: raise RuntimeError(f"external port HTTP status {response.status}")
            data=json.loads(response.read().decode("utf-8"))
        allowed={item.name for item in fields(SignedPortReceipt)}
        if set(data)!=allowed: raise ValueError("invalid signed receipt field set")
        data["signatures"]=tuple(Signature(**item) for item in data["signatures"])
        return SignedPortReceipt(**data)
