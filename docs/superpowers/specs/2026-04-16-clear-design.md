# CLEAR - Contica Landing-zone Evaluation for Azure Readiness

## Design Specification

**Version:** 1.0
**Date:** 2026-04-16
**Author:** Sebastian Wesselhoff / Volundr
**Status:** Draft

---

## 1. Overview

### 1.1 Purpose

CLEAR is an internal tool for Contica AB consultants that scans a customer's Azure tenant against Azure Landing Zone (ALZ) best practices, produces an exact compliance score, uses AI to analyze gaps and recommend remediation, and generates IaC and exportable reports for the customer.

### 1.2 Design Principles

1. **Scan is deterministic.** Same tenant, same score, every time. No AI in measurement. A score of 67 today is 67 tomorrow on the same tenant state.
2. **AI analyzes and suggests, never measures.** AI interprets results, generates narratives, tailors recommendations to context. The scan engine is the source of truth.
3. **Knowledge stays current.** CLEAR syncs from the official Azure Landing Zones Library, CAF documentation, and Azure Verified Modules. No hardcoded policy lists.
4. **IaC remediation uses Contica's own templates first.** The `dynamic-infrastructure-template-stack` is the preferred source. Gaps are flagged as template improvement opportunities. Azure ALZ Accelerator and AVM are fallbacks.
5. **Runs locally, deploys to Azure.** Same Docker images, different configuration. Local-first development, Azure Container Apps for production.
6. **AI provider is hot-swappable.** Claude, Azure OpenAI, or GitHub Models. Configurable per-tenant or globally. No AI logic leaks into scanners or frontend.

### 1.3 Target Users

Contica AB consultants performing Azure environment assessments, ALZ implementations, and BizTalk-to-Azure migrations. Internal tool only.

### 1.4 Glossary

| Term | Definition |
|------|-----------|
| ALZ | Azure Landing Zone - Microsoft's prescriptive architecture for well-governed Azure environments |
| CAF | Cloud Adoption Framework - Microsoft's methodology for cloud adoption |
| AVM | Azure Verified Modules - standardized, Microsoft-supported IaC modules |
| AMBA | Azure Monitor Baseline Alerts - standardized alerting for ALZ |
| MG | Management Group - Azure hierarchy node above subscriptions |
| DINE | DeployIfNotExists - Azure Policy effect that auto-remediates non-compliant resources |
| Archetype | ALZ concept mapping a management group to its expected policy assignments |
| CLEAR Score | Weighted composite score (0-100) across all 8 assessment scanners |
| SSE | Server-Sent Events - HTTP streaming for real-time scan progress |
| KQL | Kusto Query Language - query language for Azure Resource Graph |
| PIM | Privileged Identity Management - just-in-time privileged access in Entra ID |
| CA | Conditional Access - Entra ID policies controlling authentication requirements |
| RSV | Recovery Services Vault - Azure backup and site recovery container |
| NVA | Network Virtual Appliance - third-party firewall/router VM in Azure |
| vWAN | Virtual WAN - Microsoft-managed hub networking service |
| SemVer | Semantic Versioning - MAJOR.MINOR.PATCH version numbering |
| CalVer | Calendar Versioning - YYYY.MM.PATCH version numbering (used by ALZ Library) |

---

## 2. Architecture

### 2.1 System Context

```
Consultant's Browser
    |
    v
[clear-web]  Next.js (SSR, port 3000)
    |
    v
[clear-api]  ASP.NET Core Web API (.NET 8, port 5000)
    |
    +---> Azure REST APIs (tenant scanning)
    +---> Microsoft Graph API (identity checks)
    +---> Azure Resource Graph (KQL queries)
    +---> Azure Policy API (compliance states)
    +---> AI Provider (analysis, reports, chat)
    +---> GitHub API (ALZ Library sync)
    +---> Contica Template Stack (IaC matching)
    +---> Local Database (scan results, history)
```

### 2.2 Container Architecture

Two separate containers. Independent scaling. No shared filesystem in production.

**clear-api** (.NET 8 Web API):
- Assessment engine (8 scanners)
- Knowledge sync module
- AI service abstraction layer
- Report generation (PDF, Word, HTML)
- REST API for the frontend
- Background job runner (scans, syncs)

**clear-web** (Next.js):
- Server-side rendered dashboard pages
- AI chat interface (streaming)
- Assessment interview wizard
- Report viewer and export
- Settings and configuration UI
- Auth middleware (Entra ID when hosted)

### 2.3 Project Structure

```
clear/
├── clear-api/                          (.NET 8 Web API)
│   ├── Clear.Api/                      (API host, controllers, middleware)
│   │   ├── Controllers/
│   │   │   ├── TenantsController.cs
│   │   │   ├── ScansController.cs
│   │   │   ├── ReportsController.cs
│   │   │   ├── ChatController.cs
│   │   │   ├── KnowledgeController.cs
│   │   │   └── SettingsController.cs
│   │   ├── Middleware/
│   │   │   └── AuthMiddleware.cs
│   │   ├── BackgroundJobs/
│   │   │   ├── ScanJob.cs
│   │   │   └── KnowledgeSyncJob.cs
│   │   ├── Program.cs
│   │   └── appsettings.json
│   │
│   ├── Clear.Engine/                   (Assessment engine library)
│   │   ├── Scanners/
│   │   │   ├── IScannerModule.cs
│   │   │   ├── ResourceOrganizationScanner.cs
│   │   │   ├── IdentityAccessScanner.cs
│   │   │   ├── NetworkTopologyScanner.cs
│   │   │   ├── SecurityScanner.cs
│   │   │   ├── ManagementMonitoringScanner.cs
│   │   │   ├── GovernancePolicyScanner.cs
│   │   │   ├── PlatformAutomationScanner.cs
│   │   │   └── BusinessContinuityScanner.cs
│   │   ├── Scoring/
│   │   │   ├── ScoringEngine.cs
│   │   │   └── MaturityTierCalculator.cs
│   │   ├── Diff/
│   │   │   ├── PolicyDiffEngine.cs
│   │   │   ├── HierarchyDiffEngine.cs
│   │   │   └── ComplianceDiffEngine.cs
│   │   └── Models/
│   │       ├── ScanResult.cs
│   │       ├── ScannerResult.cs
│   │       ├── CheckResult.cs
│   │       ├── MaturityTier.cs
│   │       └── GapReport.cs
│   │
│   ├── Clear.Knowledge/               (Knowledge sync module)
│   │   ├── Sync/
│   │   │   ├── AlzLibrarySync.cs
│   │   │   ├── ReviewChecklistSync.cs
│   │   │   ├── AmbaSync.cs
│   │   │   ├── AvmModuleIndexSync.cs
│   │   │   └── ConticaTemplateSync.cs
│   │   ├── Models/
│   │   │   ├── AlzArchitectureDefinition.cs
│   │   │   ├── AlzArchetypeDefinition.cs
│   │   │   ├── AlzPolicyDefinition.cs
│   │   │   ├── AlzPolicyAssignment.cs
│   │   │   ├── AlzPolicySetDefinition.cs
│   │   │   ├── AlzRoleDefinition.cs
│   │   │   ├── AlzPolicyDefaultValues.cs
│   │   │   ├── ReviewChecklistItem.cs
│   │   │   └── AvmModule.cs
│   │   └── Store/
│   │       └── KnowledgeStore.cs
│   │
│   ├── Clear.AI/                       (AI provider abstraction)
│   │   ├── IAIProvider.cs
│   │   ├── AIProviderFactory.cs
│   │   ├── Providers/
│   │   │   ├── AnthropicProvider.cs
│   │   │   ├── AzureOpenAIProvider.cs
│   │   │   └── GitHubModelsProvider.cs
│   │   ├── Prompts/
│   │   │   ├── InterviewSystemPrompt.md
│   │   │   ├── AnalysisSystemPrompt.md
│   │   │   ├── RemediationSystemPrompt.md
│   │   │   ├── ReportNarrativePrompt.md
│   │   │   └── ChatSystemPrompt.md
│   │   └── Models/
│   │       ├── AnalysisReport.cs
│   │       ├── RemediationPlan.cs
│   │       ├── InterviewResponse.cs
│   │       └── ChatMessage.cs
│   │
│   ├── Clear.Remediation/             (IaC generation and matching)
│   │   ├── TemplateResolver.cs
│   │   ├── ConticaStackMatcher.cs
│   │   ├── AlzAcceleratorMapper.cs
│   │   ├── AvmModuleMapper.cs
│   │   └── GapAdvisor.cs
│   │
│   ├── Clear.Reports/                 (Report generation)
│   │   ├── PdfReportGenerator.cs
│   │   ├── WordReportGenerator.cs
│   │   ├── HtmlReportGenerator.cs
│   │   └── Templates/
│   │       ├── executive-summary.html
│   │       ├── detailed-assessment.html
│   │       └── remediation-plan.html
│   │
│   ├── Clear.Azure/                   (Azure API clients)
│   │   ├── AzureClientFactory.cs
│   │   ├── ResourceGraphClient.cs
│   │   ├── PolicyClient.cs
│   │   ├── ManagementGroupClient.cs
│   │   ├── SecurityCenterClient.cs
│   │   ├── MonitorClient.cs
│   │   ├── NetworkClient.cs
│   │   ├── GraphApiClient.cs
│   │   └── DeploymentHistoryClient.cs
│   │
│   ├── Clear.Data/                    (Database layer)
│   │   ├── ClearDbContext.cs
│   │   ├── Entities/
│   │   │   ├── Tenant.cs
│   │   │   ├── TenantConfig.cs
│   │   │   ├── Scan.cs
│   │   │   ├── ScannerResult.cs
│   │   │   ├── CheckResult.cs
│   │   │   ├── AssessmentProfile.cs
│   │   │   ├── Report.cs
│   │   │   ├── AlzVersion.cs
│   │   │   ├── PolicyDefinitionCache.cs
│   │   │   ├── PolicyAssignmentCache.cs
│   │   │   ├── PolicySetDefinitionCache.cs
│   │   │   ├── ArchetypeDefinitionCache.cs
│   │   │   ├── RoleDefinitionCache.cs
│   │   │   ├── ReviewChecklistItemCache.cs
│   │   │   └── ConticaTemplateCache.cs
│   │   ├── Migrations/
│   │   └── Repositories/
│   │       ├── ITenantRepository.cs
│   │       ├── IScanRepository.cs
│   │       └── IKnowledgeRepository.cs
│   │
│   └── Clear.Infrastructure/          (Cross-cutting concerns)
│       ├── IReportStore.cs
│       ├── LocalFileReportStore.cs
│       ├── BlobStorageReportStore.cs
│       ├── ISecretProvider.cs
│       ├── EnvFileSecretProvider.cs
│       ├── KeyVaultSecretProvider.cs
│       ├── IAuthProvider.cs
│       ├── DevBypassAuthProvider.cs
│       └── EntraIdAuthProvider.cs
│
├── clear-web/                          (Next.js frontend)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                    (Dashboard)
│   │   ├── tenants/
│   │   │   ├── page.tsx                (Tenant list)
│   │   │   └── [id]/
│   │   │       ├── page.tsx            (Tenant overview)
│   │   │       ├── scan/
│   │   │       │   └── page.tsx        (New scan + AI interview)
│   │   │       ├── results/
│   │   │       │   ├── [scanId]/
│   │   │       │   │   ├── page.tsx    (Scan results overview)
│   │   │       │   │   └── [scanner]/
│   │   │       │   │       └── page.tsx (Scanner detail)
│   │   │       ├── remediation/
│   │   │       │   └── page.tsx        (Remediation plan)
│   │   │       ├── reports/
│   │   │       │   └── page.tsx        (Export reports)
│   │   │       └── chat/
│   │   │           └── page.tsx        (AI chat)
│   │   ├── knowledge/
│   │   │   └── page.tsx                (ALZ Library status)
│   │   └── settings/
│   │       └── page.tsx                (Configuration)
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── TenantCard.tsx
│   │   │   ├── ScoreGauge.tsx
│   │   │   └── MaturityBadge.tsx
│   │   ├── scan/
│   │   │   ├── ScanProgress.tsx
│   │   │   ├── ScannerCard.tsx
│   │   │   └── CheckTable.tsx
│   │   ├── interview/
│   │   │   └── InterviewWizard.tsx
│   │   ├── chat/
│   │   │   └── ChatPanel.tsx
│   │   ├── remediation/
│   │   │   ├── RemediationTimeline.tsx
│   │   │   └── IaCViewer.tsx
│   │   └── reports/
│   │       └── ReportPreview.tsx
│   ├── lib/
│   │   ├── api.ts                      (API client)
│   │   └── types.ts                    (Shared TypeScript types)
│   ├── next.config.ts
│   ├── package.json
│   └── Dockerfile
│
├── docker-compose.yml
├── docker-compose.azure.yml
├── infrastructure/                     (Azure deployment IaC)
│   ├── main.bicep
│   ├── modules/
│   │   ├── containerApps.bicep
│   │   ├── sqlServer.bicep
│   │   ├── keyVault.bicep
│   │   ├── blobStorage.bicep
│   │   ├── containerRegistry.bicep
│   │   └── appRegistration.bicep
│   └── parameters/
│       ├── dev.bicepparam
│       └── prod.bicepparam
├── .github/
│   └── workflows/
│       ├── build.yml
│       └── deploy.yml
└── README.md
```

