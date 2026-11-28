# Global competitive intelligence and execution priorities — 2026-11-25
Founder: Kindred Jermaine Cox. Kindred Labs / SDPN.

## Objective
Become the default voluntary discovery, business and economic infrastructure for humans and independent agents. Learn from competing deployments and open standards; develop original SDPN implementations and preserve third-party licensing. Preserve the approved landing hero and existing PORTAL isolation. Do not claim first-mover status or superiority without evidence.

## Evidence and responses
| Development | Primary source | SDPN response |
|---|---|---|
| Cloudflare agent search, Nov 25 | https://blog.cloudflare.com/search-for-agents | Signed service/site discovery, machine-readable search, opt-in indexing |
| OpenAI business agents, international eligibility Nov 19 | https://openai.com/index/introducing-businesses-chatgpt/ | Portable agent businesses, profiles and service catalogs |
| Microsoft Agent 365 cross-platform identity | https://techcommunity.microsoft.com/blog/agent-365-blog/whats-new-in-microsoft-agent-365-ignite-2026/4571753 | Community Port identity plus scoped authorization; runtime adapters |
| AWS Agent Registry GA, Aug 31 | https://aws.amazon.com/about-aws/whats-new/2026/08/aws-agent-registry-generally-available/ | Independent discoverability beyond a single cloud |
| AAIF open projects, Oct 22 | https://www.linuxfoundation.org/press/agentic-ai-foundation-announces-four-new-projects-agent-skills-open-responses-openenv-and-opensandbox | MCP/A2A/Skills adapters and standard conformance |
| Google commerce and AP2 | https://blog.google/products/ads-commerce/agentic-commerce-ai-tools-protocol-retailers-platforms/ | Merchant catalog, quote and authorized payment adapters |
| Stripe MPP | https://stripe.com/blog/machine-payments-protocol | Metered resource/service commerce |
| x402 Foundation | https://www.linuxfoundation.org/press/linux-foundation-announces-operational-launch-of-x402-foundation-to-standardize-internet-native-payments-for-ai-agents-and-applications | Optional internet-native payments |
| Amazon Ads Agent | https://advertising.amazon.com/library/news/amazon-ads-agent | Signed offers, labeled sponsored discovery, attribution and anti-fraud |
| YouTube creator tools | https://blog.youtube/news-and-events/innovation-youtube-era-made-on-viewers-creators/ | StrataCast agent/human publishing, provenance and monetization |
| Alibaba agent-native cloud | https://www.sec.gov/Archives/edgar/data/1577552/000110465926130115/tm2630263d1_ex99-1.htm | Compute/service discovery, portable deployment |
| Baidu Token Exchange | https://www1.hkexnews.hk/listedco/listconews/sehk/2026/1116/2026111600626.pdf | Compute provider marketplace; do not conflate compute tokens and securities |
| Mistral sovereign compute | https://mistral.ai/news/regional-inference-open-models-new-compute/ | Local execution, regional hosting, model choice |
| DTCC tokenization | https://www.dtcc.com/press-releases/2026/dtcc-tokenization-service-goes-live | Market interoperability; verify participant eligibility |
| SEC conditional tokenized NMS exemption | https://www.sec.gov/newsroom/press-releases/2026-90-sec-issues-innovation-exemption-facilitate-trading-tokenized-nms-stock-request-comment | Counsel evaluation of eligibility and conditions, not assumed authorization |

## Original synthesis: proposed SDPN Economic Loop
Identity → publish → discover → contact/quote → authorized agreement/payment → delivery → verifiable receipt → repeat. Each service inherits the existing portable identity and shared discovery, with explicit scope and consent for economic actions. Use native PORT identities, transport, optional UMR semantics, and verifiable computation where proven. A2A/MCP are adapters, not replacement identities. No exclusive dependency, manufactured traffic, or self-dealing revenue.

## Tonight's release priorities
P0: recover original homepage assets and route Explore the network to genuinely functioning discovery without changing the approved hero. Verify existing public site and transport behavior.
P0: signed offers plus persistent revision high-water marks, withdrawal, issuer quota, and tests; new DurableOfferIndex is a SQLite single-store increment, not a public multi-tenant service.
P0: isolated public-facing read API and authorized publishing, abuse handling, quotas, persistence, monitoring and distinct-client smoke test. Never publicly expose local PORTAL or model endpoint.
P1: publish/install SDK and CLI with identity, discovery and signed-offer quickstart; add MCP tool adapter and A2A card compatibility, verify against external client.
P1: first honest provider offer and real user onboarding. Start managed hosting or service revenue only when actual fulfillment and billing are available.
Parallel: Markets discovery and paper trading, counsel/market access, StrataCast channels, business sites, compute and storage. Regulated execution separate from core launch.

## Evidence and limitations
PR #62 initial head eeeae0d14bf259a0d84f212983d5717186a3236d: Vercel preview reported ready; five PR workflows reported failure. Sample job step list was empty and logs returned 404. Failure cause not established. Do not equate preview readiness with tests or operational service. Obtain passing fresh CI or independently reproduce on a clean checkout, then recheck deployable scope. Persistent offer implementation and tests were committed separately; no pass or deployment asserted. SQLite requires a persistent volume and single-region design or a compatible shared database strategy for scale. Capacity includes withdrawn/expired high-water records; quota policy and archival design remain needed before unrestricted public publishing.
