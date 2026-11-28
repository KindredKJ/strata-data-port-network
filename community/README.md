# SDPN Community — open-source PORT foundation

**Founder and original author:** Kindred Jermaine Cox / Kindred Labs.

This independently distributable `@kindred-labs/sdpn-community` SDK is licensed under
**Apache License 2.0** (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). It gives anyone permission
under that license to use, copy, modify, and commercially distribute **these files**.
No Kindred Labs account, credit card, cloud subscription, registry, DNS domain purchase,
or connection to Project Genesis is required to generate Port IDs or signed names.

**Scope:** `community/src/index.mjs`, `community/src/access.mjs`, tests,
package metadata and this community documentation. This does not automatically
relicense the root repository, historical third-party imports, the private
Superstructure, Portal managed services, or other proprietary SDPN files.

## First-party executable operations

Node.js 22+:

```bash
node --test community/test/*.test.mjs
```

Generate your first independent Port identity and sign a namespace using the
public SDK from a Node ESM application:

```javascript
import {
  createCommunityIdentity, signCommunityNames, communityPortUri,
  resolveCommunityPort
} from './community/src/index.mjs';

const identity = createCommunityIdentity();
const manifest = signCommunityNames(identity, [
  { name: '', targetPort: identity.id },
  { name: 'portal', targetPort: identity.id }
]);
const address = communityPortUri(identity.id, 'portal');
const resolution = resolveCommunityPort(address, manifest);
process.stdout.write(JSON.stringify({
  address, signingPort: identity.id, resolution,
  credentialsStoredRemotely: false
}, null, 2) + '\n');
```

The example uses a real cryptographically generated ephemeral key. For persistent
identity, call `exportPrivateKeyPem()` and protect the resulting PEM in an
**owner-only** secure local vault; use `importCommunityIdentity(pem)` when
recovering it. Never print, commit, or share private keys, and never treat
a signed name as proof of legal personhood or an authorized data session.
The verified PORT record matches the existing PORT/1 on-wire signed-name
schema, so the existing SDPN signed-name resolver can inspect it.

## The free/core line

The `community/src/access.mjs` API returns an explicit classification:
- Port identity and keys, signed names, compatibility, peer discovery,
  permitted sessions, transport protocol, free client implementations,
  and self-hosting are **never subscription requirements**.
- Hosted websites, operator-managed storage and backup, hosted inference,
  business insights, managed fleet operations, paid support, and SLA
  guarantees can be **optional commercial services**.
- Commercial offerings in this SDK have `availability: "planned"` and
  `priceUsdMonthly: null`. There is no billing, customer enrollment,
  activated subscription, or payment execution in this release.
- Internet access is not magically free: hardware, power, bandwidth and
  third-party ISPs may still charge money.

## Interoperability, governance and founder IP

Users can export/import their keys, self-host a compatible implementation,
and change providers without surrendering a Port identity. Anyone may
maintain compatible forks according to Apache-2.0. Open-source licensing
does not transfer Kindred Labs' trademarks, legal entity ownership, domain
registrations, or founder identity. It also does not prohibit competing
commercial implementations; compete through high-quality products and
reliable hosting, not locked identity or access.

Community development can accept external patches only with documented
authorship, license compatibility, review and security checks. No
contributor copyright is claimed by the original founder merely because
a patch is proposed.