---

## 3. Knowledge Sync Module

### 3.1 Primary Data Source

**Repository:** `Azure/Azure-Landing-Zones-Library`
**Versioning:** CalVer `YYYY.0M.P` (e.g., `platform/alz/2026.04.0`)
**Update cadence:** Bi-weekly to monthly releases
**License:** MIT

This repository is the single source of truth for all ALZ policy data, management group hierarchy definitions, and archetype mappings. It is the same source consumed by Microsoft's own tooling (ALZ Terraform provider, AzGovViz, ALZ Bicep modules).

### 3.2 Data Inventory

| Data | Source File(s) | Count | Purpose in CLEAR |
|------|---------------|-------|-----------------|
| MG hierarchy definition | `architecture_definitions/alz.alz_architecture_definition.json` | 1 | Expected hierarchy structure for Scanner 1 |
| Archetype-to-policy mappings | `archetype_definitions/*.alz_archetype_definition.json` | 11 | Expected policy assignments per MG scope for Scanner 6 |
| Custom policy definitions | `policy_definitions/*.alz_policy_definition.json` | 149 | Policy catalog for diff engine |
| Policy initiatives | `policy_set_definitions/*.alz_policy_set_definition.json` | 42 | Initiative catalog for diff engine |
| Policy assignments | `policy_assignments/*.alz_policy_assignment.json` | 79 | Assignment templates with parameters and enforcement mode |
| Custom role definitions | `role_definitions/*.alz_role_definition.json` | 5 | Expected RBAC roles for Scanner 2 |
| Policy default values | `alz_policy_default_values.json` | 15 params | Required parameter values for assignments |
| Library metadata | `alz_library_metadata.json` | 1 | Version tracking |
| JSON schemas | `schemas/*.json` | 5 | Validation of fetched data |

### 3.3 Supplementary Data Sources

| Source | Repository | File | Purpose |
|--------|-----------|------|---------|
| ALZ review checklist | `Azure/review-checklists` | `checklists/alz_checklist.en.json` | 48 assessment items, 16 with Resource Graph KQL queries |
| AMBA alerts | `Azure/Azure-Landing-Zones-Library` | `platform/amba/` | Azure Monitor baseline alert definitions |
| AVM module index | `Azure/Azure-Verified-Modules` | `docs/static/module-indexes/BicepResourceModules.csv` | 200+ verified Bicep module references for remediation |
| Contica template stack | `Contica-AB/dynamic-infrastructure-template-stack` | `dev` branch | Contica's own Bicep modules for IaC matching |

### 3.4 Sync Protocol

```
On application startup:
  1. Read local cache version from database (alz_versions table)
  2. GET https://api.github.com/repos/Azure/Azure-Landing-Zones-Library/releases
     Filter: tags starting with "platform/alz/"
     Extract: latest tag name and published date
  3. If remote version > local version OR no local cache:
     a. Fetch full tree at tag via GitHub API
     b. Download all JSON files via raw.githubusercontent.com
     c. Validate against JSON schemas
     d. Parse and store in database tables
     e. Update alz_versions table with new version and sync timestamp
  4. Sync supplementary sources (review checklists, AMBA, AVM index)
  5. Sync Contica template stack index
  6. Log sync result (version, file counts, duration)

On-demand sync:
  Triggered via API endpoint POST /api/knowledge/sync
  Same protocol as startup, forced re-fetch regardless of version

Pinning strategy:
  Production scans use the pinned release tag.
  Dev/testing can use main branch.
  Configurable via appsettings.json: Knowledge.AlzLibrary.Tag
```

### 3.5 Raw GitHub URLs

```
# Pinned to release tag (stable, recommended for production):
https://raw.githubusercontent.com/Azure/Azure-Landing-Zones-Library/platform/alz/2026.04.0/platform/alz/{path}

# Latest from main (unstable, for development):
https://raw.githubusercontent.com/Azure/Azure-Landing-Zones-Library/main/platform/alz/{path}

# Release discovery:
GET https://api.github.com/repos/Azure/Azure-Landing-Zones-Library/releases

# File tree at tag:
GET https://api.github.com/repos/Azure/Azure-Landing-Zones-Library/git/trees/platform/alz/2026.04.0?recursive=1
```

### 3.6 Deprecation Detection

Deprecated policies are identified by JSON metadata fields in the Library:

```json
{
  "properties": {
    "metadata": {
      "deprecated": true,
      "supersededBy": "<policy-name>"
    },
    "displayName": "[Deprecated]: <original name>"
  }
}
```

Policy set versioning uses dated suffixes on filenames:
- `Enforce-Guardrails-KeyVault_20260203.alz_policy_set_definition.json`
- The `replacesPolicy` metadata field points to the older version.

CLEAR flags tenants using deprecated policies and recommends the superseding replacement.

---

## 4. Assessment Engine

### 4.1 Engine Architecture

The engine consists of 8 independent scanner modules, a diff engine, and a scoring engine. All scanners implement `IScannerModule` and can run in parallel.

