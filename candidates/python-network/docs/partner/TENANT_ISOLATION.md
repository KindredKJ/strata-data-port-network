# Tenant isolation

Every SDK request binds organization, tenant, partner, environment, project, and
entitlement. Authorization and audit queries use organization+tenant scope.
Per-tenant identity/key references, disclosure, retention, metering, and policy
must be configured before activation. Cross-tenant requests fail closed.
