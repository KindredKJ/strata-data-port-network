import tempfile, unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from kindred_superstructure.models import Classification, RouteMode, Signature
from kindred_superstructure.persistence import SQLiteState
from kindred_superstructure.security import Signer, digest
from kindred_superstructure.strata_network import *

class TestManagedSigner(Signer):
    def sign(self,value): return Signature("test-managed","TEST-ONLY",digest(value),"test-only-not-production-proof")
    def verify(self,value,signature): return signature.value==digest(value)
class TestDestination(DestinationCapability):
    authority="test-destination"
    def __init__(self,blocker=None): self.blocker=blocker; self.payloads=[]
    def readiness_blocker(self): return self.blocker
    def execute(self,envelope): self.payloads.append(envelope.payload); return "completed",digest(envelope.payload)
class TestDispatcher(AuthenticatedDispatcher):
    production_ready=True
    def __init__(self,ports): self.ports=ports
    def dispatch(self,port_id,envelope,destination_transaction_id): return self.ports[port_id].execute(envelope,destination_transaction_id)
class FailingDispatcher(AuthenticatedDispatcher):
    production_ready=True
    def dispatch(self,*args): raise TimeoutError("rail timeout")

class StrataNetworkTests(unittest.TestCase):
    def setUp(self): self.tmp=tempfile.TemporaryDirectory(); self.state=SQLiteState(Path(self.tmp.name)/"s.db"); self.directory=PortDirectory(self.state)
    def tearDown(self): self.state.close(); self.tmp.cleanup()
    def registration(self,readiness=Readiness.BLOCKED,blocker="g3t rail credentials unavailable"):
        return PortRegistration("communications","communications","G3T Connected","unresolved", "1.0.0",("communications.send",),"organization","tenant",("protected",),("minimal",),"service","G3T Connected",("direct","split","multicast"),Health.UNAVAILABLE,readiness,"external","https-mtls",("1.0.0",),False,blocker)
    def envelope(self,tenant="t1",payload=None):
        now=datetime.now(timezone.utc); payload=payload or {"recipient_ref":"r1"}; uid="tx1"
        return ProductionEnvelope("1.0.0","1.0.0","m1","c1","cause1","trace1",uid,"org1",tenant,"partner1","prod","p1","brainstem","service","unified-quad-runtime","BRAINSTEM","communications.send","strata-data-port-zero","communications","communications","communications.send",RouteMode.DIRECT,("communications",),"CommunicationRequest",payload,digest(payload),Classification.PROTECTED,"requested",("recipient_ref",),("protocol.default-deny",),("B2BContext@1",),now.isoformat(),(now+timedelta(minutes=1)).isoformat(),(now+timedelta(seconds=30)).isoformat(),"nonce1",1,"idem1",1,(),{"algorithm":"managed-envelope","key_reference":"tenant-key-ref"})
    def test_real_blocked_path_persists_evidence_without_provider_success(self):
        self.directory.register(self.registration(),"founder-authority-record")
        network=PortZeroNetwork(self.state,self.directory,TestManagedSigner(),{"brainstem":{"communications.send"}})
        with self.assertRaises(BlockedRoute) as caught: network.submit(self.envelope())
        self.assertIn("credentials unavailable",caught.exception.blocker); self.assertRegex(caught.exception.evidence_hash,r"^[0-9a-f]{64}$")
        self.assertEqual(network.audit_export("org1","t1"),[{"transaction_id":"tx1","status":"failed","blocker":"destination blocked: g3t rail credentials unavailable"}])
        self.assertEqual(network.audit_export("org1","other"),[])
    def test_directory_authority_capability_health_and_discovery(self):
        with self.assertRaises(PermissionError): self.directory.register(self.registration(),"")
        self.directory.register(self.registration(),"authority-evidence"); self.assertEqual(len(self.directory.discover("communications.send")),1)
        self.assertFalse(self.directory.operations_snapshot()["payloads_exposed"])
        with self.assertRaises(RuntimeError): self.directory.resolve("communications","communications.send","protected","direct","org1","t1")
        with self.assertRaises(PermissionError): self.directory.deregister("communications","carrier")
    def test_envelope_tamper_expiry_tenant_and_authority_rejected(self):
        self.directory.register(self.registration(),"authority-evidence"); network=PortZeroNetwork(self.state,self.directory,TestManagedSigner(),{"brainstem":{"communications.send"}})
        with self.assertRaises(BlockedRoute) as blocked: network.submit(self.envelope(tenant=""))
        self.assertEqual(blocked.exception.blocker,"organization and tenant required")
        with self.assertRaises(ValueError): network.submit(replace(self.envelope(),payload={"changed":True}))
    def test_five_event_hash_chain_and_middle_tamper(self):
        self.directory.register(self.registration(),"authority-evidence"); network=PortZeroNetwork(self.state,self.directory,TestManagedSigner(),{"brainstem":{"communications.send"}})
        with self.assertRaises(BlockedRoute): network.submit(self.envelope())
        lifecycle=LifecycleStore(self.state); self.assertTrue(lifecycle.verify("tx1")); self.assertGreaterEqual(self.state.connection.execute("SELECT COUNT(*) FROM strata_events WHERE transaction_id='tx1'").fetchone()[0],5)
        middle=self.state.connection.execute("SELECT event_id FROM strata_events WHERE transaction_id='tx1' ORDER BY sequence LIMIT 1 OFFSET 2").fetchone()[0]
        self.state.connection.execute("UPDATE strata_events SET event_json='{}' WHERE event_id=?",(middle,)); self.assertFalse(lifecycle.verify("tx1"))
    def ready_registration(self,port):
        return replace(self.registration(Readiness.READY,None),port_id=port,health=Health.HEALTHY)
    def test_direct_split_multicast_signed_receipts_and_emit_blocker(self):
        signer=TestManagedSigner(); destinations={}
        for port,blocker in (("p1",None),("p2","destination credential unavailable")):
            reg=self.ready_registration(port); self.directory.register(reg,"authority-evidence"); destinations[port]=TestDestination(blocker)
        ports={p:ExternalExecutionPort(self.ready_registration(p),self.state,signer,d) for p,d in destinations.items()}; dispatcher=TestDispatcher(ports); engine=RouteExecutionEngine(self.state,self.directory,dispatcher,EmitCoreReconciler(),signer)
        direct=replace(self.envelope(),destination_port="p1",route_targets=("p1",)); result=engine.execute(direct); self.assertTrue(ports["p1"].verify_receipt(result["receipts"][0],replace(direct,transaction_id="tx1:p1"))); self.assertFalse(result["complete"]); self.assertEqual(result["reconciliation"]["blocker"],"emit_core_authority_not_connected")
        split=replace(self.envelope(payload={"email":"a","secret":"x"}),route_mode=RouteMode.SPLIT,route_targets=("p1","p2"),disclosure_policy=("email","secret")); result=engine.execute(split); self.assertEqual(destinations["p1"].payloads[-1],{"email":"a"}); self.assertEqual(result["receipts"][1].port_status,"failed")
        multi=replace(self.envelope(),route_mode=RouteMode.MULTICAST,route_targets=("p1","p2")); result=engine.execute(multi); self.assertEqual(len(result["receipts"]),2); self.assertFalse(result["complete"]); self.assertTrue(result["partial"])
    def test_retry_exhaustion_dead_letter_survives_restart(self):
        reg=self.ready_registration("p1"); self.directory.register(reg,"authority-evidence"); engine=RouteExecutionEngine(self.state,self.directory,FailingDispatcher(),EmitCoreReconciler(),TestManagedSigner(),max_attempts=3)
        with self.assertRaisesRegex(RuntimeError,"dead letter"): engine.execute(replace(self.envelope(),destination_port="p1",route_targets=("p1",)))
        record=engine.dead_letters()[0]; self.assertEqual(record["attempts"],3); self.assertEqual(record["recovery_owner"],"strata-operations"); self.assertNotIn("recipient_ref",str(record))
        self.state.close(); self.state=SQLiteState(Path(self.tmp.name)/"s.db"); resumed=RouteExecutionEngine(self.state,PortDirectory(self.state),FailingDispatcher(),EmitCoreReconciler(),TestManagedSigner()); self.assertEqual(resumed.dead_letters()[0]["state"],"pending")