```csharp
public interface IScannerModule
{
    string ScannerId { get; }           // e.g., "resource-organization"
    string DisplayName { get; }          // e.g., "Resource Organization"
    int Weight { get; }                  // Scoring weight (percentage)
    Task<ScannerResult> ScanAsync(ScanContext context, CancellationToken ct);
}

public record ScanContext(
    string TenantId,
    AzureCredential Credential,
    KnowledgeSnapshot Knowledge,         // Synced ALZ Library data
    AssessmentProfile Profile,           // From AI interview (optional)
    ScanOptions Options                  // Scope, exclusions, overrides
);

public record ScannerResult(
    string ScannerId,
    int Score,                           // 0-100
    int MaxScore,                        // Always 100
    Confidence Confidence,               // High, Medium, Low
    List<CheckResult> Checks,
    DateTimeOffset ScannedAt
);

public record CheckResult(
    string CheckId,                      // e.g., "RO-001"
    string Name,                         // Human-readable name
    CheckStatus Status,                  // Pass, Fail, Partial, NotApplicable, Error
    Severity Severity,                   // Critical, High, Medium, Low, Info
    string? ExpectedValue,
    string? ActualValue,
    string? Detail,                      // Explanation of finding
    RemediationRef? Remediation          // Link to remediation hierarchy
);
```

### 4.2 Scanner 1: Resource Organization

**ID:** `resource-organization`
**Weight:** 15%
**Confidence:** High
**Primary data source:** `alz.alz_architecture_definition.json` (expected hierarchy)
**Primary Azure API:** Management Groups API, Resource Graph

| Check ID | Check | Expected State | Azure API | Severity |
|----------|-------|---------------|-----------|----------|
| RO-001 | ALZ management group hierarchy exists | 11 MGs matching architecture definition | `GET /providers/Microsoft.Management/managementGroups` | Critical |
| RO-002 | Intermediate root MG (not using Tenant Root directly) | MG with `parent_id: null` that is NOT the Tenant Root Group | Management Groups API | Critical |
| RO-003 | Platform MG with children (Management, Connectivity, Identity, Security) | 4 child MGs under Platform | Management Groups API | High |
| RO-004 | Landing Zones MG with Corp and Online children | 2+ child MGs under Landing Zones | Management Groups API | High |
| RO-005 | Sandbox MG exists | Sibling of Platform and Landing Zones | Management Groups API | Medium |
| RO-006 | Decommissioned MG exists | Sibling of Platform and Landing Zones | Management Groups API | Medium |
| RO-007 | Hierarchy depth does not exceed 4 levels | Max depth ≤ 4 below intermediate root | Parse hierarchy tree | Medium |
| RO-008 | Default MG for new subscriptions is not Tenant Root Group | Default MG set to Sandbox or custom | `GET /providers/Microsoft.Management/managementGroups/settings` | High |
| RO-009 | MG hierarchy requires authorization for operations | `requireAuthorizationForGroupCreation: true` | MG hierarchy settings API | Medium |
| RO-010 | Dedicated Management subscription under Platform/Management | ≥1 subscription in Management MG | Resource Graph: `resourcecontainers` | High |
| RO-011 | Dedicated Connectivity subscription under Platform/Connectivity | ≥1 subscription in Connectivity MG | Resource Graph: `resourcecontainers` | High |
| RO-012 | Dedicated Identity subscription under Platform/Identity | ≥1 subscription in Identity MG | Resource Graph: `resourcecontainers` | High |
| RO-013 | No subscriptions at Tenant Root Group | 0 subscriptions directly under root | Resource Graph: `resourcecontainers` | High |
| RO-014 | No dev/test/prod management groups (anti-pattern) | No MGs named dev, test, staging, prod | Management Groups API | Medium |
| RO-015 | Application subscriptions under Corp or Online | Non-platform subs in Landing Zones tree | Resource Graph: `resourcecontainers` | Medium |

### 4.3 Scanner 2: Identity & Access Management

**ID:** `identity-access`
**Weight:** 15%
**Confidence:** High (Graph API) / Medium (some PIM checks require P2 license)
**Primary Azure API:** Microsoft Graph API, Resource Graph

| Check ID | Check | Expected State | API | Severity |
|----------|-------|---------------|-----|----------|
| IA-001 | Conditional Access policies exist | ≥1 CA policy configured | Graph: `identity/conditionalAccess/policies` | Critical |
| IA-002 | MFA enforcement via Conditional Access | CA policy requiring MFA for all users | Graph: CA policies analysis | Critical |
| IA-003 | PIM enabled for privileged roles | PIM role assignments exist | Graph: PIM API endpoints | High |
| IA-004 | Global Administrator count ≤ 5 | Count of GA role members ≤ 5 | Graph: `directoryRoles` filter GA | High |
| IA-005 | Emergency access (break-glass) accounts exist | ≥2 accounts excluded from CA, no MFA, cloud-only | Graph: users + CA exclusions analysis | High |
| IA-006 | No direct user role assignments at MG scope | All role assignments use groups, not users | Resource Graph: `authorizationresources` where `principalType == 'User'` | High |
| IA-007 | No classic administrators | 0 classic admins (co-admin, service admin) | `GET /subscriptions/{id}/providers/Microsoft.Authorization/classicAdministrators` | Medium |
| IA-008 | Identity subscription exists under Platform/Identity | Subscription in Identity MG | Resource Graph: `resourcecontainers` | High |
| IA-009 | Entra ID diagnostic settings configured | Audit/sign-in logs sent to Log Analytics | Graph: diagnostic settings | Medium |
| IA-010 | Custom ALZ role definitions deployed | 5 ALZ roles exist (from `role_definitions/`) | Resource Graph: `authorizationresources` | Medium |
| IA-011 | Defender for Identity enabled | Defender for Identity plan active | Security API | Medium |

### 4.4 Scanner 3: Network Topology & Connectivity

**ID:** `network-topology`
**Weight:** 15%
**Confidence:** High
**Primary Azure API:** Resource Graph, Network Management API

| Check ID | Check | Expected State | API | Severity |
|----------|-------|---------------|-----|----------|
| NT-001 | Hub VNet or Virtual WAN hub exists | ≥1 hub VNet or vWAN hub in Connectivity subscription | Resource Graph | Critical |
| NT-002 | Azure Firewall or NVA deployed in hub | Firewall resource in hub VNet | Resource Graph: `microsoft.network/azurefirewalls` | Critical |
| NT-003 | ExpressRoute or VPN Gateway for hybrid connectivity | Gateway resource in Connectivity subscription | Resource Graph: `microsoft.network/virtualnetworkgateways` | Medium |
| NT-004 | DDoS Protection plan exists and associated | DDoS plan linked to VNets | Resource Graph: `microsoft.network/ddosprotectionplans` | High |
| NT-005 | NSGs associated with all subnets | Every subnet (except GatewaySubnet, AzureFirewallSubnet, AzureBastionSubnet) has NSG | Resource Graph: VNet subnet analysis | High |
| NT-006 | No public IPs in Corp landing zones | 0 public IP resources in Corp subscriptions | Resource Graph: `microsoft.network/publicipaddresses` in Corp subs | High |
| NT-007 | VNet peerings from spokes to hub | Each spoke VNet peered to hub | Resource Graph: `microsoft.network/virtualnetworks/virtualnetworkpeerings` | High |
| NT-008 | Private endpoints configured for PaaS in Corp | Private endpoints exist for PaaS services | Resource Graph: `microsoft.network/privateendpoints` | Medium |
| NT-009 | Private DNS zones centralized in Connectivity subscription | DNS zones in Connectivity sub, not scattered | Resource Graph: `microsoft.network/privatednszones` | Medium |
| NT-010 | IP forwarding disabled on NICs | `enableIPForwarding: false` on all NICs (except NVA NICs) | Resource Graph: `microsoft.network/networkinterfaces` | Medium |
| NT-011 | No VPN/ER/vWAN gateways in Corp landing zone subscriptions | 0 gateways outside Connectivity subscription | Resource Graph: gateway resources in non-connectivity subs | Medium |
| NT-012 | Network Watcher enabled per region | Network Watcher in each region with resources | Resource Graph: `microsoft.network/networkwatchers` | Low | *(Note: also verified in MM-009, scored here only)* |
| NT-013 | Flow logs enabled on critical VNets | NSG flow logs or VNet flow logs configured | Resource Graph: `microsoft.network/networkwatchers/flowlogs` | Low |
| NT-014 | Azure Bastion deployed for VM access | Bastion host in hub network | Resource Graph: `microsoft.network/bastionhosts` | Medium |

### 4.5 Scanner 4: Security

**ID:** `security`
**Weight:** 15%
**Confidence:** High
**Primary Azure API:** Security Center API, Resource Graph, Policy compliance

