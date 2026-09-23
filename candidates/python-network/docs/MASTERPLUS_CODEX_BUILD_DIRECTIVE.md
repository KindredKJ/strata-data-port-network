# MASTER+ directive — superseded

This document previously contained an execution directive that authorized
synthetic product-operation instructions. The authoritative production-build correction
supersedes those instructions. The prior text remains recoverable from Git
history for evidence and provenance, but is intentionally not retained as an
active instruction surface.

Current execution requirements are encoded in:

- `AGENTS.md`;
- `config/production-policy.json`;
- `architecture/canonical-sequence.yaml`;
- `architecture/protected-boundary.yaml`;
- `evidence/reports/production-simulation-audit.md`.

Production dependencies must use real, authorized adapters or fail closed with
an exact blocker. Test fixtures are not product functionality.
