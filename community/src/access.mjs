// Copyright 2026 Kindred Jermaine Cox and Kindred Labs.
// SPDX-License-Identifier: Apache-2.0
// Free network primitives are never subscription-gated. Managed services must
// verify their own actual entitlements; this catalog does not accept payments.
export const COMMUNITY_CAPABILITIES = Object.freeze([
  'identity.generate', 'identity.import', 'identity.export',
  'port.alias.sign', 'port.alias.verify', 'port.alias.resolve',
  'port.peer.discover', 'port.session.establish', 'port.data.transfer',
  'port.community.client', 'port.self_host',
]);

const communitySet = new Set(COMMUNITY_CAPABILITIES);
const managedServices = Object.freeze([
  Object.freeze({
    id: 'creator',
    label: 'Portal Creator',
    availability: 'planned',
    priceUsdMonthly: null,
    description: 'Optional managed sites, professional templates, domain connection, backups and hosted AI quotas.',
    services: Object.freeze(['hosting.managed', 'backup.managed', 'ai.hosted']),
  }),
  Object.freeze({
    id: 'business',
    label: 'Portal Business',
    availability: 'planned',
    priceUsdMonthly: null,
    description: 'Optional multiuser teams, paid business services, verified business profile and usage insights.',
    services: Object.freeze(['team.managed', 'business.analytics', 'business.verification']),
  }),
  Object.freeze({
    id: 'enterprise',
    label: 'SDPN Enterprise',
    availability: 'planned',
    priceUsdMonthly: null,
    description: 'Optional managed SLA, dedicated deployment, support, compliance features and governed capacity.',
    services: Object.freeze(['sla.managed', 'fleet.managed', 'support.dedicated']),
  }),
]);

export function communityCatalog() {
  return {
    schema: 'kindred.sdpn.community-catalog.v1',
    currency: 'USD',
    acceptsPayments: false,
    plans: [
      {
        id: 'community', label: 'SDPN Community', priceUsdMonthly: 0,
        availability: 'open-source-software',
        description: 'Create and control Port identities and names; run compatible clients; communicate over your own authorized network.',
        capabilities: [...COMMUNITY_CAPABILITIES],
        limitations: 'Network hardware, electricity, mobile access or an outside ISP are not supplied at no cost.',
      },
      ...managedServices.map(item => ({
        ...item, services: [...item.services],
      })),
    ],
  };
}

export function capabilityIsFree(capability) {
  return typeof capability === 'string' && communitySet.has(capability);
}
export function evaluateAccess(capability) {
  if (capabilityIsFree(capability)) {
    return Object.freeze({
      capability, allowed: true, basis: 'free-open-protocol',
      subscriptionRequired: false, paymentRequired: false,
    });
  }
  const offering = managedServices.find(plan => plan.services.includes(capability));
  if (offering) {
    return Object.freeze({
      capability, allowed: false, basis: 'service-not-deployed',
      subscriptionRequired: false, paymentRequired: false,
      servicePlan: offering.id,
    });
  }
  return Object.freeze({
    capability, allowed: false, basis: 'unknown-capability',
    subscriptionRequired: false, paymentRequired: false,
  });
}
