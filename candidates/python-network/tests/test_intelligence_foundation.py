import json,tempfile,unittest
from dataclasses import replace
from datetime import datetime,timezone
from pathlib import Path
from kindred_superstructure.intelligence import *
from kindred_superstructure.persistence import SQLiteState
from kindred_superstructure.security import digest

class IntelligenceFoundationTests(unittest.TestCase):
    def setUp(self): self.tmp=tempfile.TemporaryDirectory();self.state=SQLiteState(Path(self.tmp.name)/"i.db")
    def tearDown(self): self.state.close();self.tmp.cleanup()
    def test_policy_qualified_resource_selection_not_provider_authority(self):
        registry=CognitiveResourceRegistry(self.state)
        registry.register(CognitiveResource("r1","provider-a","reasoner","1",("plan",),(),1000,("text",),50,5,"no-training","zero",("tenant-a",),("protected",),.9,"healthy",{"planning":.8}))
        registry.register(CognitiveResource("r2","provider-b","reasoner","2",("plan",),(),1000,("text",),20,50,"no-training","zero",("tenant-a",),("protected",),.95,"healthy",{"planning":.9}))
        selected=registry.select(capability="plan",tenant="tenant-a",classification="protected",max_cost_minor=10,max_latency_ms=100,minimum_evidence=.8)
        self.assertEqual(selected.identity,"r1")
        with self.assertRaises(LookupError): registry.select(capability="plan",tenant="tenant-b",classification="protected",max_cost_minor=10,max_latency_ms=100,minimum_evidence=.8)
    def test_memory_is_evidence_bound_and_tenant_isolated(self):
        memory=MemoryFabric(self.state); content={"strategy":"bounded-route"}; record=MemoryRecord("m1","procedural","execution","brainstem","org","t1",datetime.now(timezone.utc).isoformat(),"reconciled",("e1",),.8,"protected","policy-1",("planning",),"1",digest(content),content); memory.append(record)
        self.assertEqual(len(memory.recall("org","t1","procedural","planning")),1);self.assertEqual(memory.recall("org","t2","procedural","planning"),[])
        with self.assertRaises(ValueError): memory.append(replace(record,record_id="bad",content_hash="wrong"))
    def test_planning_authority_budget_and_adaptation(self):
        planner=PlanningEngine(); step=PlanStep("s1","communications.send",(),"G3T Connected",5,"deadline",("receipt",),("communications.health",)); plan=planner.build("objective","org","tenant",[step],"initial")
        with self.assertRaises(PermissionError): planner.authorize(plan,{"G3T Connected"},4)
        authorized=planner.authorize(plan,{"G3T Connected"},5); self.assertEqual(authorized.steps[0].state,ActionState.AUTHORIZED)
        revised=planner.replan(authorized,"s1","destination unavailable"); self.assertEqual(revised.steps[0].capability,"communications.health");self.assertEqual(revised.steps[0].state,ActionState.PROPOSED)
    def test_benchmark_cannot_promote_without_evidence(self):
        evaluator=IntelligenceEvaluator(); result=BenchmarkResult("b1","governance","deny cross tenant","local",("memory.recall",),{"denied":True},{"denied":True},("evidence-hash",),1,None,{"commit":"abc","command":"unit"});self.assertTrue(evaluator.record(result)["promotion_evidence"])
        with self.assertRaises(ValueError): evaluator.record(replace(result,evidence=()))
    def test_no_maturity_level_is_claimed_by_architecture(self):
        aoi=json.loads(Path("architecture/intelligence-maturity-model.yaml").read_text());watt=json.loads(Path("architecture/watt-intelligence-maturity-model.yaml").read_text())
        self.assertEqual(aoi["assignment_rule"],"benchmark-evidence-required; architecture-alone-prohibited");self.assertIsNone(watt["current_assignment"]);self.assertFalse(aoi["agi_equivalent"])
