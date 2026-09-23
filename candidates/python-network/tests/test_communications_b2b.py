import tempfile, unittest
from pathlib import Path
from kindred_superstructure.communications import *
from kindred_superstructure.persistence import SQLiteState
from kindred_superstructure.tenancy import TenantDirectory

def context(tenant="t1"):
    return B2BContext("org1",tenant,"partner1","prod","p1","ent1","agent1","send:message","communications.send","g3t-connected","rail-x","brand","meter","org1","minimal")
def state(rail=TransportRailStatus.NOT_SUBMITTED, recipient=RecipientStatus.NOT_OBSERVED, reconciliation=ReconciliationStatus.PENDING, truth=CommunicationTruth.REQUESTED, evidence=EvidenceStatus.RECORDED, provider=G3TProviderStatus.ACCEPTED):
    return CommunicationState(RequestStatus.AUTHORIZED,provider,rail,recipient,reconciliation,evidence,truth)

class CommunicationsB2BTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.db=SQLiteState(Path(self.tmp.name)/"state.db"); self.log=CommunicationLedger(self.db)
    def tearDown(self): self.db.close(); self.tmp.cleanup()
    def append(self,new,**kw): return self.log.append(context=context(),message_id="m1",new_state=new,correlation_id="c",causation_id="cause",trace_id="trace",acting_identity="g3t-service",channel="email",attempt_number=kw.pop("attempt_number",1),reason_code=kw.pop("reason_code","accepted"),payload_hash="hash",**kw)
    def test_status_dimensions_and_ordered_append_only_history(self):
        a=self.append(state()); b=self.append(state(TransportRailStatus.RAIL_ACCEPTED,reconciliation=ReconciliationStatus.RAIL_REPORTED,truth=CommunicationTruth.RAIL_REPORTED),attempt_number=2)
        events=self.log.events("m1"); self.assertEqual([e.event_id for e in events],[a.event_id,b.event_id]); self.assertEqual(events[1].previous_state,events[0].new_state); self.assertTrue(self.log.verify("m1"))
        self.assertEqual(events[1].recipient_status if hasattr(events[1],"recipient_status") else events[1].new_state.recipient_status,RecipientStatus.NOT_OBSERVED)
    def test_rail_delivery_is_not_recipient_acknowledgement(self):
        event=self.append(state(TransportRailStatus.RAIL_DELIVERED,reconciliation=ReconciliationStatus.RAIL_REPORTED,truth=CommunicationTruth.RAIL_REPORTED))
        self.assertEqual(event.new_state.recipient_status,RecipientStatus.NOT_OBSERVED); self.assertNotEqual(event.new_state.truth_class,CommunicationTruth.RECIPIENT_CONFIRMED)
    def test_recipient_reconciliation_and_external_truth_require_evidence(self):
        with self.assertRaises(ValueError): self.append(state(recipient=RecipientStatus.ACKNOWLEDGED))
        with self.assertRaises(ValueError): self.append(state(reconciliation=ReconciliationStatus.RECONCILED))
        with self.assertRaises(ValueError): self.append(state(truth=CommunicationTruth.EXTERNALLY_VERIFIED))
    def test_retry_failure_idempotency_conflict_and_tamper(self):
        self.append(state(provider=G3TProviderStatus.FAILED),reason_code="rail-timeout",callback_id="cb1")
        duplicate=self.append(state(provider=G3TProviderStatus.FAILED),reason_code="rail-timeout",callback_id="cb1")
        self.assertEqual(len(self.log.events("m1")),1); self.assertEqual(duplicate.reason_code,"rail-timeout")
        with self.assertRaises(ValueError): self.append(state(TransportRailStatus.RAIL_ACCEPTED,reconciliation=ReconciliationStatus.PROVIDER_REPORTED,truth=CommunicationTruth.G3T_REPORTED),attempt_number=2)
        self.db.connection.execute("UPDATE communication_events SET event_json='{}' WHERE message_id='m1'"); self.assertFalse(self.log.verify("m1"))
    def test_tenant_isolation_and_required_context(self):
        directory=TenantDirectory(self.db); directory.onboard("org1","partner1","Org"); directory.provision("t1","org1","prod","brand"); directory.grant("ent1","t1","communications.send")
        self.assertTrue(directory.authorize("org1","t1","ent1","communications.send")); self.assertFalse(directory.authorize("org1","t2","ent1","communications.send"))
        with self.assertRaises(ValueError): context("")
