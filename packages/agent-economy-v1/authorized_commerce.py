"""Brainstem-governed Stripe economic actions with durable preflight claims.

Each outbound operation gets one atomic budget reservation and one immutable
provider-attempt record *before* network I/O. Unknown network outcomes require
provider reconciliation; never automatically submit the same money movement.
"""
from agent_economy import EconomyStore, StateConflict
from stripe_rails import StripeRails, ProviderError

class AuthorizedCommerce:
    def __init__(self,store: EconomyStore,rails: StripeRails):
        self.store,self.rails=store,rails

    def _claim(self,operation_id,tenant_id,agent_id,grant_id,capability,amount,request):
        result=self.store.reserve(operation_id=operation_id,grant_id=grant_id,
            tenant_id=tenant_id,agent_id=agent_id,capability=capability,
            amount=amount,asset="usd:cents",request=request)
        with self.store.connect() as c:
            prior=c.execute("SELECT event_id FROM money_events WHERE event_id=?",
                            ("attempt:"+operation_id,)).fetchone()
        if prior:
            raise StateConflict("provider attempt already exists; reconcile source before repeating")
        self.store.money_event("attempt:"+operation_id,"kindred",operation_id,
            request["purchase_id"],"provider_attempt","usd:cents",amount,
            "pending",{"capability":capability,"request":request})
        return result

    def _verified_source(self,purchase_id,payment_intent,amount):
        if not payment_intent.startswith("pi_"):
            raise ValueError("invalid payment source")
        provider=self.rails._request("GET","/v1/payment_intents/"+payment_intent)
        if (provider.get("status")!="succeeded" or
            provider.get("metadata",{}).get("kindred_purchase_id")!=purchase_id or
            not isinstance(provider.get("amount_received"),int) or
            provider["amount_received"]<amount):
            raise PermissionError("verified captured Stripe funding required")
        if provider.get("livemode") is not self.rails.key.startswith("sk_live_"):
            raise PermissionError("payment source environment mismatch")
        return provider

    def refund(self,*,refund_id,purchase_id,payment_intent,amount_cents,
               tenant_id,agent_id,grant_id):
        source=self._verified_source(purchase_id,payment_intent,amount_cents)
        op="refund:"+refund_id
        self._claim(op,tenant_id,agent_id,grant_id,"kindred.capability.retrobank.refund.v1",
                    amount_cents,{"purchase_id":purchase_id,"payment_intent":payment_intent,
                                  "refund_id":refund_id,"amount":amount_cents})
        outcome=self.rails.refund(refund_id,purchase_id,payment_intent,amount_cents)
        if outcome.get("status")=="succeeded":
            self.store.finalize_reservation(op,"captured")
        return outcome

    def transfer(self,*,transfer_id,purchase_id,payment_intent,connected_account,
                 amount_cents,tenant_id,agent_id,grant_id):
        source=self._verified_source(purchase_id,payment_intent,amount_cents)
        charge=source.get("latest_charge")
        if not isinstance(charge,str) or not charge.startswith("ch_"):
            raise PermissionError("verified source charge required")
        op="transfer:"+transfer_id
        self._claim(op,tenant_id,agent_id,grant_id,"kindred.capability.retrobank.transfer.v1",
                    amount_cents,{"purchase_id":purchase_id,"payment_intent":payment_intent,
                                  "connected_account":connected_account,"amount":amount_cents})
        result=self.rails.transfer_to_connected_account(transfer_id,purchase_id,
             connected_account,amount_cents,source_transaction=charge)
        self.store.finalize_reservation(op,"captured")
        return result

    def payout(self,*,payout_id,purchase_id,connected_account,amount_cents,
               tenant_id,agent_id,grant_id):
        op="payout:"+payout_id
        self._claim(op,tenant_id,agent_id,grant_id,"kindred.capability.retrobank.payout.v1",
                    amount_cents,{"purchase_id":purchase_id,"connected_account":connected_account,
                                  "amount":amount_cents})
        # Payout creation reports pending; reserve stays held until verified 'paid'.
        return self.rails.payout_connected_account(payout_id,purchase_id,
            connected_account,amount_cents)

    def reconcile_refund(self,refund_id):
        op="refund:"+refund_id
        row=self._pending(op)
        with self.store.connect() as c:
            event=c.execute("SELECT provider_ref FROM money_events WHERE event_id=?",
                            ("stripe:refund:"+refund_id,)).fetchone()
        if not event: raise StateConflict("no provider reference: investigate before retry")
        latest=self.rails._request("GET","/v1/refunds/"+event["provider_ref"])
        self._reconcile(op,latest.get("status"),success={"succeeded"},
                        failure={"failed","canceled"})
        return latest

    def reconcile_payout(self,payout_id,connected_account):
        op="payout:"+payout_id
        row=self._pending(op)
        with self.store.connect() as c:
            event=c.execute("SELECT provider_ref FROM money_events WHERE event_id=?",
                            ("stripe:payout:"+payout_id,)).fetchone()
        if not event: raise StateConflict("no provider reference: investigate before retry")
        latest=self.rails._request("GET","/v1/payouts/"+event["provider_ref"],
                                   account=connected_account)
        self._reconcile(op,latest.get("status"),success={"paid"},
                        failure={"failed","canceled"})
        return latest

    def _pending(self,operation_id):
        with self.store.connect() as c:
            result=c.execute("SELECT * FROM reservations WHERE operation_id=?",
                             (operation_id,)).fetchone()
        if not result: raise KeyError(operation_id)
        return dict(result)

    def _reconcile(self,operation_id,state,*,success,failure):
        if state in success:
            self.store.finalize_reservation(operation_id,"captured")
        elif state in failure:
            self.store.finalize_reservation(operation_id,"released")
        else:
            # pending, in_transit, unknown: retain reservation.
            return "pending"
        return state
