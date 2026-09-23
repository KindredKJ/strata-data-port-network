#!/usr/bin/env python3
"""Fail-closed policy validation for production configuration documents."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


PROHIBITED = re.compile(r"(?:^|[-_])(mock|fake|dummy|simulation|simulated|placeholder|always[-_]success|test[-_]only|in[-_]memory)(?:$|[-_])", re.I)
REQUIRED = {
    "fail_closed": True,
    "development_signatures_allowed": False,
    "provider_credentials_required": True,
}


def violations(document: object, path: str = "$") -> list[str]:
    """Return deterministic violations without echoing configured secret values."""
    findings: list[str] = []
    if isinstance(document, dict):
        for key, value in document.items():
            child = f"{path}.{key}"
            if PROHIBITED.search(key) or (isinstance(value, str) and PROHIBITED.search(value)):
                findings.append(f"{child}: prohibited production adapter or behavior")
            findings.extend(violations(value, child))
    elif isinstance(document, list):
        for index, value in enumerate(document):
            findings.extend(violations(value, f"{path}[{index}]"))
    return findings


def validate_file(path: Path) -> list[str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{path}: unreadable production configuration ({type(exc).__name__})"]
    findings = violations(payload)
    if payload.get("environment") != "production":
        findings.append("$.environment: must equal production")
    for key, expected in REQUIRED.items():
        if payload.get(key) is not expected:
            findings.append(f"$.{key}: must equal {expected!r}")
    persistence = payload.get("persistence", {})
    if persistence.get("required") is not True:
        findings.append("$.persistence.required: must equal True")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()
    failed = False
    for path in args.paths:
        findings = validate_file(path)
        for finding in findings:
            print(f"ERROR {path}: {finding}")
        failed |= bool(findings)
    if not failed:
        print(f"production configuration policy passed ({len(args.paths)} file(s))")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
