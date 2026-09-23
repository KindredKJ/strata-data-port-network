#!/usr/bin/env python3
"""Reject test fixtures and synthetic effect handlers in production modules."""
from __future__ import annotations
import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = ROOT / "src" / "kindred_superstructure"
FORBIDDEN_FILES = {"domains.py", "simulations.py", "mocks.py", "fakes.py"}
FORBIDDEN_FUNCTIONS = {"for_test", "always_success", "simulate_delivery", "simulate_settlement", "simulate_actuation"}

def audit() -> list[str]:
    findings: list[str] = []
    for path in sorted(PRODUCT.glob("*.py")):
        if path.name in FORBIDDEN_FILES:
            findings.append(f"{path.relative_to(ROOT)}: prohibited production effect module")
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in FORBIDDEN_FUNCTIONS:
                findings.append(f"{path.relative_to(ROOT)}:{node.lineno}: prohibited product fixture entrypoint {node.name}")
            if isinstance(node, ast.ImportFrom) and node.module and (node.module == "tests" or node.module.startswith("tests.")):
                findings.append(f"{path.relative_to(ROOT)}:{node.lineno}: product imports test fixture")
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "tests" or alias.name.startswith("tests."):
                        findings.append(f"{path.relative_to(ROOT)}:{node.lineno}: product imports test fixture")
    return findings

def main() -> int:
    findings = audit()
    if findings:
        print("\n".join(f"ERROR {item}" for item in findings), file=sys.stderr)
        return 1
    print("production route audit passed: no product fixture or synthetic effect modules")
    return 0

if __name__ == "__main__": raise SystemExit(main())