| Check ID | Check | Expected State | API | Severity |
|----------|-------|---------------|-----|----------|
| SC-001 | Defender for Cloud Standard tier on all subscriptions | Standard pricing on all subs | `GET /subscriptions/{id}/providers/Microsoft.Security/pricings` | Critical |
| SC-002 | All Defender plans enabled | Servers, SQL, Storage, AppService, KeyVault, DNS, ARM, Containers all enabled | Security pricing API: iterate all tiers | High |
| SC-003 | Microsoft Cloud Security Benchmark assigned | Root archetype: `Deploy-ASC-Monitoring` compliance | Policy compliance API | High |
| SC-004 | Microsoft Sentinel deployed | Sentinel workspace exists in Security or Management subscription | Resource Graph: `microsoft.securityinsights/settings` | High |
| SC-005 | Security contact configured | Email contact for security alerts | `GET /subscriptions/{id}/providers/Microsoft.Security/securityContacts` | Medium |
| SC-006 | Key Vault soft-delete enabled | `enableSoftDelete: true` on all Key Vaults | Resource Graph: `microsoft.keyvault/vaults` | High |
| SC-007 | Key Vault purge protection enabled | `enablePurgeProtection: true` on all Key Vaults | Resource Graph: `microsoft.keyvault/vaults` | High |
| SC-008 | Secure transfer required on storage accounts | `supportsHttpsTrafficOnly: true` on all storage accounts | Resource Graph: `microsoft.storage/storageaccounts` | High |
| SC-009 | SQL TDE enabled on all databases | TDE status `Enabled` | Resource Graph: `microsoft.sql/servers/databases/transparentdataencryption` | High |
| SC-010 | SQL auditing enabled | Auditing configured to Log Analytics | Resource Graph + Policy compliance | Medium |
| SC-011 | AKS Policy Add-on enabled | `addonProfiles.azurepolicy.enabled: true` on AKS clusters | Resource Graph: AKS cluster properties | Medium |
| SC-012 | Trusted Launch on VMs | `securityProfile.securityType: TrustedLaunch` | Resource Graph: VM properties | Medium |
| SC-013 | WAF on internet-facing Application Gateways | WAF configuration present | Resource Graph: Application Gateway properties | Medium |

### 4.6 Scanner 5: Management & Monitoring

**ID:** `management-monitoring`
**Weight:** 10%
**Confidence:** High
**Primary Azure API:** Resource Graph, Monitor API, Policy compliance

| Check ID | Check | Expected State | API | Severity |
|----------|-------|---------------|-----|----------|
| MM-001 | Central Log Analytics workspace in Management subscription | ≥1 workspace in Management sub | Resource Graph: `microsoft.operationalinsights/workspaces` | Critical |
| MM-002 | Activity logs forwarded to central workspace | Diagnostic setting on each subscription sending to Log Analytics | `GET /subscriptions/{id}/providers/Microsoft.Insights/diagnosticSettings` | High |
| MM-003 | Diagnostic settings on resources via DINE policy | Root archetype `Deploy-Diag-Logs` compliance | Policy compliance API | High |
| MM-004 | Azure Monitor Agent deployed on VMs (not legacy agent) | AMA extension on VMs, no MMA/OMS | Resource Graph: VM extensions | Medium |
| MM-005 | Service Health alerts configured | Activity log alerts for ServiceHealth | Resource Graph: `microsoft.insights/activitylogalerts` | Medium |
| MM-006 | AMBA baseline alerts deployed | Connectivity, Management, Identity, Landing Zone alert sets | Resource Graph: alert rule resources per scope | Medium |
| MM-007 | Resource locks on critical platform resources | Delete locks on hub VNet, Log Analytics workspace, Key Vaults | Resource Graph: lock information | Medium |
| MM-008 | Update management configured | Periodic update checking policy compliance | Policy compliance for update policies | Low |
| MM-009 | Network Watcher enabled per region | Network Watcher resource per active region | Resource Graph | Low | *(Cross-ref NT-012, scored in Scanner 3 only)* |
| MM-010 | Change Tracking enabled for VMs | Change Tracking extension or policy compliance | Policy compliance API | Low |

### 4.7 Scanner 6: Governance (Policy & Compliance)

**ID:** `governance-policy`
**Weight:** 15%
**Confidence:** High
**Primary data source:** All 11 archetype definitions from ALZ Library
**Primary Azure API:** Azure Policy API, Resource Graph

This is the most precise scanner. It performs a 1:1 diff between the ALZ Library archetype definitions and the tenant's actual policy state.

**Phase 1: Hierarchy-to-archetype mapping**

```
For each management group in the tenant:
  1. Attempt to map to an ALZ archetype based on:
     - Position in hierarchy (root, platform child, landing zones child, etc.)
     - Naming patterns (connectivity, identity, corp, online, sandbox, etc.)
     - Existing policy assignments (fingerprinting)
  2. If no mapping found, mark as "unmapped" (informational, not penalized)
```

**Phase 2: Policy assignment diff**

For each mapped management group:

| Check ID | Check | Method | Severity |
|----------|-------|--------|----------|
| GP-001 | Expected policy assignments present | Compare archetype `policy_assignments[]` against actual `GET .../policyAssignments` | Critical per missing assignment |
| GP-002 | No stale custom policy definitions | Compare tenant policy definition versions against Library `policy_definitions/` using metadata.version | High |
| GP-003 | No deprecated policies in use | Check `deprecated: true` in policy definition metadata | High |
| GP-004 | Enforcement mode is Default (not DoNotEnforce) | Check `enforcementMode` on each assignment | High |
| GP-005 | Required parameters populated | Check assignment parameters against `alz_policy_default_values.json` | Medium |
| GP-006 | Custom policy set definitions match Library | Compare tenant initiative definitions against `policy_set_definitions/` | Medium |
| GP-007 | Custom role definitions deployed | Compare tenant custom roles against `role_definitions/` | Medium |
| GP-008 | No policies assigned at Tenant Root Group | 0 custom assignments at root | Medium |
| GP-009 | Extra assignments beyond ALZ reference (informational) | Assignments in tenant not in archetype | Info |

**Phase 3: Compliance state assessment**

| Check ID | Check | Method | Severity |
|----------|-------|--------|----------|
| GP-010 | Overall policy compliance rate &gt;90% | `GET /providers/Microsoft.PolicyInsights/policyStates/latest/summarize` | High |
| GP-011 | Non-compliant resource count &lt;5% of total | Compliance summary per policy | Medium |
| GP-012 | DINE policies with pending remediation | Resources non-compliant under DINE policies that haven't been remediated | Medium |
| GP-013 | Budget alerts configured per subscription | `GET /subscriptions/{id}/providers/Microsoft.Consumption/budgets` | Low |
| GP-014 | Required tag policies in place | Tag-related policy assignments exist | Low |

**Scoring for Scanner 6:**

The score is calculated from the policy assignment diff:
- Each expected assignment has a weight based on its archetype and severity
- Missing critical assignments (Defender, Security Benchmark, diagnostic logging) score 0
- Present but DoNotEnforce scores 50% of full value
- Present and Default enforcement scores 100%
- Deprecated policies receive 0 (should be replaced)
- Compliance rate modifies the score: >90% compliance = no penalty, <90% = proportional reduction

### 4.8 Scanner 7: Platform Automation & DevOps

**ID:** `platform-automation`
**Weight:** 5%
**Confidence:** Medium (heuristic-based)
**Primary Azure API:** Deployments API, Resource Graph, Microsoft Graph

| Check ID | Check | Method | Severity | Confidence |
|----------|-------|--------|----------|------------|
| PA-001 | IaC deployment evidence | Analyze deployment history for systematic patterns (template deployments vs portal) | Medium | Medium |
| PA-002 | Managed identities preferred over SP secrets | Count managed identity usage vs SP with password credentials | Medium | High |
| PA-003 | Deployment Stacks in use | Check for `Microsoft.Resources/deploymentStacks` resources | Low | High |
| PA-004 | Automation account or pipeline evidence | Check for Automation Accounts, DevOps service connections | Low | Medium |
| PA-005 | Subscription creation patterns | Analyze subscription creation dates and naming for vending patterns | Low | Low |

### 4.9 Scanner 8: Business Continuity & Disaster Recovery

**ID:** `business-continuity`
**Weight:** 10%
**Confidence:** High
**Primary Azure API:** Resource Graph, Recovery Services API, Policy compliance

| Check ID | Check | Expected State | API | Severity |
|----------|-------|---------------|-----|----------|
| BC-001 | VM backup policy enforced | Identity + Landing Zones archetype: `Deploy-VM-Backup` compliance | Policy compliance API | High |
| BC-002 | Recovery Services vaults exist | ≥1 RSV per region with VMs | Resource Graph: `microsoft.recoveryservices/vaults` | High |
| BC-003 | Backup policies configured with adequate retention | Daily backups, ≥30 day retention | Recovery Services API: backup policies | Medium |
| BC-004 | Storage account redundancy (GRS or ZRS) | Non-dev storage accounts using GRS/ZRS/GZRS | Resource Graph: `microsoft.storage/storageaccounts` SKU | Medium |
| BC-005 | Availability Zones used where available | Zone-redundant deployments for critical resources | Resource Graph: zone properties | Medium |
| BC-006 | Multi-region deployment for critical workloads | Resources distributed across ≥2 regions (for critical workloads) | Resource Graph: location analysis | Low |
| BC-007 | Azure Site Recovery configured | ASR replication for critical VMs | Resource Graph: ASR resources | Low |

---

## 5. Scoring Model

### 5.1 Scanner Weights

