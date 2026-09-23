#!/usr/bin/env python3
"""Generate deterministic JSON Schemas and dependency-free Python bindings."""
from __future__ import annotations
import argparse, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = ["NeedEnvelope", "OutcomeContract", "CapabilityManifest", "ClaimRecord",
         "CognitiveTransaction", "ExecutionIntent", "EvidenceReceipt", "OutcomeCapsule",
         "EvolutionProposal", "KJManifest", "WorldContext"]
COMMON = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "required": ["schema_version", "id", "truth_class", "issued_at", "data"],
    "properties": {
        "schema_version": {"const": "1.0.0"},
        "id": {"type": "string", "minLength": 1},
        "truth_class": {"enum": ["simulated", "estimated", "observed", "provider-reported", "verified"]},
        "issued_at": {"type": "string", "format": "date-time"},
        "data": {"type": "object"},
        "evidence_references": {"type": "array", "items": {"type": "string"}, "uniqueItems": True},
    },
}

def outputs() -> dict[Path, str]:
    result = {}
    for name in NAMES:
        schema = {**COMMON, "$id": f"https://contracts.kindred.invalid/v1/{name}.schema.json", "title": name}
        result[ROOT / "contracts" / "v1" / f"{name}.schema.json"] = json.dumps(schema, indent=2, sort_keys=True) + "\n"
    binding = '"""Generated contract models. Do not edit manually."""\nfrom dataclasses import dataclass, field\nfrom typing import Any\n\n'
    for name in NAMES:
        binding += f'@dataclass(frozen=True)\nclass {name}:\n    id: str\n    issued_at: str\n    data: dict[str, Any]\n    truth_class: str\n    schema_version: str = "1.0.0"\n    evidence_references: tuple[str, ...] = field(default_factory=tuple)\n\n'
    result[ROOT / "src" / "kindred_superstructure" / "contracts.py"] = binding.rstrip() + "\n"
    return result

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--check", action="store_true"); args = parser.parse_args()
    stale = []
    for path, content in outputs().items():
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content: stale.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True); path.write_text(content, encoding="utf-8")
    if stale: print("stale generated contracts: " + ", ".join(stale)); return 1
    return 0
if __name__ == "__main__": raise SystemExit(main())
