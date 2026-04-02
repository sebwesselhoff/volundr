---
name: "Azure APIOps Deployment"
description: "Infrastructure as Code and CI/CD patterns for Azure APIM — Bicep, Terraform, GitHub Actions, Azure DevOps pipelines"
domain: "devops"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-04-02"
reviewByDate: "2026-10-02"
triggers:
  - "apiops"
  - "bicep"
  - "arm template"
  - "apim deployment"
  - "azure pipeline"
  - "azure devops"
  - "infrastructure as code"
  - "apim bicep"
  - "apim terraform"
roles:
  - "devops-engineer"
  - "developer"
---

## Context
Apply when deploying Azure API Management infrastructure using IaC (Bicep or Terraform),
creating CI/CD pipelines, or implementing dev/test/prod promotion strategies.

## Patterns

**Bicep production APIM — key configuration:**
```bicep
resource apim 'Microsoft.ApiManagement/service@2023-05-01-preview' = {
  name: apimName
  location: location
  sku: { name: 'Premium', capacity: 3 }
  properties: {
    virtualNetworkType: 'Internal'
    virtualNetworkConfiguration: {
      subnetResourceId: '${vnet.id}/subnets/${subnetName}'
    }
    customProperties: {
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls10': 'False'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls11': 'False'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Ssl30': 'False'
    }
  }
  identity: { type: 'SystemAssigned' }
  zones: ['1', '2', '3']
}
```

**Single template, environment-specific parameters:**
One `main.bicep` template with `dev.bicepparam`, `test.bicepparam`, `prod.bicepparam` files.
Dev/test use Developer tier (1 unit), prod uses Premium tier (3 units, zone-redundant).

**CI/CD pipeline pattern (GitHub Actions):**
Dev -> Test -> Prod with serial job dependencies (`needs`).
Manual approval gate for production (GitHub environment protection rules).
Smoke tests after each deployment. Git tags for production releases.

**Phased deployment strategy:**
| Phase | Duration | Focus |
|-------|----------|-------|
| 1 | Week 1-2 | Core infra: VNet, APIM (dev), Front Door, Key Vault, monitoring |
| 2 | Week 3-4 | Authentication: Entra ID, OAuth policies |
| 3 | Week 5-8 | API onboarding: pilot APIs, policies, developer portal |
| 4 | Week 9-10 | Production infra: APIM Premium, zone-redundant |
| 5 | Week 11-12 | Production APIs: migrate pilots, performance testing |
| 6 | Week 13-15 | Governance: API Center, additional APIs, automation |
| 7 | Week 16-17 | Operations handoff: runbooks, training, dashboards |

**VNet subnet requirements for APIM:**
Subnet size >= /27 (32 IPs minimum). No other resources in the subnet.
Delegate to `Microsoft.ApiManagement/service`. NSG rules must allow APIM management traffic.

**Backup and restore:**
Daily APIM backups to geo-redundant storage (GRS). Retain: 30 days daily, 12 weeks weekly,
12 months monthly. Use `az apim backup create` for automated backups.

**APIM deployment timing:**
Premium with zone redundancy takes 30-60 minutes to deploy. Plan for this.
Use incremental deployments: Day 1 infra (slow), Day 2+ API configs (fast).

## Examples

```yaml
# Environment-specific Bicep params
# dev.bicepparam
param apimSku = 'Developer'
param apimCapacity = 1
param enableFrontDoor = false

# prod.bicepparam
param apimSku = 'Premium'
param apimCapacity = 3
param enableFrontDoor = true
param enableApiCenter = true
```

## Anti-Patterns

- **No IaC** — all Azure resources must be deployed via Bicep or Terraform, never portal-only
- **Manual production deployments** — always use CI/CD with approval gates
- **Same SKU across environments** — use Developer tier for dev/test to reduce costs
- **Missing smoke tests** — verify Front Door -> APIM connectivity after every deployment
- **No backup strategy** — configure automated daily backups before going to production
- **Skipping VNet subnet delegation** — APIM requires dedicated, delegated subnet
- **git add -A in deployment scripts** — only stage files relevant to the deployment