| Scanner | Weight | Rationale |
|---------|--------|-----------|
| Resource Organization | 15% | Foundation - hierarchy is prerequisite for everything else |
| Identity & Access | 15% | Primary security boundary in public cloud |
| Network Topology | 15% | Equally foundational per Microsoft CAF |
| Security | 15% | Direct risk to customer |
| Management & Monitoring | 10% | Operational visibility, less structural |
| Governance (Policy) | 15% | Core of ALZ compliance, most measurable |
| Platform Automation | 5% | Hardest to measure, most heuristic |
| Business Continuity | 10% | Risk reduction, measurable |

### 5.2 Check Severity Weights

Within each scanner, checks are weighted by severity:

| Severity | Weight Multiplier | Meaning |
|----------|------------------|---------|
| Critical | 3x | Foundational. Failure here undermines the entire design area. |
| High | 2x | Important. Significant gap in compliance or security posture. |
| Medium | 1x | Recommended. Aligns with best practice but not structurally critical. |
| Low | 0.5x | Advisory. Nice-to-have, may not apply to all organizations. |
| Info | 0x | Informational. No score impact. Logged for awareness. |

### 5.3 Scanner Score Calculation

```
scanner_score = sum(check_weight * check_score) / sum(check_weight) * 100

Where:
  check_weight = severity_multiplier (3x, 2x, 1x, 0.5x, 0x)
  check_score  = 1.0 (Pass), 0.5 (Partial), 0.0 (Fail), excluded (NotApplicable, Error)
```

### 5.4 Total CLEAR Score

```
total_score = sum(scanner_weight * scanner_score) / sum(scanner_weight)
```

### 5.5 Maturity Tiers

| Tier | Name | Score Range | Description |
|------|------|-------------|-------------|
| 0 | No Landing Zone | 0-15 | Ad-hoc Azure usage. No management group hierarchy, no policies, no centralized services. |
| 1 | Basic | 16-35 | Some management groups exist. Basic policies (audit only). Manual processes. Minimal centralization. |
| 2 | Managed | 36-60 | ALZ hierarchy present but incomplete. Some policies enforced. Partial platform subscriptions. Some centralized services. |
| 3 | Optimized | 61-80 | Full ALZ hierarchy. Most policies in enforcement mode. All platform subscriptions. Automated subscription vending. IaC in use. |
| 4 | Enterprise-Scale | 81-100 | Fully compliant ALZ reference architecture. All policies enforced. Full automation. Continuous compliance monitoring. |

---

## 6. IaC Remediation

### 6.1 Remediation Hierarchy

For every failing check, CLEAR resolves remediation in priority order:

**Priority 1: Contica Template Stack**

Source: `Contica-AB/dynamic-infrastructure-template-stack` (dev branch)

The Knowledge Sync module indexes Contica's Bicep modules by resource type, mapping orchestrators and resource templates to ALZ requirements. When a failing check maps to a resource type that Contica's stack covers, CLEAR recommends the Contica module with specific parameter guidance.

```
Failing check: NT-002 (No Azure Firewall in hub)
Match: dynamic-infrastructure-template-stack/bicep/ResourceTemplates/AzureFirewall/
Recommendation: "Use your AzureFirewall resource template with the Connectivity blueprint"
```

**Priority 2: Template Gap Advisory**

When Contica's stack does not cover a required resource type, CLEAR flags it as a gap and advises what to add:

```
Failing check: RO-001 (No management group hierarchy)
Match: No ManagementGroup module in Contica stack
Advisory: "Your template stack is missing a Management Group orchestrator.
          Required capabilities: create 11 MGs, set hierarchy, configure settings.
          Reference: ALZ Library architecture_definitions/alz.*.json"
```

This drives continuous improvement of the template stack.

**Priority 3: Azure ALZ Accelerator / Azure Verified Modules**

For gaps the consultant needs to fix now:

- Policy assignments: Use exact JSON from `Azure-Landing-Zones-Library/policy_assignments/`
- Resources: Reference AVM module from the Bicep registry CSV index
- Full deployment: Generate ALZ Accelerator configuration YAML

```
Failing check: GP-001 (Missing 40 policy assignments)
Recommendation: "Deploy ALZ policies using the ALZ IaC Accelerator.
                Run: Deploy-Accelerator -IaC bicep -VCS github
                Or apply individual assignments from the ALZ Library."
```

**Priority 4: AI-Generated Custom Bicep (last resort)**

For edge cases neither stack covers. Clearly marked in the output:

```
⚠ AI-GENERATED: This Bicep was generated by AI based on the scan findings.
Review thoroughly before deploying. Not sourced from Contica templates or AVM.
```

### 6.2 Remediation Output Format

```csharp
public record RemediationRef(
    RemediationSource Source,            // ConticaStack, GapAdvisory, AlzAccelerator, Avm, AiGenerated
    string? ConticaModulePath,           // e.g., "bicep/ResourceTemplates/AzureFirewall/"
    string? AvmModuleReference,          // e.g., "br/public:avm/res/network/azure-firewall:1.2.0"
    string? AlzLibraryFile,              // e.g., "policy_assignments/Deploy-ASC-Monitoring.json"
    string? GapDescription,              // What Contica should add to their stack
    string? BicepSnippet,                // Generated Bicep code (Priority 4 only)
    string? Explanation                  // Why this remediation is recommended
);
```

---

## 7. AI Service Layer

### 7.1 Provider Interface

```csharp
public interface IAIProvider
{
    string ProviderId { get; }

    Task<AnalysisReport> AnalyzeResultsAsync(
        ScanResult scanData,
        AssessmentProfile? profile,
        CancellationToken ct);

    Task<RemediationPlan> GenerateRemediationAsync(
        GapReport gaps,
        ConticaTemplateIndex templateIndex,
        CancellationToken ct);

    IAsyncEnumerable<string> ChatStreamAsync(
        string message,
        ScanContext scanContext,
        List<ChatMessage> history,
        CancellationToken ct);

    Task<string> GenerateReportNarrativeAsync(
        ScanResult scanData,
        ReportTemplate template,
        CancellationToken ct);

    Task<InterviewResponse> ConductInterviewAsync(
        string userMessage,
        List<ChatMessage> history,
        CancellationToken ct);
}
```

### 7.2 Implementations

| Provider | SDK | Models |
|----------|-----|--------|
| `AnthropicProvider` | `Anthropic` NuGet | Claude Sonnet 4, Claude Opus 4 |
| `AzureOpenAIProvider` | `Azure.AI.OpenAI` NuGet | GPT-4o, o3, o4-mini |
| `GitHubModelsProvider` | HTTP client to `https://models.github.ai/inference/chat/completions` | GPT-4o, o3, o4-mini, Claude Sonnet 4 |

### 7.3 Configuration

```json
{
  "AI": {
    "DefaultProvider": "anthropic",
    "Anthropic": {
      "ApiKey": "${ANTHROPIC_API_KEY}",
      "Model": "claude-sonnet-4-20250514",
      "MaxTokens": 8192
    },
    "AzureOpenAI": {
      "Endpoint": "https://{name}.openai.azure.com/",
      "DeploymentName": "gpt-4o",
      "ApiKey": "${AZURE_OPENAI_API_KEY}"
    },
    "GitHubModels": {
      "Token": "${GITHUB_TOKEN}",
      "Model": "gpt-4o"
    }
  }
}
```

Provider is selectable globally or per-tenant via the settings page. Switching provider does not affect scan results (deterministic), only the AI analysis layer.

### 7.4 Prompt Architecture

System prompts are stored as Markdown files in `Clear.AI/Prompts/`. Each prompt receives structured scan data as context, never raw Azure API responses.

| Prompt | Purpose | Key Context Injected |
|--------|---------|---------------------|
| `InterviewSystemPrompt.md` | Pre-scan customer interview | None (discovery) |
| `AnalysisSystemPrompt.md` | Post-scan gap analysis | Full scan result JSON, maturity tier, assessment profile |
| `RemediationSystemPrompt.md` | Remediation plan generation | Gap report, Contica template index, AVM module index |
| `ReportNarrativePrompt.md` | Executive summary and report text | Scan result, maturity tier, scanner summaries |
| `ChatSystemPrompt.md` | Interactive Q&A about results | Current scan result, selected scanner context |

### 7.5 AI Boundaries

The AI layer has strict boundaries:

- AI NEVER calls Azure APIs. It receives pre-computed scan data only.
- AI NEVER modifies scan scores. Scores are deterministic.
- AI NEVER executes IaC deployments. It generates code for human review.
- AI analysis is clearly labeled as AI-generated in all outputs.
- AI prompts include the instruction: "Do not invent or assume data that is not present in the scan results provided."

---

## 8. Data Model

### 8.1 Database

- **Local:** SQLite via EF Core
- **Azure:** Azure SQL Database (serverless tier) via EF Core
- Switchable via connection string in `appsettings.json`. Same EF Core migrations run on both.

### 8.2 Entity Diagram

