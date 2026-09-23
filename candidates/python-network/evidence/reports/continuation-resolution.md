# Continuation resolution

## Scope and provenance

The local `work` branch at inherited commit `f57dbca` contains the July 28 governed-world implementation. The repository has no configured remote, so no claim is made that this commit is an open GitHub pull request or that it descends from live remote `main`. Inspection used `git log`, `git show --stat`, the working tree, and the public unauthenticated GitHub API.

| Classification | Inherited area | Resolution |
|---|---|---|
| KEEP | Canonical sequence and protected-boundary registries | They encode the founder-specified ordering and placement and remain useful machine-readable policy. |
| KEEP | Versioned contract artifacts and deterministic generator | Retained as E1 artifacts pending authority-repository resolution and compatibility validation. |
| KEEP | Evidence bundle/checksum tooling | Retained as local evidence tooling; it must not imply external or production validation. |
| REPLACE | Runtime, ports, transport, and inherited domain simulations | Product simulation handlers and the product-side test runtime were removed. Deterministic fixtures now live only under `tests/fixtures`; production composition accepts only durable state, managed signing, authenticated transport, real external-port adapters, and authenticated identities. |
| HARDEN | CI | Windows jobs are definitions, not observed passing Windows results. Actions and security policy need further verification. |
| REPLACE | Earlier inventory and authority-resolution assertions | Replaced by observation-sourced registries that distinguish local, public unauthenticated, founder-provided, and blocked data. Invented repository authority is not accepted as discovered fact. |
| REMOVE | Production claims and routes based on simulated communications, economy, or WATT outcomes | Product domain simulation code and its runtime entrypoint were deleted. Test fixtures are not product functionality and cannot be selected by production configuration. |
| BLOCKED | KINDRED-WATT PowerShell P1 repair | Repository content and Windows PowerShell 5.1/7 runners are not accessible from this worktree. The known baseline remains unverified here. |
| BLOCKED | Prior PR inspection and remote-main ancestry | No remote, GitHub CLI, token, authenticated connector, or SSH agent is available. |

No inherited source or evidence was deleted. Replacement applies to inaccurate registry semantics, not historical Git objects.
