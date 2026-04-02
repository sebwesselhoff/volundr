---
name: "Azure Architecture Design"
description: "Design Azure cloud architectures and produce High-Level Design documents with WAF and CAF alignment"
domain: "architecture"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-04-02"
reviewByDate: "2026-10-02"
triggers:
  - "azure"
  - "architecture"
  - "hld"
  - "high-level design"
  - "cloud design"
  - "service selection"
  - "well-architected"
  - "cloud adoption framework"
  - "caf"
roles:
  - "architect"
  - "developer"
  - "devops-engineer"
---

## Context
Apply when designing new Azure solutions, reviewing existing architectures, or producing High-Level
Design documentation. Covers service selection, network topology, security posture, and cost estimation.

## Patterns

**Service selection priority — PaaS > Containers > IaaS:**
Choose managed services to reduce operational overhead. Only drop to IaaS when PaaS cannot meet
a specific requirement (custom kernel, legacy OS, GPU passthrough).

**CAF naming convention:**
```
{resource-type}-{workload}-{environment}-{region}-{instance}
rg-ecommerce-prod-uksouth-001
app-ecommerce-prod-uksouth-001
sql-ecommerce-prod-uksouth-001
kv-ecommerce-prod-uksouth
```

**CAF tagging standard:**
```
Environment: Production | Staging | Development | Test
Owner: teamname@company.com
CostCenter: IT-12345
Criticality: Critical | High | Medium | Low
DataClassification: Public | Internal | Confidential | Restricted
```

**Architecture pattern selection:**
| Pattern | When to use |
|---------|-------------|
| N-Tier | Standard web apps, proven patterns, team familiarity |
| Microservices | Loosely coupled services, independent scaling, polyglot |
| Event-Driven | Async processing, reactive systems, decoupled components |
| Serverless | Sporadic workloads, event processing, cost-sensitive |

**HLD structure — always include these sections:**
1. Executive Summary (solution overview, key benefits, cost estimate, timeline)
2. Requirements Summary (functional, non-functional, constraints)
3. Architecture Overview (pattern, components, rationale)
4. Component Design (service, SKU, purpose, configuration, naming)
5. Networking Design (VNet, subnets, NSGs, private endpoints, DNS)
6. Security Design (auth, secrets, encryption, network security)
7. Data Design (schema approach, backup, RPO/RTO, retention)
8. Monitoring & Operations (App Insights, Log Analytics, alerts)
9. Deployment Strategy (IaC approach, CI/CD, environments, rollback)
10. Cost Breakdown (per-service monthly, optimization opportunities)
11. WAF Assessment (brief evaluation per pillar)
12. Risks and Mitigations

**Zone redundancy for production:**
Deploy production workloads across 3 availability zones for 99.99% SLA.
Use zone-redundant SKUs (App Service Premium, Azure SQL Business Critical, APIM Premium).

## Examples

```
Component Design Example:

Service: Azure App Service (Linux)
SKU: P2v3 (2 vCores, 8GB RAM)
Instances: 3 (Availability Zones 1, 2, 3)
Auto-scale: 3-10 instances based on CPU > 70%
Naming: app-ecommerce-web-prod-uksouth-001
Purpose: Serves customer-facing website
```

## Anti-Patterns

- **Skipping WAF assessment** — every architecture must address all five pillars
- **Missing cost estimates** — every component needs a monthly cost in the HLD
- **Vague service references** — use exact SKUs ("Azure SQL Database S2 DTU") not just "database"
- **IaaS by default** — recommend PaaS unless there is a specific IaaS requirement
- **Ignoring CAF naming** — inconsistent naming causes operational confusion at scale
- **Single pillar focus** — optimizing cost at the expense of reliability, or vice versa