```
Tenant (1) ──── (*) Scan
  │                  │
  │                  ├── (*) ScannerResult
  │                  │         │
  │                  │         └── (*) CheckResult
  │                  │
  │                  ├── (1) AssessmentProfile
  │                  │
  │                  └── (*) Report
  │
  └── (*) TenantConfig (AI provider override, scan options)

AlzVersion (singleton - current synced version)
  │
  ├── (*) PolicyDefinitionCache
  ├── (*) PolicyAssignmentCache
  ├── (*) PolicySetDefinitionCache
  ├── (*) ArchetypeDefinitionCache
  ├── (*) RoleDefinitionCache
  ├── (*) ReviewChecklistItemCache
  └── (*) ConticaTemplateCache
```

### 8.3 Key Entities

```csharp
public class Tenant
{
    public Guid Id { get; set; }
    public string Name { get; set; }
    public string AzureTenantId { get; set; }
    public string? Description { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastScanAt { get; set; }
    public int? LastScore { get; set; }
    public MaturityTier? LastMaturityTier { get; set; }
}

public class Scan
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public ScanStatus Status { get; set; }          // Queued, Running, Completed, Failed
    public int? TotalScore { get; set; }
    public MaturityTier? MaturityTier { get; set; }
    public string? AlzLibraryVersion { get; set; }   // e.g., "platform/alz/2026.04.0"
    public string? AiAnalysisSummary { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public TimeSpan? Duration { get; set; }
}

public class ScannerResult
{
    public Guid Id { get; set; }
    public Guid ScanId { get; set; }
    public string ScannerId { get; set; }
    public int Score { get; set; }
    public Confidence Confidence { get; set; }
    public int TotalChecks { get; set; }
    public int PassedChecks { get; set; }
    public int FailedChecks { get; set; }
    public int PartialChecks { get; set; }
}

public class CheckResult
{
    public Guid Id { get; set; }
    public Guid ScannerResultId { get; set; }
    public string CheckId { get; set; }
    public string Name { get; set; }
    public CheckStatus Status { get; set; }
    public Severity Severity { get; set; }
    public string? ExpectedValue { get; set; }
    public string? ActualValue { get; set; }
    public string? Detail { get; set; }
    public RemediationSource? RemediationSource { get; set; }
    public string? RemediationDetail { get; set; }  // JSON blob
}

public class TenantConfig
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string? AiProvider { get; set; }           // Override global: "anthropic", "azureopenai", "githubmodels"
    public string? AiModel { get; set; }              // Override model for this tenant
    public string? DefaultScanScope { get; set; }     // "full" or specific MG/subscription IDs (JSON array)
    public string? ExcludedScanners { get; set; }     // JSON array of scanner IDs to skip
    public string? ExcludedChecks { get; set; }       // JSON array of check IDs to skip
    public string? ExcludedSubscriptions { get; set; }// JSON array of subscription IDs to exclude
    public string? Notes { get; set; }                // Free-form consultant notes
}

public class AssessmentProfile
{
    public Guid Id { get; set; }
    public Guid ScanId { get; set; }
    public string? OrganizationSize { get; set; }     // "small" (<50 subs), "medium" (50-200), "large" (200+)
    public string? Industry { get; set; }             // e.g., "finance", "healthcare", "manufacturing", "retail"
    public string? ComplianceFrameworks { get; set; } // JSON array: ["ISO27001", "SOC2", "GDPR", "HIPAA"]
    public bool HybridConnectivity { get; set; }      // Needs on-premises connectivity?
    public string? NetworkTopologyPreference { get; set; } // "hub-spoke", "vwan", "undecided"
    public string? IdentityModel { get; set; }        // "cloud-only", "hybrid-adds", "hybrid-entra-ds"
    public int? ExpectedWorkloadCount { get; set; }   // Number of application landing zones needed
    public string? ExistingAzureMaturity { get; set; }// "none", "basic", "moderate", "advanced"
    public string? SpecificConcerns { get; set; }     // Free-form from interview
    public string? InterviewTranscript { get; set; }  // Full AI interview conversation (JSON)
    public DateTimeOffset CreatedAt { get; set; }
}

public class Report
{
    public Guid Id { get; set; }
    public Guid ScanId { get; set; }
    public ReportFormat Format { get; set; }          // Pdf, Docx, Html
    public ReportType Type { get; set; }              // ExecutiveSummary, DetailedAssessment, RemediationPlan
    public ReportStatus Status { get; set; }          // Queued, Generating, Completed, Failed
    public string? StoragePath { get; set; }          // Local path or Blob Storage URL
    public long? FileSizeBytes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

public record ScanOptions(
    string Scope,                                     // "full" (all subscriptions) or "targeted"
    List<string>? TargetSubscriptionIds,              // If targeted: specific subscription IDs
    List<string>? TargetManagementGroupIds,           // If targeted: specific MG IDs
    List<string>? ExcludedScannerIds,                 // Scanner IDs to skip (e.g., "platform-automation")
    List<string>? ExcludedCheckIds,                   // Individual check IDs to skip (e.g., "NT-003")
    List<string>? ExcludedSubscriptionIds,            // Subscriptions to exclude from scanning
    bool IncludeAiAnalysis = true,                    // Run AI analysis after scan?
    bool IncludeRemediation = true                    // Generate remediation mapping?
);

public record KnowledgeSnapshot(
    string AlzLibraryVersion,                         // e.g., "platform/alz/2026.04.0"
    AlzArchitectureDefinition ArchitectureDefinition, // Expected MG hierarchy
    List<AlzArchetypeDefinition> Archetypes,          // All 11 archetype-to-policy mappings
    List<AlzPolicyDefinition> PolicyDefinitions,      // All 149 custom ALZ policy definitions
    List<AlzPolicySetDefinition> PolicySetDefinitions,// All 42 ALZ initiatives
    List<AlzPolicyAssignment> PolicyAssignments,      // All 79 policy assignment templates
    List<AlzRoleDefinition> RoleDefinitions,          // All 5 custom role definitions
    AlzPolicyDefaultValues DefaultValues,             // 15 parameterized defaults
    List<ReviewChecklistItem> ReviewChecklist,        // 48 items with KQL queries
    List<AvmModule> AvmModules,                       // 200+ AVM module references
    List<ConticaTemplate> ConticaTemplates            // Indexed Contica template stack
);
```

---

## 9. API Surface

### 9.1 REST Endpoints

**Tenants**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tenants` | List all tenants |
| `POST` | `/api/tenants` | Register a new tenant |
| `GET` | `/api/tenants/{id}` | Get tenant details + latest score |
| `PUT` | `/api/tenants/{id}` | Update tenant configuration |
| `DELETE` | `/api/tenants/{id}` | Remove tenant |

**Scans**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tenants/{id}/scans` | Start a new scan |
| `GET` | `/api/tenants/{id}/scans` | List scan history |
| `GET` | `/api/tenants/{id}/scans/{scanId}` | Get scan result summary |
| `GET` | `/api/tenants/{id}/scans/{scanId}/progress` | SSE stream of scan progress events (see Section 14) |
| `GET` | `/api/tenants/{id}/scans/{scanId}/scanners/{scannerId}` | Get scanner detail with all checks |
| `GET` | `/api/tenants/{id}/scans/{scanId}/gaps` | Get gap report for remediation |
| `GET` | `/api/tenants/{id}/scans/{scanId}/compare/{previousScanId}` | Compare two scans (score delta, new/resolved findings) |

**AI**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tenants/{id}/interview` | AI interview message (stateless - frontend sends full history each request) |
| `POST` | `/api/tenants/{id}/scans/{scanId}/analyze` | Trigger AI analysis of scan results |
| `POST` | `/api/tenants/{id}/scans/{scanId}/chat` | Chat with AI about scan results (SSE stream) |
| `POST` | `/api/tenants/{id}/scans/{scanId}/remediation` | Generate AI remediation plan |

**Reports**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tenants/{id}/scans/{scanId}/reports` | Generate report (specify format: pdf, docx, html) |
| `GET` | `/api/tenants/{id}/scans/{scanId}/reports/{reportId}` | Download generated report |

**Knowledge**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/knowledge/status` | Current ALZ Library version, sync status, file counts |
| `POST` | `/api/knowledge/sync` | Trigger manual sync |
| `GET` | `/api/knowledge/contica-templates` | Indexed Contica template stack |

**Settings**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Current configuration |
| `PUT` | `/api/settings/ai` | Update AI provider configuration |
| `PUT` | `/api/settings/azure` | Update Azure app registration details |

---

## 10. Deployment

### 10.1 Local (Docker Compose)

```yaml
services:
  clear-api:
    build:
      context: ./clear-api
      dockerfile: Dockerfile
    ports:
      - "5000:5000"
    volumes:
      - ./data:/app/data
      - ./reports:/app/reports
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - Database__Provider=sqlite
      - Database__ConnectionString=Data Source=/app/data/clear.db
      - Azure__TenantId=${AZURE_TENANT_ID}
      - Azure__ClientId=${AZURE_CLIENT_ID}
      - Azure__ClientSecret=${AZURE_CLIENT_SECRET}
      - AI__DefaultProvider=${AI_PROVIDER:-anthropic}
      - AI__Anthropic__ApiKey=${ANTHROPIC_API_KEY}
      - AI__AzureOpenAI__Endpoint=${AZURE_OPENAI_ENDPOINT}
      - AI__AzureOpenAI__ApiKey=${AZURE_OPENAI_API_KEY}
      - AI__GitHubModels__Token=${GITHUB_TOKEN}
      - Reports__Store=local
      - Reports__LocalPath=/app/reports
      - Knowledge__AlzLibrary__Tag=latest

  clear-web:
    build:
      context: ./clear-web
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - API_URL=http://clear-api:5000
      - NEXT_PUBLIC_API_URL=http://localhost:5000
    depends_on:
      - clear-api
