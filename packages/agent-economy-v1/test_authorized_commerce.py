import hashlib
import hmac
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent))
from agent_economy import EconomyStore, StateConflict, canon
from authorized_commerce import AuthorizedCommerce
from stripe_rails import StripeRails

KEY="unit-test-brainstem-key-no-real-value-0000001"
TENANT="kindred-tenant-commerce"
AGENT="kindred-agent-commerce"
PI="pi_captured_unit"
ACCOUNT="acct_verified_unit"

class AuthorizedCommerceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=EconomyStore(str(Path(self.tmp.name)/"commerce.sqlite"))
        self.store.register_agent(agent_id=AGENT,tenant_id=TENANT,port_id="port-commerce",
                                 owner_id="owner-commerce")
        self.store.create_budget("budget-usd",TENANT,AGENT,"usd:cents",1000)
        for cap in ("refund","transfer","payout"):
            payload={"grant_id":"grant-"+cap,"tenant_id":TENANT,"agent_id":AGENT,
                     "capability":"kindred.capability.retrobank."+cap+".v1",
                     "budget_id":"budget-usd","ceiling":500,"expires_at":int(time.time())+3600}
            sig=hmac.new(KEY.encode(),canon(payload).encode(),hashlib.sha256).hexdigest()
            self.store.grant(payload,sig,KEY)
        self.rails=StripeRails("sk_test_TEST_KEY_ONLY",self.store)
        self.calls=[]
        self.refund_state="pending"
        self.payout_state="pending"
        def fake(method,path,data=None,idem=None,account=None):
            self.calls.append((method,path,idem))
            if path=="/v1/payment_intents/"+PI:
                return {"id":PI,"status":"succeeded","livemode":False,
                        "amount_received":900,"latest_charge":"ch_unit",
                        "metadata":{"kindred_purchase_id":"purchase-1"}}
            if method=="POST" and path=="/v1/refunds":
                return {"id":"re_unit","status":"pending"}
            if method=="GET" and path=="/v1/refunds/re_unit":
                return {"id":"re_unit","status":self.refund_state}
            if method=="GET" and path=="/v1/accounts/"+ACCOUNT:
                return {"id":ACCOUNT,"charges_enabled":True,"payouts_enabled":True}
            if method=="POST" and path=="/v1/transfers":
                self.assertEqual(data["source_transaction"],"ch_unit")
                return {"id":"tr_unit"}
            if method=="POST" and path=="/v1/payouts":
                self.assertEqual(account,ACCOUNT)
                return {"id":"po_unit","status":"pending"}
            if method=="GET" and path=="/v1/payouts/po_unit":
                self.assertEqual(account,ACCOUNT)
                return {"id":"po_unit","status":self.payout_state}
            raise AssertionError((method,path))
        self.rails._request=fake
        self.auth=AuthorizedCommerce(self.store,self.rails)
    def tearDown(self):
        self.tmp.cleanup()

    def test_refund_transfer_and_payout_respect_grants_and_confirmations(self):
        r=self.auth.refund(refund_id="refund-1",purchase_id="purchase-1",payment_intent=PI,
            amount_cents=100,tenant_id=TENANT,agent_id=AGENT,grant_id="grant-refund")
        self.assertEqual(r["status"],"pending")
        with self.assertRaises(StateConflict):
            self.auth.refund(refund_id="refund-1",purchase_id="purchase-1",payment_intent=PI,
                amount_cents=100,tenant_id=TENANT,agent_id=AGENT,grant_id="grant-refund")
        self.refund_state="succeeded"
        self.auth.reconcile_refund("refund-1")
        self.auth.transfer(transfer_id="transfer-1",purchase_id="purchase-1",
            payment_intent=PI,connected_account=ACCOUNT,
            amount_cents=200,tenant_id=TENANT,agent_id=AGENT,grant_id="grant-transfer")
        self.auth.payout(payout_id="payout-1",purchase_id="purchase-1",
            connected_account=ACCOUNT,amount_cents=100,
            tenant_id=TENANT,agent_id=AGENT,grant_id="grant-payout")
        with self.store.connect() as c:
            row=c.execute("SELECT reserved,spent FROM budgets WHERE budget_id='budget-usd'").fetchone()
            self.assertEqual((row["reserved"],row["spent"]),(100,300))
        self.payout_state="paid"
        self.auth.reconcile_payout("payout-1",ACCOUNT)
        with self.store.connect() as c:
            row=c.execute("SELECT reserved,spent FROM budgets WHERE budget_id='budget-usd'").fetchone()
            self.assertEqual((row["reserved"],row["spent"]),(0,400))
        self.assertTrue(self.store.verify_evidence())

    def test_unverified_source_rejected_before_money_movement(self):
        with self.assertRaises(PermissionError):
            self.auth.refund(refund_id="bad",purchase_id="other",payment_intent=PI,
              amount_cents=200,tenant_id=TENANT,agent_id=AGENT,grant_id="grant-refund")
        self.assertFalse(any(path=="/v1/refunds" for _,path,_ in self.calls))
        self.store.revoke("grant-payout")
        with self.assertRaises(PermissionError):
            self.auth.payout(payout_id="payout-revoked",purchase_id="purchase-1",
               connected_account=ACCOUNT,amount_cents=50,tenant_id=TENANT,
               agent_id=AGENT,grant_id="grant-payout")

if __name__=="__main__":
    unittest.main()
