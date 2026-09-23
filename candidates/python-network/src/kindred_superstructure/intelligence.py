"""Protected AOI interfaces for resource selection, memory, planning, and evaluation."""
from __future__ import annotations
import json
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4
from .persistence import SQLiteState
from .security import digest

@dataclass(frozen=True)
class CognitiveResource:
    identity:str; provider:str; name:str; version:str; capabilities:tuple[str,...]; limitations:tuple[str,...]
    context_capacity:int; modalities:tuple[str,...]; latency_ms:int; cost_minor:int; data_policy:str
    retention_policy:str; tenant_eligibility:tuple[str,...]; allowed_classifications:tuple[str,...]
    evidence_quality:float; health:str; benchmark_results:dict[str,float]

class CognitiveResourceRegistry:
    def __init__(self,state:SQLiteState): self.state=state; self._migrate()
    def _migrate(self):
        with self.state.transaction() as db: db.execute("CREATE TABLE IF NOT EXISTS cognitive_resources(identity TEXT PRIMARY KEY,record_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)")
    def register(self,resource:CognitiveResource):
        if resource.health not in {"healthy","degraded","unavailable"} or not 0<=resource.evidence_quality<=1: raise ValueError("invalid resource assurance")
        with self.state.transaction() as db: db.execute("INSERT INTO cognitive_resources VALUES(?,?,1)",(resource.identity,json.dumps(asdict(resource),sort_keys=True)))
    def select(self,*,capability,tenant,classification,max_cost_minor,max_latency_ms,minimum_evidence):
        candidates=[]
        for row in self.state.connection.execute("SELECT record_json FROM cognitive_resources"):
            r=CognitiveResource(**{**json.loads(row[0]),**{k:tuple(json.loads(row[0])[k]) for k in ("capabilities","limitations","modalities","tenant_eligibility","allowed_classifications")}})
            if capability in r.capabilities and tenant in r.tenant_eligibility and classification in r.allowed_classifications and r.cost_minor<=max_cost_minor and r.latency_ms<=max_latency_ms and r.evidence_quality>=minimum_evidence and r.health=="healthy": candidates.append(r)
        if not candidates: raise LookupError("no policy-eligible cognitive resource")
        return sorted(candidates,key=lambda r:(-r.evidence_quality,r.cost_minor,r.latency_ms,r.identity))[0]

MEMORY_CLASSES=("working","episodic","semantic","procedural","organizational","agent","environment","outcome","failure","policy")
@dataclass(frozen=True)
class MemoryRecord:
    record_id:str; memory_class:str; source:str; identity:str; organization_id:str; tenant_id:str; timestamp:str
    truth_class:str; evidence_references:tuple[str,...]; confidence:float; classification:str; retention:str
    permitted_use:tuple[str,...]; version:str; content_hash:str; content:dict[str,Any]

class MemoryFabric:
    def __init__(self,state:SQLiteState): self.state=state; self._migrate()
    def _migrate(self):
        with self.state.transaction() as db: db.execute("CREATE TABLE IF NOT EXISTS intelligence_memory(record_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,tenant_id TEXT NOT NULL,memory_class TEXT NOT NULL,record_json TEXT NOT NULL,content_hash TEXT NOT NULL)")
    def append(self,record:MemoryRecord):
        if record.memory_class not in MEMORY_CLASSES or digest(record.content)!=record.content_hash or not record.evidence_references: raise ValueError("memory requires valid class, content hash, and evidence")
        with self.state.transaction() as db: db.execute("INSERT INTO intelligence_memory VALUES(?,?,?,?,?,?)",(record.record_id,record.organization_id,record.tenant_id,record.memory_class,json.dumps(asdict(record),sort_keys=True),record.content_hash))
    def recall(self,organization_id,tenant_id,memory_class,permitted_use):
        rows=self.state.connection.execute("SELECT record_json FROM intelligence_memory WHERE organization_id=? AND tenant_id=? AND memory_class=?",(organization_id,tenant_id,memory_class))
        return [json.loads(r[0]) for r in rows if permitted_use in json.loads(r[0])["permitted_use"]]

class ActionState(str,Enum): PROPOSED="proposed"; AUTHORIZED="authorized"; EXECUTING="executing"; OBSERVED="observed"; PROVIDER_REPORTED="provider_reported"; RECONCILED="reconciled"; VERIFIED="verified"; BLOCKED="blocked"
@dataclass(frozen=True)
class PlanStep:
    step_id:str; capability:str; dependencies:tuple[str,...]; authority:str; budget_minor:int; deadline:str
    evidence_requirements:tuple[str,...]; alternatives:tuple[str,...]; state:ActionState=ActionState.PROPOSED
@dataclass(frozen=True)
class GovernedPlan:
    plan_id:str; objective_id:str; organization_id:str; tenant_id:str; steps:tuple[PlanStep,...]; version:int; rationale:str

class PlanningEngine:
    def build(self,objective_id,organization_id,tenant_id,steps,rationale):
        ids={s.step_id for s in steps}
        if not organization_id or not tenant_id or any(not set(s.dependencies)<=ids for s in steps): raise ValueError("tenant context and valid dependency graph required")
        return GovernedPlan(str(uuid4()),objective_id,organization_id,tenant_id,tuple(steps),1,rationale)
    def authorize(self,plan,permitted_authorities,budget_limit):
        if sum(s.budget_minor for s in plan.steps)>budget_limit: raise PermissionError("budget authority denied")
        if any(s.authority not in permitted_authorities for s in plan.steps): raise PermissionError("step authority denied")
        return replace(plan,steps=tuple(replace(s,state=ActionState.AUTHORIZED) for s in plan.steps),version=plan.version+1)
    def replan(self,plan,failed_step,reason):
        steps=[]
        for step in plan.steps:
            if step.step_id==failed_step:
                if not step.alternatives: steps.append(replace(step,state=ActionState.BLOCKED))
                else: steps.append(replace(step,capability=step.alternatives[0],state=ActionState.PROPOSED,alternatives=step.alternatives[1:]))
            else: steps.append(step)
        return replace(plan,steps=tuple(steps),version=plan.version+1,rationale=f"{plan.rationale}; replanned: {reason}")

@dataclass(frozen=True)
class BenchmarkResult:
    benchmark_id:str; category:str; task_definition:str; environment:str; allowed_capabilities:tuple[str,...]
    expected_result:dict[str,Any]; actual_result:dict[str,Any]; evidence:tuple[str,...]; score:float
    failure_classification:str|None; reproducibility:dict[str,Any]
class IntelligenceEvaluator:
    def record(self,result:BenchmarkResult):
        if not 0<=result.score<=1 or not result.evidence or not result.reproducibility: raise ValueError("benchmark evidence and reproducibility required")
        return {"result_hash":digest(asdict(result)),"promotion_evidence":result.score>=1 and result.failure_classification is None}
