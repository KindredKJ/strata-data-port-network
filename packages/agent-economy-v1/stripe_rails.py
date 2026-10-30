"""Real-provider fiat rails for Kindred human/agent marketplace.

Uses Stripe Connect + Stripe Tax APIs; never treats x402 USDC as Stripe USD
balance or claims that a software port owns a bank account. No provider calls
are made without configured credentials and explicit method invocation.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from agent_economy import EconomyStore, nonnegative

class ProviderError(Exception):
    pass

def _form(data):
    return urllib.parse.urlencode(data).encode("ascii")

class StripeRails:
    def __init__(self,secret_key,store: EconomyStore,api_base="https://api.stripe.com"):
        if not (secret_key.startswith("sk_live_") or secret_key.startswith("sk_test_")):
            raise ValueError("Stripe secret key must be provided by secret manager")
        if api_base!="https://api.stripe.com":
            raise ValueError("custom Stripe API hostname prohibited")
        self.key,self.store,self.base=secret_key,store,api_base

    def _request(self,method,path,data=None,idem=None,account=None):
        headers={"Authorization":"Bearer "+self.key,"Accept":"application/json"}
        if idem:
            if not isinstance(idem,str) or len(idem)>200: raise ValueError("invalid idempotency")
            headers["Idempotency-Key"]=idem
        if account:
            if not account.startswith("acct_"): raise ValueError("invalid connected account")
            headers["Stripe-Account"]=account
        body=None
        if method=="POST":
            body=_form(data or {})
            headers["Content-Type"]="application/x-www-form-urlencoded"
        request=urllib.request.Request(self.base+path,data=body,headers=headers,method=method)
        try:
            with urllib.request.urlopen(request,timeout=15) as response:
                raw=response.read(1_000_001)
                if len(raw)>1_000_000: raise ProviderError("response too large")
                result=json.loads(raw)
                if not isinstance(result,dict): raise ProviderError("invalid provider response")
                return result
        except urllib.error.HTTPError as error:
            raise ProviderError("Stripe rejected request: HTTP "+str(error.code)) from error
        except urllib.error.URLError as error:
            raise ProviderError("Stripe status unknown: reconcile before repeating") from error

    def create_payment_intent(self,purchase_id,amount_cents,currency="usd"):
        if currency!="usd": raise ValueError("USD only until expanded")
        if nonnegative(amount_cents)<50: raise ValueError("minimum fiat amount is 50 cents")
        result=self._request("POST","/v1/payment_intents",{
            "amount":str(amount_cents),"currency":currency,
            "automatic_payment_methods[enabled]":"true",
            "metadata[kindred_purchase_id]":purchase_id},
            idem="kindred:payment_intent:"+purchase_id)
        if not result.get("id","").startswith("pi_"): raise ProviderError("payment intent missing")
        self.store.money_event("stripe:pi:"+purchase_id,"stripe",result["id"],purchase_id,
            "payment_intent",currency,amount_cents,result.get("status","unknown"),result)
        return {"id":result["id"],"status":result.get("status"),
                "client_secret":result.get("client_secret")}

    def calculate_tax(self,quote_id,amount_cents,country,postal_code,tax_code):
        """Requires actual buyer location and merchant-specific configured tax code."""
        nonnegative(amount_cents)
        if country!="US" or not (3<=len(postal_code)<=12):
            raise ValueError("verified US buyer location required for this adapter")
        if not tax_code.startswith("txcd_"): raise ValueError("configured Stripe Tax code required")
        result=self._request("POST","/v1/tax/calculations",{
            "currency":"usd",
            "line_items[0][amount]":str(amount_cents),
            "line_items[0][reference]":quote_id,
            "line_items[0][tax_code]":tax_code,
            "customer_details[address][country]":country,
            "customer_details[address][postal_code]":postal_code,
            "customer_details[address_source]":"billing"
        },idem="kindred:tax:"+quote_id)
        if not result.get("id","").startswith("taxcalc_"):
            raise ProviderError("Stripe Tax calculation missing")
        self.store.money_event("stripe:tax:"+quote_id,"stripe",result["id"],quote_id,
             "tax_quote","usd",amount_cents,"quoted",result)
        return result

    def refund(self,refund_id,purchase_id,payment_intent,amount_cents):
        if not payment_intent.startswith("pi_"): raise ValueError("missing source payment")
        if nonnegative(amount_cents)<1: raise ValueError("invalid refund amount")
        result=self._request("POST","/v1/refunds",{
            "payment_intent":payment_intent,"amount":str(amount_cents),
            "metadata[kindred_purchase_id]":purchase_id,
            "metadata[kindred_refund_id]":refund_id
        },idem="kindred:refund:"+refund_id)
        if not result.get("id","").startswith("re_"): raise ProviderError("refund receipt missing")
        self.store.money_event("stripe:refund:"+refund_id,"stripe",result["id"],purchase_id,
            "refund","usd",amount_cents,result.get("status","pending"),result)
        return result

    def connected_account(self,account_id):
        if not account_id.startswith("acct_"): raise ValueError("invalid connected account")
        return self._request("GET","/v1/accounts/"+urllib.parse.quote(account_id,safe=""))

    def onboarding_link(self,account_id,refresh_url,return_url):
        for url in (refresh_url,return_url):
            if urllib.parse.urlsplit(url).scheme!="https": raise ValueError("HTTPS callback required")
        return self._request("POST","/v1/account_links",{
            "account":account_id,"refresh_url":refresh_url,"return_url":return_url,
            "type":"account_onboarding"
        })

    def transfer_to_connected_account(self,transfer_id,purchase_id,account_id,amount_cents):
        """Requires actual available Stripe platform balance; not USDC balance."""
        if not account_id.startswith("acct_"): raise ValueError("invalid recipient")
        if nonnegative(amount_cents)<1: raise ValueError("invalid amount")
        account=self.connected_account(account_id)
        if account.get("payouts_enabled") is not True or account.get("charges_enabled") is not True:
            raise ProviderError("connected account not fully enabled")
        result=self._request("POST","/v1/transfers",{
            "amount":str(amount_cents),"currency":"usd",
            "destination":account_id,"transfer_group":purchase_id,
            "metadata[kindred_transfer_id]":transfer_id
        },idem="kindred:transfer:"+transfer_id)
        if not result.get("id","").startswith("tr_"): raise ProviderError("transfer missing")
        self.store.money_event("stripe:transfer:"+transfer_id,"stripe",result["id"],
           purchase_id,"transfer","usd",amount_cents,"submitted",result)
        return result

    def payout_connected_account(self,payout_id,purchase_id,account_id,amount_cents):
        if nonnegative(amount_cents)<1: raise ValueError("invalid amount")
        account=self.connected_account(account_id)
        if account.get("payouts_enabled") is not True:
            raise ProviderError("account payouts not enabled")
        result=self._request("POST","/v1/payouts",{
           "amount":str(amount_cents),"currency":"usd",
           "metadata[kindred_payout_id]":payout_id
        },idem="kindred:payout:"+payout_id,account=account_id)
        if not result.get("id","").startswith("po_"): raise ProviderError("payout missing")
        self.store.money_event("stripe:payout:"+payout_id,"stripe",result["id"],
             purchase_id,"payout","usd",amount_cents,result.get("status","pending"),result)
        return result

def verified_stripe_webhook(body: bytes,signature_header: str,secret: str,tolerance=300):
    """Verify full raw webhook bytes BEFORE JSON parsing or durable deduplication."""
    if not secret.startswith("whsec_"): raise ValueError("missing webhook signing secret")
    if len(body)>1_000_000: raise ValueError("webhook too large")
    parts={}
    for fragment in signature_header.split(","):
        k,sep,v=fragment.strip().partition("=")
        if sep: parts.setdefault(k,[]).append(v)
    timestamps=parts.get("t",[])
    if len(timestamps)!=1 or not timestamps[0].isdigit():
        raise PermissionError("missing webhook timestamp")
    ts=int(timestamps[0])
    if abs(time.time()-ts)>tolerance: raise PermissionError("expired webhook")
    expected=hmac.new(secret.encode(),str(ts).encode()+b"."+body,hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected,sig) for sig in parts.get("v1",[])):
        raise PermissionError("invalid webhook signature")
    payload=json.loads(body)
    if not isinstance(payload,dict) or not payload.get("id","").startswith("evt_"):
        raise ValueError("webhook event invalid")
    return payload

def record_webhook(store: EconomyStore,event):
    obj=event.get("data",{}).get("object",{})
    if not isinstance(obj,dict): raise ValueError("missing event object")
    # No blind promotion from event strings to paid. Retrieve source payment and
    # confirm the provider object before fulfilling paid jobs.
    provider_ref=str(obj.get("id",""))
    if not provider_ref: raise ValueError("missing provider object")
    purchase_id=str(obj.get("metadata",{}).get("kindred_purchase_id",""))
    amount=obj.get("amount",0)
    if isinstance(amount,bool) or not isinstance(amount,int) or amount<0:
        raise ValueError("invalid webhook amount")
    return store.money_event("stripe:event:"+event["id"],"stripe",event["id"],
        purchase_id,"webhook:"+event.get("type","unknown"),str(obj.get("currency","usd")),
        amount,str(obj.get("status","observed")),
        {"event_id":event["id"],"object_id":provider_ref,"event_type":event.get("type")})
