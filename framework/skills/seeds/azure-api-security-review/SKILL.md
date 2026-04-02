---
name: "Azure API Security Review"
description: "Security review for Azure APIM — OWASP API Top 10, Azure Security Benchmark, VNet validation, Private Link verification"
domain: "security"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-04-02"
reviewByDate: "2026-10-02"
triggers:
  - "apim security"
  - "api security"
  - "azure security benchmark"
  - "owasp api"
  - "vnet security"
  - "private link"
  - "security review"
  - "zero trust"
roles:
  - "reviewer"
  - "architect"
---

## Context
Apply when performing security audits of Azure API Management configurations, pre-deployment
validation, or compliance reviews against OWASP API Security Top 10 and Azure Security Benchmark.

## Patterns

**OWASP API Security Top 10 — APIM mitigations:**
| Threat | APIM Mitigation |
|--------|-----------------|
| API1 Broken Object Level Auth | validate-jwt + check user claims for resource ownership |
| API2 Broken Authentication | OAuth 2.0 (validate-jwt), no plaintext credentials |
| API3 Broken Property Level Auth | Validate input/output schemas, mask sensitive fields |
| API4 Unrestricted Resource Consumption | rate-limit-by-key per user/subscription |
| API5 Broken Function Level Auth | Validate JWT scopes/roles per operation |
| API7 SSRF | VNet Internal mode, Private Link to backends |
| API8 Security Misconfiguration | TLS 1.2+, disable weak ciphers, NSG rules |
| API9 Improper Inventory | API Center for version tracking and deprecation |
| API10 Unsafe Consumption | Validate backend responses, timeout policies |

**Critical validations:**

1. VNet Internal Mode — all production APIM must use `virtualNetworkType: 'Internal'`
2. Private Link — Front Door origin must be Private Link (not public), status Approved
3. TLS 1.2+ only — TLS 1.0, 1.1, SSL 3.0 must be disabled in APIM custom properties
4. Managed Identity — system-assigned identity for Key Vault and backend access
5. No hardcoded secrets — all secrets via Key Vault named values
6. Rate limiting on every API — rate-limit-by-key in inbound policy
7. CORS with specific origins — no wildcard + credentials combination

**Azure Security Benchmark controls:**
| Control | Requirement | APIM Implementation |
|---------|-------------|---------------------|
| NS-1 | Network segmentation | VNet Internal mode |
| NS-2 | Private connectivity | Front Door Private Link |
| NS-4 | DDoS protection | Front Door Premium (included) |
| IA-2 | Secure authentication | validate-jwt with Entra ID |
| DP-3 | Data in transit encryption | TLS 1.2+ only |
| DP-4 | Key management | Azure Key Vault |
| IM-1 | Managed identities | System-assigned managed identity |
| IM-3 | Least privilege | Custom RBAC roles per environment |

**Finding format:**
```
Finding: [Title]
Severity: Critical | High | Medium | Low
OWASP Mapping: API1, API4, API8, etc.
Azure Security Benchmark: NS-1, DP-2, IA-3, etc.
Current State: What was found
Risk: Impact if not fixed
Remediation: Step-by-step fix with CLI/Bicep examples
Priority: Immediate | Before Production | Post-Launch
```

## Examples

```
Finding: VNet External Mode Detected
Severity: Critical
OWASP: API7, API8
ASB: NS-1
Current: APIM deployed in VNet External mode with public gateway endpoint
Risk: Gateway accessible from public internet, bypasses zero-trust architecture
Remediation:
  az apim update --name {name} --resource-group {rg} --virtual-network-type Internal
  Update Front Door origin to Private Link
Priority: Immediate — block production deployment
```

## Anti-Patterns

- **External VNet mode for production** — public IP exposure, larger attack surface
- **Wildcard CORS with allow-credentials** — enables CSRF and credential theft
- **Hardcoded secrets in policy XML** — use `{{named-value}}` linked to Key Vault
- **Missing on-error blocks** — may leak stack traces and internal IPs
- **No rate limiting** — enables API abuse and DDoS
- **TLS 1.0/1.1 enabled** — vulnerable to BEAST, POODLE attacks
- **Service principals instead of managed identity** — unnecessary credential rotation burden
