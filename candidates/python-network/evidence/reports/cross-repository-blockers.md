# Cross-repository blockers

All permitted local mechanisms were checked: Git remotes, mounted workspaces,
GitHub CLI, token variable presence, SSH agent, authenticated `/user`, public
REST, and the metadata-only PR tool. Only this local worktree and unauthenticated
public metadata are available.

| Authority | Exact blocker | Independent continuation |
|---|---|---|
| Emit Core | `KINDRED_EMIT_CORE` not visible without authenticated access | contract and `emit_core_authority_not_connected` retained |
| G3T Connected | repository unresolved; no endpoint, mTLS identity, rail contract | provider-of-record interface and controlled blocker retained |
| RetroBank / A2A | repositories unresolved; no regulated rail authority | durable ledger/conformance foundations remain local |
| KINDRED-WATT | repository not visible; Windows runners unavailable | baseline pin retained; P1 and repository-backed proof blocked |
| Brainstem InTouch | repository not visible | orchestration/transport authority separation retained |
| IAMI / IAMI-X / Cloud | repositories not visible | identity/network authority remains unresolved |
| BRAINSTEM | public read only; no authenticated write/branch permission | AOI interfaces implemented locally for later authority migration |

No duplicate repository was created, no branch was pushed, and no remote PR or
external effect is claimed.
