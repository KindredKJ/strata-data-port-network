// Kindred Labs SDPN: Port 0 alone has founder authority; all other roles are port-local.
import { canonicalBytes, exactFields, verifyEnvelope } from './native-port-identity.mjs';
import { verifyNumberedRegistry } from './numbered-port-registry.mjs';

export const LOCAL_PORT_ROLE_SCHEMA = 'kindred.sdpn.port-local-role.v1';
const REGULAR = Object.freeze(['presence.publish', 'state.read', 'session.request']);
const ADMIN = Object.freeze([...REGULAR, 'state.write', 'adapter.configure',
  'worker.configure', 'local.policy.manage']);
const ACTIONS = Object.freeze({ regular: REGULAR, admin: ADMIN });

function assertTime(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Port-local grant time rejected');
}
function targetRegistration(events, founderId, number, identityId) {
  const view = verifyNumberedRegistry(events, founderId);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error('Port 0 is founder-exclusive; no port-local role allowed');
  }
  const entry = view.registrations.find(item => item.number === number && item.active);
  if (!entry || entry.portId !== identityId) throw new Error('Port-local role is not bound to active assigned port');
  return entry;
}

// Local role credentials are self-authorized by the device's own private key.
// They never authorize other ports or founder/registry operations.
export function signPortLocalRole(identity, events, expectedFounderId, number, role,
  { now = Date.now(), ttlMs = 60_000 } = {}) {
  assertTime(now);
  if (!Object.hasOwn(ACTIONS, role)) throw new Error('Port-local role must be regular or admin');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300_000 ||
      now + ttlMs > Number.MAX_SAFE_INTEGER) throw new Error('Port-local role lifetime rejected');
  const entry = targetRegistration(events, expectedFounderId, number, identity?.id);
  if (identity.publicKey !== entry.publicKey || typeof identity.sign !== 'function') {
    throw new Error('Port-local signer identity mismatch');
  }
  const body = { schema: LOCAL_PORT_ROLE_SCHEMA, role, number, portId: identity.id,
    issuerPort: identity.id, issuedAt: now, expiresAt: now + ttlMs };
  const grant = identity.sign(body);
  verifyPortLocalRole(grant, events, expectedFounderId, now);
  return grant;
}

export function verifyPortLocalRole(grant, events, expectedFounderId, now = Date.now()) {
  assertTime(now);
  const body = grant?.body;
  exactFields(body, ['schema', 'role', 'number', 'portId', 'issuerPort', 'issuedAt', 'expiresAt']);
  if (body.schema !== LOCAL_PORT_ROLE_SCHEMA || !Object.hasOwn(ACTIONS, body.role) ||
      body.portId !== body.issuerPort || !Number.isSafeInteger(body.issuedAt) ||
      !Number.isSafeInteger(body.expiresAt) || body.issuedAt > now || body.expiresAt <= now ||
      body.expiresAt - body.issuedAt > 300_000) throw new Error('Port-local role grant invalid/expired');
  const entry = targetRegistration(events, expectedFounderId, body.number, body.portId);
  verifyEnvelope(grant, entry.portId, entry.publicKey);
  return Object.freeze({ role: body.role, portNumber: body.number, portId: body.portId,
    permissions: ACTIONS[body.role], expiresAt: body.expiresAt, founderAuthority: false,
    crossPortAuthority: false });
}

export function authorizePortLocalAction(grant, events, expectedFounderId, {
  targetNumber, action, now = Date.now()
}) {
  const role = verifyPortLocalRole(grant, events, expectedFounderId, now);
  if (targetNumber !== role.portNumber ||
      typeof action !== 'string' || !role.permissions.includes(action)) {
    throw new Error('Port-local authorization denied: no founder or cross-port authority');
  }
  // Local roles are not a replacement for OS permissions or native session policy.
  return Object.freeze({ authorized: true, role: role.role,
    portNumber: role.portNumber, action, founderAuthority: false,
    remoteAuthorizationGranted: false });
}
