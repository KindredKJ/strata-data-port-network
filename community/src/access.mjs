// Copyright 2026 Kindred Jermaine Cox and Kindred Labs.
// SPDX-License-Identifier: Apache-2.0
// Free protocol capabilities never require a Kindred subscription. Distinguish
// functions available in this SDK from free functions planned for later releases.
export const COMMUNITY_CAPABILITIES = Object.freeze([
  'identity.generate', 'identity.import', 'identity.export',
  'port.alias.sign', 'port.alias.verify', 'port.alias.resolve',
]);
export const PLANNED_FREE_CAPABILITIES = Object.freeze([
  'port.peer.discover', 'port.session.establish', 'port.data.transfer',
  'port.community.client', 'port.self_host',
]);
const implemented = new Set(COMMUNITY_CAPABILITIES);
const plannedFree = new Set(PLANNED_FREE_CAPABILITIES);
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
    description: 'Optional multiuser teams, paid business services, verified business profiles and usage insights.',
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
        description: 'Create and control Port identities and signed names today. Further independently hosted network modules will also be free when implemented.',
        capabilities: [...COMMUNITY_CAPABILITIES],
        plannedFreeCapabilities: [...PLANNED_FREE_CAPABILITIES],
        limitations: 'Internet access, hardware, electricity and outside ISP fees are not supplied for free.',
      },
      ...managedServices.map(item => ({
        ...item, services: [...item.services],
      })),
    ],
  };
}

export function capabilityIsFree(capability) {
  return typeof capability === 'string' &&
    (implemented.has(capability) || plannedFree.has(capability));
}
export function evaluateAccess(capability) {
  if (implemented.has(capability)) {
    return Object.freeze({
      capability, allowed: true, basis: 'free-open-protocol',
      subscriptionRequired: false, paymentRequired: false,
    });
  }
  if (plannedFree.has(capability)) {
    return Object.freeze({
      capability, allowed: false, basis: 'planned-free-protocol',
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
