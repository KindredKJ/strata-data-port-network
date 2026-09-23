# Partner quick start

Provision an organization, isolated tenant, environment, project, and entitlement;
configure opaque managed identity and mTLS references; construct `PartnerContext`;
use `PortZeroClient.create_envelope`; then submit through the production Port Zero
interface. Missing entitlements or credentials fail closed. This checkout has no
connected provider, so the reference deployment must report blocked.
