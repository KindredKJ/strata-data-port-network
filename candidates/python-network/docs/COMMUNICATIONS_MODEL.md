# G3T Connected communications model

G3T Connected is the communications provider of record. It owns identity and
tenant enforcement, policy, channel selection, lifecycle, attempts, routing,
acknowledgements, escalation, recovery, reconciliation, and evidence. Carriers,
email/SMS/voice/push networks, and gateways are subordinate rails.

The canonical API input uses `B2BContext`; the append-only output is a
`CommunicationLifecycleEvent`. Seven status dimensions remain independent:
request, G3T provider, transport rail, recipient, reconciliation, evidence, and
truth. Payload bodies and credentials are never stored in lifecycle events.
