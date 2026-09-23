#!/usr/bin/env python3
"""Local-only bootstrap, validation, lock generation, and evidence verification."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQUIRED_DIRS = ("architecture", "registry", "contracts", "integration", "governance", "evidence", "scripts", "templates")


def git(*args: str, cwd: Path = ROOT, check: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or "git command failed")
    return result.stdout.strip()


def repository_record(path: Path) -> dict[str, object]:
    path = path.resolve()
    return {
        "path": str(path),
        "commit": git("rev-parse", "HEAD", cwd=path),
        "branch": git("branch", "--show-current", cwd=path) or "DETACHED",
        "dirty": bool(git("status", "--porcelain", cwd=path)),
        "remote": git("remote", "get-url", "origin", cwd=path, check=False) or None,
    }


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def bootstrap(_: argparse.Namespace) -> int:
    missing = [name for name in REQUIRED_DIRS if not (ROOT / name).is_dir()]
    if missing:
        print("missing required directories: " + ", ".join(missing), file=sys.stderr)
        return 1
    for path in (ROOT / "evidence" / "runs", ROOT / "artifacts" / "local"):
        path.mkdir(parents=True, exist_ok=True)
    print(f"local bootstrap ready: {ROOT}")
    return 0


def update_lock(args: argparse.Namespace) -> int:
    paths = [Path(value) for value in args.repo] if args.repo else [ROOT]
    records = []
    for path in paths:
        if not (path / ".git").exists() and not git("rev-parse", "--is-inside-work-tree", cwd=path, check=False):
            print(f"not a Git worktree: {path}", file=sys.stderr)
            return 2
        records.append(repository_record(path))
    output = Path(args.output)
    write_json(output, {"schema_version": "1.0.0", "generated_at": datetime.now(timezone.utc).isoformat(), "repositories": records})
    print(output)
    return 0


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_bundle(command: str, exit_code: int, skipped: bool, limitation: list[str]) -> Path:
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-{os.getpid()}"
    run = ROOT / "evidence" / "runs" / run_id
    for child in ("test-results", "logs", "receipts", "reconciliation", "lifecycle", "dead-letters", "contracts", "architecture"):
        (run / child).mkdir(parents=True, exist_ok=True)
    repo = repository_record(ROOT)
    write_json(run / "repositories.json", [repo])
    write_json(run / "commits.json", {"repository": repo["commit"]})
    environment = {"operating_system": platform.platform(), "python": platform.python_version()}
    write_json(run / "environment.json", environment)
    write_json(run / "topology.json", {"source": "architecture/port-topology.yaml", "truth": "artifact-present"})
    write_json(run / "authorities.json", {"source": "architecture/authority-map.yaml", "truth": "artifact-present"})
    write_json(run / "ports.json", {"source": "registry/ports.yaml", "connected_ports": [], "blocked_dependencies": True})
    write_json(run / "routes.json", {"executed": [], "note": "no authorized external route executed"})
    write_json(run / "transactions.json", {"organization": None, "tenant": None, "transactions": [], "truth": "no external transaction claimed"})
    (run / "logs" / "validation.txt").write_text(f"command={command}\nexit_code={exit_code}\n", encoding="utf-8")
    generated = [str(p.relative_to(run)) for p in sorted(run.rglob("*")) if p.is_file()]
    manifest = {
        "schema_version": "1.0.0", "run_id": run_id, "repository": str(ROOT),
        "branch": repo["branch"], "commit": repo["commit"], "dirty": repo["dirty"],
        "environment": environment, "tests": [{"command": command, "exit_code": exit_code, "skipped": skipped}],
        "generated_files": generated, "truth_classification": "observed", "validation_level": "artifact present" if skipped else "locally executed",
        "limitations": limitation,
    }
    write_json(run / "manifest.json", manifest)
    (run / "summary.md").write_text(f"# Validation {run_id}\n\nResult: {'PASS' if exit_code == 0 else 'FAIL'}\n\nValidation is local-only; no production or independent validation is claimed.\n", encoding="utf-8")
    lines = [f"{checksum(p)}  {p.relative_to(run).as_posix()}" for p in sorted(run.rglob("*")) if p.is_file() and p.name != "checksums.sha256"]
    (run / "checksums.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return run


def validate(args: argparse.Namespace) -> int:
    missing = [name for name in REQUIRED_DIRS if not (ROOT / name).is_dir()]
    if missing:
        code, command, skipped = 1, "structure validation", False
    elif args.no_tests:
        code, command, skipped = 0, "python tests skipped by --no-tests", True
    else:
        command = f"{sys.executable} -m unittest discover -s tests -p test_*.py"
        environment = os.environ.copy()
        source_path = str(ROOT / "src")
        environment["PYTHONPATH"] = source_path + os.pathsep + environment.get("PYTHONPATH", "")
        code = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
            cwd=ROOT,
            env=environment,
        ).returncode
        skipped = False
    limitations = ["Local Linux execution only; Windows and external providers were not validated."]
    if skipped:
        limitations.append("Test execution was explicitly skipped.")
    run = make_bundle(command, code, skipped, limitations)
    print(run)
    return code


def verify(args: argparse.Namespace) -> int:
    run = Path(args.run).resolve()
    required = ("manifest.json", "repositories.json", "commits.json", "environment.json", "checksums.sha256", "summary.md")
    missing = [name for name in required if not (run / name).is_file()]
    errors = [f"missing {name}" for name in missing]
    if not errors:
        manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8"))
        for key in ("schema_version", "run_id", "repository", "commit", "tests", "truth_classification", "validation_level", "limitations"):
            if key not in manifest:
                errors.append(f"manifest missing {key}")
        for line in (run / "checksums.sha256").read_text(encoding="utf-8").splitlines():
            expected, relative = line.split("  ", 1)
            target = (run / relative).resolve()
            if run not in target.parents or not target.is_file() or checksum(target) != expected:
                errors.append(f"checksum mismatch: {relative}")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"verified local evidence bundle: {run}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    subs = parser.add_subparsers(dest="command", required=True)
    subs.add_parser("bootstrap").set_defaults(func=bootstrap)
    validate_parser = subs.add_parser("validate"); validate_parser.add_argument("--no-tests", action="store_true"); validate_parser.set_defaults(func=validate)
    lock_parser = subs.add_parser("update-lock"); lock_parser.add_argument("--repo", action="append", default=[]); lock_parser.add_argument("--output", required=True); lock_parser.set_defaults(func=update_lock)
    verify_parser = subs.add_parser("verify"); verify_parser.add_argument("run"); verify_parser.set_defaults(func=verify)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
