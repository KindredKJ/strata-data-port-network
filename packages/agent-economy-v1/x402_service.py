"""x402 V2 Base mainnet USDC payment-gated Kindred service.

Payment authorization is cryptographically verified by the configured facilitator,
then independently checked against Base transaction logs before marking settled.
No private key is held by this resource server. Requires legitimate configuration.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import urllib.request
from urllib.parse import urlsplit
from wsgiref.simple_server import make_server
from agent_economy import EconomyStore, StateConflict, canon, digest

BASE = "eip155:8453"
BASE_CHAIN_HEX = "0x2105"
BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
TX = re.compile(r"^0x[0-9a-fA-F]{64}$")
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
PURCHASE = re.compile(r"^[A-Za-z0-9_-]{16,96}$")

def secure_url(value):
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("a configured HTTPS URL is required")
    return value.rstrip("/")

def post_json(url, data, headers=None):
    body=canon(data).encode()
    request=urllib.request.Request(secure_url(url),body,headers={
        "Content-Type":"application/json","Accept":"application/json",
        **(headers or {})},method="POST")
    with urllib.request.urlopen(request,timeout=12) as response:
        if response.status!=200: raise RuntimeError("provider HTTP failure")
        raw=response.read(1024*1024+1)
        if len(raw)>1024*1024: raise RuntimeError("oversize provider response")
        result=json.loads(raw)
        if not isinstance(result,dict): raise RuntimeError("invalid provider JSON")
        return result

def get_json(url,headers=None):
    request=urllib.request.Request(secure_url(url),headers={
        "Accept":"application/json",**(headers or {})},method="GET")
    with urllib.request.urlopen(request,timeout=12) as response:
        if response.status!=200: raise RuntimeError("provider HTTP failure")
        result=json.load(response)
        if not isinstance(result,dict): raise RuntimeError("invalid provider response")
        return result

class X402Facilitator:
    def __init__(self,endpoint,api_token=None):
        self.base=secure_url(endpoint)
        self.headers={"Authorization":"Bearer "+api_token} if api_token else {}
    def supports(self,network=BASE):
        answer=get_json(self.base+"/supported",self.headers)
        return any(x.get("x402Version")==2 and x.get("scheme")=="exact"
                   and x.get("network")==network for x in answer.get("kinds",[]))
    def verify(self,payload,requirements):
        r=post_json(self.base+"/verify",{"paymentPayload":payload,
                             "paymentRequirements":requirements},self.headers)
        if r.get("isValid") is not True: raise PermissionError("facilitator rejected payment")
        return r
    def settle(self,payload,requirements):
        r=post_json(self.base+"/settle",{"paymentPayload":payload,
                             "paymentRequirements":requirements},self.headers)
        if r.get("success") is not True or r.get("network")!=requirements["network"] or not TX.fullmatch(r.get("transaction","")):
            raise RuntimeError("facilitator settlement not confirmed")
        return r

class BaseReceiptVerifier:
    def __init__(self,rpc_url,confirmations=2):
        self.url=secure_url(rpc_url)
        if not isinstance(confirmations,int) or confirmations<1 or confirmations>256:
            raise ValueError("invalid confirmation floor")
        self.confirmations=confirmations
    def rpc(self,method,params):
        r=post_json(self.url,{"jsonrpc":"2.0","id":1,"method":method,"params":params})
        if r.get("error") or "result" not in r:
            raise RuntimeError("invalid chain RPC response")
        return r["result"]
    def verify(self,tx_hash,asset,pay_to,amount):
        if not TX.fullmatch(tx_hash) or not ADDRESS.fullmatch(pay_to) or not ADDRESS.fullmatch(asset):
            raise ValueError("invalid chain proof parameters")
        if self.rpc("eth_chainId",[])!=BASE_CHAIN_HEX:
            raise RuntimeError("RPC connected to wrong chain")
        receipt=self.rpc("eth_getTransactionReceipt",[tx_hash])
        if not isinstance(receipt,dict) or receipt.get("status")!="0x1":
            raise RuntimeError("no successful onchain receipt")
        if receipt.get("transactionHash","").lower()!=tx_hash.lower():
            raise RuntimeError("transaction hash mismatch")
        block=int(receipt["blockNumber"],16)
        head=int(self.rpc("eth_blockNumber",[]),16)
        if head-block+1<self.confirmations:
            raise RuntimeError("onchain confirmations insufficient")
        pay_to_topic="0x"+("0"*24)+pay_to[2:].lower()
        matching=[]
        for log in receipt.get("logs",[]):
            topics=log.get("topics",[])
            if (log.get("address","").lower()==asset.lower() and len(topics)>=3 and
                topics[0].lower()==TRANSFER_TOPIC and topics[2].lower()==pay_to_topic and
                int(log.get("data","0x0"),16)>=amount):
                matching.append(log)
        if not matching:
            raise RuntimeError("no qualifying USDC transfer to merchant")
        return {"chain":BASE,"tx_hash":tx_hash.lower(),"block":block,
                "confirmations":head-block+1,"to":pay_to.lower(),
                "asset":asset.lower(),"minimum_amount":amount,
                "matching_log_indices":[x.get("logIndex") for x in matching],
                "receipt_digest":digest(receipt)}

def decode_payment(header):
    if len(header)>16384: raise ValueError("payment header oversized")
    decoded=base64.b64decode(header,validate=True)
    if len(decoded)>12000: raise ValueError("payment payload oversized")
    payment=json.loads(decoded)
    if not isinstance(payment,dict) or payment.get("x402Version")!=2 or not isinstance(payment.get("payload"),dict):
        raise ValueError("invalid x402 V2 payment")
    return payment

def encode(value):
    return base64.b64encode(canon(value).encode()).decode("ascii")

class PaidCapabilityService:
    """One immutable fixed-price service. Payment state is stable across restarts.

    This is an application WSGI handler; terminate TLS and authenticate operators
    at your reverse proxy. Public buyers need an opaque X-Kindred-Purchase-Id.
    """
    def __init__(self,store,facilitator,chain,*,merchant,public_origin,
                 tenant_id,agent_id,amount=10000):
        if not ADDRESS.fullmatch(merchant): raise ValueError("merchant address required")
        if not isinstance(amount,int) or amount<1: raise ValueError("invalid price")
        self.store,self.facilitator,self.chain=store,facilitator,chain
        self.merchant=merchant
        self.origin=secure_url(public_origin)
        self.tenant_id,self.agent_id=tenant_id,agent_id
        self.amount=amount
        self.route="/v1/paid/agent-capabilities"
        self.requirements={"scheme":"exact","network":BASE,
             "amount":str(amount),"asset":BASE_USDC,"payTo":merchant,
             "maxTimeoutSeconds":60,"extra":{"name":"USDC","version":"2"}}
        self.resource={"url":self.origin+self.route,"description":"Kindred agent capability manifest",
             "mimeType":"application/json","serviceName":"Kindred Labs"}
        self.catalog={"version":"kindred.marketplace.capability.v1",
                      "capabilities":["agent.discovery","human-agent.matching",
                                      "proof.receipt.query"],
                      "provider":"Kindred Labs","delivery":"read-only"}

    def respond(self,start,status,body,headers=None):
        b=canon(body).encode()
        start(status,[("Content-Type","application/json"),("Content-Length",str(len(b))),
                      ("Cache-Control","no-store"),("X-Content-Type-Options","nosniff"),
                      *(headers or [])])
        return [b]

    def __call__(self,environ,start):
        method=environ.get("REQUEST_METHOD","GET")
        route=environ.get("PATH_INFO","")
        if route=="/healthz" and method=="GET":
            return self.respond(start,"200 OK",{"service":"kindred-agent-economy","status":"online"})
        if route!=self.route or method!="GET":
            return self.respond(start,"404 Not Found",{"error":"unknown resource"})
        purchase_id=environ.get("HTTP_X_KINDRED_PURCHASE_ID","")
        if not PURCHASE.fullmatch(purchase_id):
            return self.respond(start,"400 Bad Request",{"error":"X-Kindred-Purchase-Id must be a stable random ID (16-96 chars)"})
        request={"method":"GET","resource":self.resource["url"],
                 "tenant_id":self.tenant_id,"agent_id":self.agent_id}
        try:
            p=self.store.begin_purchase(purchase_id,self.tenant_id,self.agent_id,request,self.requirements)
        except (StateConflict,PermissionError):
            return self.respond(start,"409 Conflict",{"error":"purchase identity conflict"})
        if p["status"]=="settled":
            return self.respond(start,"200 OK",self.catalog,[
                ("PAYMENT-RESPONSE",encode(json.loads(p["facilitator_receipt"])))])
        if p["status"] not in ("required",):
            return self.respond(start,"409 Conflict",{"error":"payment pending reconciliation","purchase_id":purchase_id})
        challenge={"x402Version":2,"resource":self.resource,
                   "accepts":[self.requirements],"extensions":{}}
        payment_header=environ.get("HTTP_PAYMENT_SIGNATURE")
        if not payment_header:
            return self.respond(start,"402 Payment Required",challenge,[("PAYMENT-REQUIRED",encode(challenge))])
        try:
            payment=decode_payment(payment_header)
            if payment.get("accepted")!=self.requirements:
                raise PermissionError("payment terms altered")
            self.store.payment_transition(purchase_id,"required","verifying",signature=payment)
            verified=self.facilitator.verify(payment,self.requirements)
            self.store.payment_transition(purchase_id,"verifying","verified",facilitator=verified)
            self.store.payment_transition(purchase_id,"verified","settlement_pending")
            # Never retry /settle blindly after an ambiguous failure.
            settlement=self.facilitator.settle(payment,self.requirements)
            chain=self.chain.verify(settlement["transaction"],BASE_USDC,self.merchant,self.amount)
            self.store.payment_transition(purchase_id,"settlement_pending","settled",
                    facilitator=settlement,chain=chain,tx_hash=settlement["transaction"].lower())
            self.store.money_event("x402:"+purchase_id,"x402",settlement["transaction"].lower(),
                    purchase_id,"payment",BASE_USDC,self.amount,"settled",{
                        "facilitator":settlement,"chain":chain})
            return self.respond(start,"200 OK",self.catalog,[
                ("PAYMENT-RESPONSE",encode(settlement))])
        except (ValueError,PermissionError) as e:
            return self.respond(start,"402 Payment Required",{"error":str(e)})
        except Exception:
            return self.respond(start,"503 Service Unavailable",{
                "error":"payment unresolved; manual reconciliation required before retry",
                "purchase_id":purchase_id})

def production_service():
    env=os.environ
    required=("KINDRED_ECONOMY_DB","KINDRED_X402_FACILITATOR_URL",
              "KINDRED_BASE_RPC_URL","KINDRED_MERCHANT_WALLET",
              "KINDRED_PUBLIC_ORIGIN","KINDRED_SELLER_TENANT","KINDRED_SELLER_AGENT")
    missing=[x for x in required if not env.get(x)]
    if missing: raise RuntimeError("configuration missing: "+",".join(missing))
    facilitator=X402Facilitator(env["KINDRED_X402_FACILITATOR_URL"],
                               env.get("KINDRED_X402_FACILITATOR_TOKEN"))
    if not facilitator.supports(BASE): raise RuntimeError("facilitator does not support Base exact V2")
    return PaidCapabilityService(EconomyStore(env["KINDRED_ECONOMY_DB"]),facilitator,
            BaseReceiptVerifier(env["KINDRED_BASE_RPC_URL"]),
            merchant=env["KINDRED_MERCHANT_WALLET"],public_origin=env["KINDRED_PUBLIC_ORIGIN"],
            tenant_id=env["KINDRED_SELLER_TENANT"],agent_id=env["KINDRED_SELLER_AGENT"])

if __name__=="__main__":
    # Single-node maintenance only. For production run via a hardened WSGI server
    # behind HTTPS ingress after configuring persistent storage and supervised workers.
    app=production_service()
    with make_server("127.0.0.1",8787,app) as server:
        server.serve_forever()
