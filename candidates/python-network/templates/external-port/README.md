# Founder-authorized external Strata Data Port template

This template is inactive by default. Activation requires founder-authorized
stratum authority, verified repository ownership, core conformance, mTLS service
and port identities, destination connectivity, Emit Core reconciliation,
production authorization, and evidence.

Implementations must consume the shared `ProductionEnvelope`, `PortDirectory`,
`ExternalExecutionPort`, `SignedPortReceipt`, authenticated dispatcher,
lifecycle, dead-letter, tenant, and evidence interfaces. They must declare
capabilities, classifications, disclosure, route modes, retry/circuit policy,
recovery ownership, threat model, conformance results, and runbook. A registry
entry alone never activates a port.