```

Start: `docker compose up --build`

### 10.2 Azure (Container Apps)

Same Docker images. Configuration via Azure Key Vault and Container Apps environment variables.

```
Azure Container Apps Environment
├── clear-api
│   ├── Image: conticaacr.azurecr.io/clear-api:latest
│   ├── Scale: 0-3 replicas (scale to zero when idle)
│   ├── Ingress: internal only (clear-web talks to it)
│   ├── CPU: 1.0, Memory: 2Gi
│   └── Environment variables from Key Vault
│
├── clear-web
│   ├── Image: conticaacr.azurecr.io/clear-web:latest
│   ├── Scale: 0-2 replicas
│   ├── Ingress: external (HTTPS, Entra ID auth)
│   ├── CPU: 0.5, Memory: 1Gi
│   └── API_URL=http://clear-api:5000 (internal)
│
├── Azure SQL Database (serverless tier, auto-pause after 1h idle)
├── Azure Key Vault (all secrets)
├── Azure Blob Storage (generated reports)
├── Azure Container Registry (Docker images)
└── App Registration
    ├── Redirect URIs for Entra ID auth on clear-web
    └── API permissions: Reader on customer tenants
```

IaC for the Azure infrastructure is Bicep, stored in `infrastructure/`. Deployed via GitHub Actions.

### 10.3 Infrastructure Abstraction

| Concern | Interface | Local Implementation | Azure Implementation |
|---------|-----------|---------------------|---------------------|
| Database | EF Core `DbContext` | SQLite provider | Azure SQL provider |
| Report storage | `IReportStore` | `LocalFileReportStore` | `BlobStorageReportStore` |
| Secrets | `ISecretProvider` | `EnvFileSecretProvider` | `KeyVaultSecretProvider` |
| Auth | `IAuthProvider` | `DevBypassAuthProvider` | `EntraIdAuthProvider` |

Switched via `appsettings.json` / environment variables. No code changes between environments.

### 10.4 Estimated Azure Costs (Idle)

| Resource | Tier | Idle Cost (SEK/month) |
|----------|------|----------------------|
| Container Apps (2 containers, scale-to-zero) | Consumption | ~0 |
| Azure SQL (serverless, auto-pause) | General Purpose Serverless | ~50 |
| Blob Storage | Hot, minimal data | ~5 |
| Key Vault | Standard | ~5 |
| Container Registry | Basic | ~40 |
| **Total idle** | | **~100 SEK/month** |

Active scanning adds per-scan costs from Azure API calls (metered) and AI provider usage (per-token).

---

## 11. Azure Authentication

### 11.1 App Registration

CLEAR uses a multi-tenant Entra ID app registration to access customer Azure tenants.

**Required API permissions (delegated or application):**

| API | Permission | Type | Purpose |
|-----|-----------|------|---------|
| Azure Service Management | `user_impersonation` | Delegated | Azure REST API access |
| Microsoft Graph | `Directory.Read.All` | Application | Entra ID configuration, CA policies, PIM |
| Microsoft Graph | `Policy.Read.All` | Application | Conditional Access policies |
| Microsoft Graph | `RoleManagement.Read.All` | Application | PIM, role assignments |
| Microsoft Graph | `AuditLog.Read.All` | Application | Sign-in and audit logs |

**Customer onboarding flow:**

1. Customer grants admin consent for the CLEAR app registration in their Entra ID tenant
2. App receives Reader role on the customer's root management group (or specific subscriptions)
3. CLEAR stores the tenant ID and credential reference
4. Scanning uses `ClientSecretCredential` or `ManagedIdentityCredential` (Azure) to authenticate

### 11.2 Required Azure RBAC

| Role | Scope | Purpose |
|------|-------|---------|
| Reader | Root Management Group (or all subscriptions) | Resource Graph queries, resource enumeration |
| Security Reader | Root Management Group | Defender for Cloud, Secure Score |
| Policy Reader | Root Management Group | Policy definitions, assignments, compliance |

No write permissions required for assessment. Write permissions only needed if CLEAR ever deploys remediation (future scope).

---

## 12. Frontend Pages

### 12.1 Route Map

| Route | Page | SSR | Description |
|-------|------|-----|-------------|
| `/` | Dashboard | Yes | All tenants overview. Cards with name, last score, maturity badge, last scan date. |
| `/tenants/[id]` | Tenant Detail | Yes | Score trend chart, 8 scanner breakdown (radar chart), recent scans list. |
| `/tenants/[id]/scan` | New Scan | No | Optional AI interview wizard, then scan trigger. Real-time progress (SSE). |
| `/tenants/[id]/results/[scanId]` | Scan Results | Yes | 8 scanner cards with scores. Maturity tier badge. AI analysis summary. |
| `/tenants/[id]/results/[scanId]/[scanner]` | Scanner Detail | Yes | Every check in a table: ID, name, status (pass/fail/partial), severity, detail, remediation link. |
| `/tenants/[id]/remediation` | Remediation Plan | Yes | AI-generated prioritized plan. Timeline view. IaC code blocks per gap. Template stack matching. |
| `/tenants/[id]/reports` | Reports | No | Generate and download PDF/Word/HTML. Preview before export. |
| `/tenants/[id]/chat` | AI Chat | No | Streaming chat panel. Full scan context. Ask questions about results. |
| `/knowledge` | Knowledge Base | Yes | ALZ Library version, last sync, file counts, Contica template index. Manual sync trigger. |
| `/settings` | Settings | No | Azure app registration, AI provider config, default scan options. |

### 12.2 Key UI Components

- **ScoreGauge** - Circular gauge (0-100) with color gradient (red → yellow → green)
- **MaturityBadge** - Tier 0-4 badge with label and color
- **ScannerRadar** - Radar chart showing all 8 scanner scores
- **CheckTable** - Sortable, filterable table of checks per scanner with status icons
- **ScoreTrend** - Line chart showing CLEAR score over time per tenant
- **RemediationTimeline** - Vertical timeline of remediation steps, ordered by priority
- **IaCViewer** - Syntax-highlighted Bicep code viewer with copy button and source attribution
- **InterviewWizard** - Step-by-step AI-guided conversation before scan
- **ChatPanel** - Streaming chat interface with scan context awareness

---

## 13. Report Templates

### 13.1 Executive Summary (1-2 pages)

Target audience: CTO, IT Director, decision makers.

Contents:
- Customer name, assessment date, CLEAR version, ALZ Library version
- Overall CLEAR Score and Maturity Tier (large, prominent)
- Radar chart of 8 scanner scores
- Top 5 critical findings (one sentence each)
- Recommended next steps (3-5 bullet points)
- Contica contact information

### 13.2 Detailed Assessment Report (10-30 pages)

Target audience: Azure architects, platform engineers.

Contents:
- Executive summary (as above)
- Per-scanner sections:
  - Scanner score and confidence level
  - Every check with status, severity, expected vs actual, and detail
  - Findings grouped by severity (Critical first)
  - AI-generated commentary per scanner
- Policy compliance appendix (full diff of expected vs actual assignments)
- Resource inventory summary (subscriptions, resource groups, key resources)
- ALZ Library version used for assessment

### 13.3 Remediation Plan (5-15 pages)

Target audience: Implementation team.

Contents:
- Current state summary (maturity tier, score, key gaps)
- Target state definition (customized ALZ architecture based on interview)
- Brownfield transition scenario recommendation
- Prioritized remediation roadmap:
  - Phase 1: Foundation (management groups, core policies)
  - Phase 2: Security (Defender, identity hardening)
  - Phase 3: Networking (hub deployment, DNS centralization)
  - Phase 4: Operations (monitoring, backup, automation)
- Per-phase IaC references (Contica templates, AVM modules, ALZ Library files)
- Template stack gap list (what Contica should add)
- Estimated effort per phase

---

## 14. Scan Progress and Real-Time Events

### 14.1 SSE Endpoint

```
GET /api/tenants/{id}/scans/{scanId}/progress
Content-Type: text/event-stream
```

### 14.2 Event Schema

```json
{ "event": "scan_started",      "data": { "scanId": "...", "scannerCount": 8 } }
{ "event": "scanner_started",   "data": { "scannerId": "governance-policy", "displayName": "Governance" } }
{ "event": "scanner_progress",  "data": { "scannerId": "governance-policy", "checksCompleted": 7, "checksTotal": 14 } }
{ "event": "scanner_completed", "data": { "scannerId": "governance-policy", "score": 72, "confidence": "high" } }
{ "event": "scanner_failed",    "data": { "scannerId": "identity-access", "error": "Graph API permission denied" } }
{ "event": "scan_completed",    "data": { "totalScore": 67, "maturityTier": 2, "duration": "PT3M42S" } }
{ "event": "scan_failed",       "data": { "error": "All scanners failed", "partialResults": false } }
```

Scanners run in parallel. Events arrive as each scanner progresses and completes. The frontend displays a real-time progress view with per-scanner status indicators.

---

## 15. Error Handling and Resilience

### 15.1 Scanner Error Handling

- If an individual check throws an exception, it is caught and recorded as `CheckStatus.Error` with the exception message in `Detail`. The scanner continues to the next check.
- Errored checks are excluded from the scanner score calculation (neither pass nor fail). They reduce the denominator, not the numerator.
- Scanner `Confidence` degrades based on error rate:
  - 0% errors → `High`
  - 1-20% errors → `Medium`
  - &gt;20% errors → `Low`
- If all checks in a scanner error, the scanner result is `Status: Failed` with `Score: null` and `Confidence: Low`. It is excluded from the total CLEAR score.
- The total CLEAR score only includes scanners that produced a score. If 6 of 8 scanners succeed, the total is a weighted average of those 6 (with weights re-normalized).

### 15.2 Azure API Rate Limiting and Retry

- All Azure SDK clients use `Azure.Core` retry policies with exponential backoff (default: 3 retries, 800ms initial delay, 2x multiplier).
- Azure Resource Graph queries are batched: max 3 concurrent queries, with 429 backoff.
- Microsoft Graph API calls use the Microsoft Graph SDK's built-in retry handler.
- Azure Policy API calls across many subscriptions are parallelized with `SemaphoreSlim(maxConcurrency: 5)` to avoid throttling.

### 15.3 GitHub API Rate Limiting

- Knowledge sync uses authenticated requests (GitHub PAT or App token) for 5,000 requests/hour.
- File fetches use raw.githubusercontent.com (CDN, no rate limit) instead of the GitHub API where possible.
- If rate-limited during sync, the operation pauses and resumes when the rate limit resets (X-RateLimit-Reset header).

### 15.4 AI Provider Resilience

- AI provider timeout: 60 seconds per request, 120 seconds for report generation.
- If the configured AI provider fails, CLEAR does not fall back to another provider automatically. The scan completes without AI analysis, and the user is notified.
- AI analysis can be triggered separately after scan completion via `POST /api/tenants/{id}/scans/{scanId}/analyze`.

---

## 16. Testing Strategy

### 16.1 Backend Testing (.NET)

**Unit tests (xUnit + FluentAssertions + NSubstitute):**
- Each scanner tested against recorded Azure API responses (snapshot/fixture approach)
- `ScanContext` is constructed with mock Azure clients that return fixture JSON
- Scoring engine tested with synthetic `ScannerResult` data covering edge cases (all pass, all fail, mixed, errored checks)
- Diff engines tested against known ALZ Library snapshots vs known tenant states
- AI provider interface tested via mock implementations (no real API calls in unit tests)

**Fixture data:**
- `tests/fixtures/azure-responses/` - Recorded JSON responses from Azure APIs (anonymized)
- `tests/fixtures/alz-library/` - Snapshot of ALZ Library at a specific version for deterministic testing
- `tests/fixtures/tenants/` - Synthetic tenant configurations representing each maturity tier (0-4)

**Integration tests:**
- Knowledge sync against a test GitHub repo (or recorded HTTP responses via WireMock)
- EF Core migrations tested against both SQLite and SQL Server (CI uses both)
- Report generation tested end-to-end (generate PDF/Word, verify structure)

### 16.2 Frontend Testing (Next.js)

**Component tests (Vitest + Testing Library):**
- Key components: ScoreGauge, CheckTable, ScannerRadar, MaturityBadge
- Page-level tests with mocked API responses

**E2E tests (Playwright):**
- Full scan flow: create tenant → run scan → view results → export report
- AI chat interaction (mocked AI provider)

### 16.3 Test Environments

- **CI (GitHub Actions):** Unit tests + integration tests on every PR. SQLite for fast tests, SQL Server container for DB integration tests.
- **Local dev:** `docker compose -f docker-compose.test.yml up` runs all tests in containers.
- **No real Azure tenant required for testing.** All Azure API interactions are abstracted and mockable. Integration tests with a real tenant are optional and run manually.

---

## 17. Non-Functional Requirements

### 17.1 Performance

- Full tenant scan (all 8 scanners, parallel): &lt; 5 minutes for tenants with &lt; 50 subscriptions
- Knowledge sync: &lt; 2 minutes (incremental, only fetch changed files)
- Report generation: &lt; 30 seconds
- AI chat response: streaming, first token &lt; 2 seconds

### 17.2 Security

- No customer data leaves the local machine (local mode)
- Azure credentials stored in environment variables (local) or Key Vault (Azure)
- AI provider API keys stored in environment variables (local) or Key Vault (Azure)
- Customer tenant data (scan results) stored in local SQLite or Azure SQL (Contica's subscription, not customer's)
- No scan data sent to AI providers except as structured context for analysis (no raw Azure API responses)
- HTTPS enforced in Azure deployment
- CORS configured on the API to allow requests from the frontend origin only

### 17.3 Reliability

- Scan failures are per-scanner, not total. If one scanner fails (e.g., Graph API permission missing), the other 7 still produce results.
- Each scanner has a `Confidence` level that degrades based on check error rate (see Section 15.1).
- Overall scan confidence is the minimum confidence across all included scanners.
- Knowledge sync failures do not block scanning. CLEAR uses the last successfully synced version.
- AI provider failures do not block scanning or report generation. AI analysis is optional enhancement.

### 17.4 Extensibility

- New scanners implement `IScannerModule` and are registered via DI.
- New AI providers implement `IAIProvider` and are registered via `AIProviderFactory`.
- New report formats implement a report generator interface.
- New remediation sources (e.g., Terraform modules) add to the `TemplateResolver` chain.
- Review checklist items from `Azure/review-checklists` provide additional KQL queries that can be added as checks to existing scanners.

### 17.5 Versioning

CLEAR uses SemVer (`MAJOR.MINOR.PATCH`):
- MAJOR: Breaking changes to scan output schema or scoring model
- MINOR: New scanners, new checks, new features
- PATCH: Bug fixes, knowledge sync updates

The CLEAR version and ALZ Library version are both recorded on every scan result and every generated report.

---

## 18. Technology Stack

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| Backend API | ASP.NET Core | .NET 8+ | Contica's core competency, first-class Azure SDK |
| Azure SDK | `Azure.ResourceManager.*` | Latest | Typed clients for all Azure APIs |
| Resource Graph | `Azure.ResourceManager.ResourceGraph` | Latest | KQL queries across subscriptions |
| Microsoft Graph | `Microsoft.Graph` | Latest | Identity, CA policies, PIM, RBAC |
| ORM | Entity Framework Core | 8+ | SQLite + SQL Server with same migrations |
| AI (Anthropic) | `Anthropic` NuGet | Latest | Claude API access |
| AI (Azure OpenAI) | `Azure.AI.OpenAI` | Latest | Azure OpenAI access |
| AI (GitHub Models) | `System.Net.Http` | Built-in | REST client to GitHub Models API |
| Report (PDF) | QuestPDF | Latest | MIT-licensed PDF generation |
| Report (Word) | DocumentFormat.OpenXml | Latest | Word document generation |
| Resilience | Polly | Latest | Retry policies, circuit breakers |
| Frontend | Next.js | 15+ | SSR, App Router, React Server Components |
| UI Components | shadcn/ui + Tailwind CSS | Latest | Clean, professional component library |
| Charts | Recharts | Latest | Score gauges, radar charts, trend lines |
| Code Highlighting | Shiki | Latest | Bicep syntax highlighting in IaC viewer |
| Database (local) | SQLite | via EF Core | Zero-config local database |
| Database (Azure) | Azure SQL Database | Serverless | Auto-pause, cost-efficient |
| Testing (backend) | xUnit + FluentAssertions + NSubstitute | Latest | .NET standard test stack |
| Testing (frontend) | Vitest + Testing Library + Playwright | Latest | Component + E2E testing |
| Containerization | Docker | Multi-stage builds | Consistent local and cloud deployment |
| CI/CD | GitHub Actions | N/A | Build, test, deploy pipeline |
| IaC (Azure infra) | Bicep | Latest | Azure deployment (eating own dog food) |

---

## 19. Future Scope (Out of Scope for v1)

These items are acknowledged but explicitly deferred:

- **Automated remediation execution** - CLEAR generates IaC but does not deploy it. Deployment is manual.
- **Continuous compliance monitoring** - Scheduled re-scans with drift alerting. Requires hosted deployment.
- **Multi-user collaboration** - v1 is single-user. Multi-user with role-based access deferred.
- **Customer self-service portal** - v1 is consultant-only. Customer-facing portal deferred.
- **Terraform output** - v1 generates Bicep only. Terraform module mapping deferred.
- **MCP server interface** - Exposing CLEAR as an MCP server for Claude Code / Copilot. Nice-to-have, not v1.
- **Azure Marketplace listing** - Publishing CLEAR as a managed application. Deferred.
- **Integration with Contica's other tools** - Connecting CLEAR to cost-assessor, Bixray, etc. Deferred.
- **Sovereign Landing Zones (SLZ)** - The ALZ Library includes SLZ data. Support deferred.
