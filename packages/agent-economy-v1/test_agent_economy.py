import base64
import hashlib
import hmac
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent))
from agent_economy import EconomyStore, StateConflict, canon, digest
from x402_service import PaidCapabilityService, BaseReceiptVerifier, BASE_USDC, TRANSFER_TOPIC, decode_payment
from stripe_rails import StripeRails, verified_stripe_webhook, record_webhook

TENANT="kindred-tenant-testing"
AGENT="kindred-agent-testing12345"
OTHER="kindred-tenant-other"
WALLET="0x"+"3"*40
TX="0x"+"2"*64
KEY="brainstem-key-for-test-only-not-a-live-key-123456"

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=str(Path(self.tmp.name)/"economic.sqlite")
        self.s=EconomyStore(self.db)
        self.s.register_agent(agent_id=AGENT,tenant_id=TENANT,port_id="port-001",owner_id="owner-test")
        self.s.create_budget("budget-001",TENANT,AGENT,"USDC:base:atomic",100)
        self.g={"grant_id":"grant-001","tenant_id":TENANT,"agent_id":AGENT,
                "capability":"kindred.agent.purchase","budget_id":"budget-001",
                "ceiling":80,"expires_at":int(time.time())+3600}
        sig=hmac.new(KEY.encode(),canon(self.g).encode(),hashlib.sha256).hexdigest()
        self.s.grant(self.g,sig,KEY)

    def tearDown(self):
        self.tmp.cleanup()

    def reserve(self,operation_id,amount=30,request=None):
        return self.s.reserve(operation_id=operation_id,grant_id="grant-001",
                 tenant_id=TENANT,agent_id=AGENT,capability="kindred.agent.purchase",
                 amount=amount,request=request or {"job":"A"})

    def test_grant_signature_and_tenant_cap(self):
        self.s.register_agent(agent_id="kindred-agent-else",tenant_id=OTHER,
                              port_id="port-else",owner_id="somebody")
        self.assertIsNone(self.s.agent(OTHER,AGENT))
        self.assertEqual(self.reserve("op-one",50)["status"],"reserved")
        with self.assertRaises(PermissionError):
            self.reserve("op-two",60)
        with self.assertRaises(StateConflict):
            self.reserve("op-one",50,{"job":"altered"})
        self.assertEqual(self.reserve("op-one",50)["status"],"reserved")
        self.s.finalize_reservation("op-one","captured")
        with self.assertRaises(ValueError):
            self.s.finalize_reservation("op-one","unknown")
        self.s.revoke("grant-001")
        with self.assertRaises(PermissionError):
            self.reserve("op-three",1)
        self.assertTrue(self.s.verify_evidence())

    def test_parallel_budget_reservation_is_atomic(self):
        def claim(i):
            try:
                self.reserve("op-"+str(i),30)
                return True
            except PermissionError:
                return False
        with ThreadPoolExecutor(max_workers=12) as ex:
            outcomes=list(ex.map(claim,range(12)))
        self.assertEqual(sum(outcomes),3)
        with self.s.connect() as c:
            r=c.execute("SELECT reserved,spent FROM budgets WHERE budget_id='budget-001'").fetchone()
            self.assertEqual((r["reserved"],r["spent"]),(90,0))

    def test_mailbox_memory_and_fenced_recovery(self):
        self.assertTrue(self.s.mailbox_put(TENANT,AGENT,"msg-a",{"task":"classify"}))
        self.assertFalse(self.s.mailbox_put(TENANT,AGENT,"msg-a",{"task":"classify"}))
        with self.assertRaises(StateConflict):
            self.s.mailbox_put(TENANT,AGENT,"msg-a",{"task":"other"})
        self.s.memory_put(TENANT,AGENT,"owner_preferences",{"locale":"en-US"})
        restarted=EconomyStore(self.db)
        self.assertEqual(restarted.memory_get(TENANT,AGENT,"owner_preferences"),{"locale":"en-US"})
        self.assertIsNone(restarted.memory_get(OTHER,AGENT,"owner_preferences"))
        epoch=restarted.acquire_lease(TENANT,AGENT,"worker-1",10)
        restarted.checkpoint(TENANT,AGENT,"worker-1",epoch,"workflow-a","done",
                             {"complete":True},ack_message="msg-a")
        self.assertEqual(restarted.mailbox_pending(TENANT,AGENT),[])
        newer=restarted.acquire_lease(TENANT,AGENT,"worker-1",10)
        self.assertGreater(newer,epoch)
        with self.assertRaises(StateConflict):
            restarted.checkpoint(TENANT,AGENT,"worker-1",epoch,"workflow-a","done",{})
        with self.assertRaises(PermissionError):
            restarted.checkpoint(OTHER,AGENT,"worker-1",newer,"workflow-a","done",{})
        self.assertTrue(restarted.verify_evidence())

    def test_purchase_state_and_pending_reconcile(self):
        req={"resource":"kindred.ai/paid"}
        x={"scheme":"exact","network":"eip155:8453"}
        self.s.begin_purchase("purchase-100",TENANT,AGENT,req,x)
        with self.assertRaises(StateConflict):
            self.s.begin_purchase("purchase-100",TENANT,AGENT,{"resource":"evil"},x)
        self.s.payment_transition("purchase-100","required","verifying",signature={"signed":True})
        self.s.payment_transition("purchase-100","verifying","verified",facilitator={"isValid":True})
        self.s.payment_transition("purchase-100","verified","settlement_pending")
        self.s.attach_settlement_proof("purchase-100",{"transaction":TX,"success":True})
        pending=EconomyStore(self.db).purchase("purchase-100")
        self.assertEqual(pending["status"],"settlement_pending")
        self.assertEqual(pending["tx_hash"],TX)
        self.s.payment_transition("purchase-100","settlement_pending","settled",
             chain={"confirmed":True},tx_hash=TX)
        self.assertEqual(self.s.purchase("purchase-100")["status"],"settled")
        self.assertTrue(self.s.verify_evidence())

    def test_double_entry_asset_isolated(self):
        self.assertTrue(self.s.journal_post("x","USDC:base:atomic",
                          {"asset:merchant":10000,"liability:customer":-10000}))
        self.assertFalse(self.s.journal_post("x","USDC:base:atomic",
                          {"asset:merchant":10000,"liability:customer":-10000}))
        with self.assertRaises(ValueError):
            self.s.journal_post("y","usd:cents",{"asset":100,"liability":-90})

