# API contract surface

Production partner requests require `B2BContext.schema.json`, including
organization, tenant, partner, environment, project, entitlement, delegated
authority, provider-of-record, metering, brand, evidence-owner, and disclosure
context. Communications produce append-only
`CommunicationLifecycleEvent.schema.json` records.

SDKs must not collapse the seven communications status dimensions into a single
status property or infer recipient delivery from rail acceptance.
