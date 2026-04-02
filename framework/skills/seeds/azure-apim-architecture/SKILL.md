---
name: "Azure APIM Architecture"
description: "Architecture patterns for Azure API Management — VNet modes, Front Door, authentication, multi-environment strategy"
domain: "integration"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-04-02"
reviewByDate: "2026-10-02"
triggers:
  - "apim"
  - "api management"
  - "front door"
  - "vnet internal"
  - "api gateway"
  - "api marketplace"
  - "developer portal"
  - "api center"
roles:
  - "architect"
  - "developer"
  - "devops-engineer"
---

## Context
Apply when designing Azure API Management solutions. Covers VNet mode selection,
ingress layer choice, multi-environment strategy, authentication patterns, and API Center governance.

## Patterns

**VNet Internal mode for production (not External):**
Maximum security — no public IP exposure. Gateway endpoints accessible only within VNet
via internal load balancer. All external access routes through Front Door via Private Link.
Network flow: Internet -> Front Door (WAF, DDoS) -> Private Link -> APIM Internal -> Backends.

**Azure Front Door Premium as ingress (not Application Gateway):**
Built-in platform DDoS protection (saves separate Azure DDoS Standard cost).
Private Link support for secure backend connectivity. Global multi-POP network.
WAF with managed OWASP rulesets included. Optimized for API HTTP/HTTPS routing.

**Separate APIM instances per environment (not workspaces):**
Use Developer tier for dev/test (low cost), Premium tier for prod (zone-redundant).
Workspaces provide logical isolation only — no compute, network, or secret isolation.
Reserve workspaces for team-level separation within a single environment.

**Hybrid authentication — OAuth + subscription keys:**
| API Type | Auth Method | Rate Limit |
|----------|-------------|------------|
| Public read-only | Subscription keys | 500 req/hour per subscription |
| Internal corporate | OAuth 2.0 (Entra ID) | 10,000 req/hour per user |
| Sensitive public | OAuth 2.0 (Entra External ID) | 1,000 req/hour per user |
| Partner B2B | OAuth 2.0 client credentials | Per-agreement |

**API Center for governance (50+ APIs):**
Centralized inventory across dev/test/prod instances. Breaking change detection,
API linting, version tracking, compliance checking. Justified when managing multiple
APIM instances and multiple teams.

**Zone redundancy for production APIM:**
Premium SKU with 3 units across 3 availability zones for 99.99% SLA.
```bicep
sku: { name: 'Premium', capacity: 3 }
zones: ['1', '2', '3']
```

## Examples

```
Environment Strategy:

Development:  Developer tier, 1 unit, VNet Internal, no Front Door
Test:         Developer tier, 1 unit, VNet Internal, no Front Door
Production:   Premium tier, 3 units zone-redundant, VNet Internal, Front Door + Private Link
```

## Anti-Patterns

- **VNet External for production** — exposes gateway to public internet, larger attack surface
- **Application Gateway when Front Door suffices** — Front Door includes DDoS and is API-optimized
- **Workspaces for environment separation** — no compute or secret isolation between workspaces
- **OAuth everywhere** — simple public read-only APIs don't need complex OAuth flows
- **Wildcard CORS with credentials** — security risk, always use specific origins in production
- **Hardcoded secrets in policies** — use Key Vault named values for all secrets