class FakeFacilitator:
    calls=0
    def verify(self,payload,requirements):
        self.calls+=1
        return {"isValid":True,"payer":"0x"+"4"*40}
    def settle(self,payload,requirements):
        self.calls+=1
        return {"success":True,"network":"eip155:8453","transaction":TX,"payer":"0x"+"4"*40}

class FakeChain:
    def verify(self,tx_hash,asset,pay_to,amount):
        if tx_hash!=TX or amount!=10000: raise AssertionError("wrong payment")
        return {"tx_hash":tx_hash,"confirmations":2}

class PaymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.s=EconomyStore(str(Path(self.tmp.name)/"test.sqlite"))
        self.s.register_agent(agent_id=AGENT,tenant_id=TENANT,port_id="port-001",owner_id="owner")
        self.fac=FakeFacilitator()
        self.service=PaidCapabilityService(self.s,self.fac,FakeChain(),merchant=WALLET,
             public_origin="https://kindredlabs.ai",tenant_id=TENANT,agent_id=AGENT)
        self.pid="examplepurchase0001"
    def tearDown(self):
        self.tmp.cleanup()
    def call(self,signature=None,pid=None):
        env={"REQUEST_METHOD":"GET","PATH_INFO":self.service.route,
             "HTTP_X_KINDRED_PURCHASE_ID":pid or self.pid}
        if signature: env["HTTP_PAYMENT_SIGNATURE"]=signature
        state={}
        def start(status,headers):
            state["status"]=status
            state["headers"]=dict(headers)
        body=b"".join(self.service(env,start))
        return state,json.loads(body)
    def test_real_protocol_shape_no_unauthorized_settlement(self):
        info,response=self.call()
        self.assertEqual(info["status"],"402 Payment Required")
        self.assertIn("PAYMENT-REQUIRED",info["headers"])
        self.assertEqual(response["x402Version"],2)
        self.assertEqual(self.fac.calls,0)
        payment={"x402Version":2,"accepted":self.service.requirements,
                 "payload":{"signature":"test-signature"}}
        header=base64.b64encode(canon(payment).encode()).decode()
        info,response=self.call(header)
        self.assertEqual(info["status"],"200 OK")
        self.assertIn("PAYMENT-RESPONSE",info["headers"])
        self.assertEqual(self.s.purchase(self.pid)["status"],"settled")
        self.assertEqual(self.fac.calls,2)
        info,response=self.call(header)
        self.assertEqual(info["status"],"200 OK")
        self.assertEqual(self.fac.calls,2)
    def test_tampered_payee_denied(self):
        bad={**self.service.requirements,"payTo":"0x"+"1"*40}
        payment={"x402Version":2,"accepted":bad,"payload":{"signature":"x"}}
        info,_=self.call(base64.b64encode(canon(payment).encode()).decode())
        self.assertEqual(info["status"],"402 Payment Required")
        self.assertEqual(self.fac.calls,0)

    def test_evm_receipt_checks_real_token_transfer_fields(self):
        v=BaseReceiptVerifier("https://base-rpc.example.com")
        receipt={"status":"0x1","transactionHash":TX,"blockNumber":"0x63",
                 "logs":[{"address":BASE_USDC,"topics":[TRANSFER_TOPIC,
                 "0x"+("0"*24)+("4"*40),"0x"+("0"*24)+WALLET[2:]],"data":"0x2710",
                 "logIndex":"0x0"}]}
        def rpc(method,params):
            return {"eth_chainId":"0x2105",
                     "eth_getTransactionReceipt":receipt,"eth_blockNumber":"0x64"}[method]
        v.rpc=rpc
        self.assertEqual(v.verify(TX,BASE_USDC,WALLET,10000)["confirmations"],2)
        with self.assertRaises(RuntimeError):
            v.verify(TX,BASE_USDC,"0x"+"1"*40,10000)

class StripeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.s=EconomyStore(str(Path(self.tmp.name)/"stripe.sqlite"))
        self.rails=StripeRails("sk_test_UNIT_TEST_ONLY",self.s)
    def tearDown(self):
        self.tmp.cleanup()
    def test_fiat_adapters_require_provider_receipts(self):
        def fake_request(method,path,data=None,idem=None,account=None):
            if path.startswith("/v1/payment_intents"): return {"id":"pi_unit","status":"requires_payment_method"}
            if path.startswith("/v1/refunds"): return {"id":"re_unit","status":"pending"}
            if path.startswith("/v1/accounts/"): return {"id":"acct_unit","payouts_enabled":True,"charges_enabled":True}
            if path.startswith("/v1/transfers"): return {"id":"tr_unit"}
            if path.startswith("/v1/payouts"): return {"id":"po_unit","status":"pending"}
            if path.startswith("/v1/tax/calculations"): return {"id":"taxcalc_unit"}
            raise AssertionError(path)
        self.rails._request=fake_request
        p=self.rails.create_payment_intent("purchase-one",500)
        self.assertEqual(p["status"],"requires_payment_method")
        self.assertEqual(self.rails.refund("refund-one","purchase-one","pi_unit",200)["status"],"pending")
        self.assertEqual(self.rails.calculate_tax("quote-one",500,"US","80202","txcd_10000000")["id"],"taxcalc_unit")
        self.assertEqual(self.rails.transfer_to_connected_account("tr-one","purchase-one","acct_unit",100)["id"],"tr_unit")
        self.assertEqual(self.rails.payout_connected_account("po-one","purchase-one","acct_unit",100)["status"],"pending")
        self.assertTrue(self.s.verify_evidence())
    def test_stripe_webhook_crypto_integrity(self):
        secret="whsec_UNIT_TEST"
        event={"id":"evt_test","type":"payment_intent.succeeded",
            "data":{"object":{"id":"pi_test","status":"succeeded",
                  "amount":500,"currency":"usd",
                  "metadata":{"kindred_purchase_id":"p1"}}}}
        data=canon(event).encode()
        stamp=str(int(time.time()))
        mac=hmac.new(secret.encode(),stamp.encode()+b"."+data,hashlib.sha256).hexdigest()
        parsed=verified_stripe_webhook(data,"t="+stamp+",v1="+mac,secret)
        self.assertEqual(parsed["id"],"evt_test")
        self.assertEqual(record_webhook(self.s,parsed)["state"],"succeeded")
        with self.assertRaises(PermissionError):
            verified_stripe_webhook(data,"t="+stamp+",v1="+("0"*64),secret)

if __name__=="__main__":
    unittest.main()
