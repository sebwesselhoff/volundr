# CLEAR Roundtable Review Findings

**Date:** 2026-04-16
**Spec:** `2026-04-16-clear-design.md`
**Reviewers:** Azure Architect, Security Architect, .NET Backend Engineer, Frontend Engineer, DevOps Engineer
**Mandate:** Improve and harden. No functionality removed.

---

## How to Read This Document

Each finding has:
- **ID**: `{expert}-{number}` (e.g., `AZ-01`, `SEC-05`, `NET-12`)
- **Priority**: `P0` (must-have v1), `P1` (strongly recommended v1), `P2` (v1.1 or hardening sprint)
- **Category**: Which part of the spec it affects
- **Status**: `pending` (not yet applied), `applied` (merged into spec), `deferred` (acknowledged, not v1)

When implementing, filter by priority. P0 items block v1 ship. P1 items should be in v1 if time permits. P2 items are post-launch.

---

## Part 1: New Scanner Checks

These are additional checks identified by the Azure Architect and Security Architect. They expand the existing 8 scanners without adding new scanners.

### Scanner 2: Identity & Access (currently 11 checks → 31 checks)

| ID | Check ID | Check | API | Severity | Priority | Expert |
|----|----------|-------|-----|----------|----------|--------|
| SEC-01 | IA-012 | Entra ID P2 license detected (gates PIM/IdP checks) | Graph: `GET /subscribedSkus` | High | P0 | Security |
| AZ-01 | IA-013 | Identity Protection sign-in risk policy enabled | Graph: CA policies filtered `conditions.signInRiskLevels` | High | P0 | Azure |
| AZ-02 | IA-014 | Identity Protection user risk policy enabled | Graph: CA policies filtered `conditions.userRiskLevels` | High | P0 | Azure |
| SEC-02 | IA-015 | Risky users count is zero or actively monitored | Graph: `GET /identityProtection/riskyUsers?$filter=riskState eq 'atRisk'` | Medium | P1 | Security |
| SEC-03 | IA-016 | Service principals with expired credentials | Graph: `GET /servicePrincipals?$select=passwordCredentials,keyCredentials` | High | P0 | Security |
| SEC-04 | IA-017 | SPs with credentials expiring within 30 days | Graph: same, filter `endDateTime` | Medium | P1 | Security |
| SEC-05 | IA-018 | SPs with no sign-in activity > 90 days (requires P2) | Graph: `GET /reports/servicePrincipalSignInActivities` | Medium | P1 | Security |
| SEC-06 | IA-019 | No SPs with Owner/Contributor at root MG scope | Resource Graph: `authorizationresources` | Critical | P0 | Security |
| SEC-07 | IA-020 | Managed Identity preferred over SP with secrets | Resource Graph: MI count vs SP-with-password count | Medium | P1 | Security |
| AZ-03 | IA-021 | Named locations configured for CA | Graph: `GET /identity/conditionalAccess/namedLocations` | Medium | P1 | Azure |
| AZ-04 | IA-022 | CA policy restricting sign-ins by location | Graph: CA policies with `conditions.locations` | Medium | P1 | Azure |
| SEC-08 | IA-023 | Authentication methods policy configured | Graph: `GET /policies/authenticationMethodsPolicy` | Medium | P1 | Security |
| SEC-09 | IA-024 | FIDO2 or Windows Hello enabled | Graph: authenticationMethodConfigurations | Medium | P1 | Security |
| SEC-10 | IA-025 | Legacy per-user MFA disabled (superseded by CA) | Manual check with guidance | Low | P2 | Security |
| SEC-11 | IA-026 | Self-service password reset (SSPR) enabled | Graph: authenticationMethodsPolicy | Low | P2 | Security |
| SEC-12 | IA-027 | CA policy blocking legacy authentication | Graph: CA with `clientAppTypes` = exchangeActiveSync/other, grant = block | High | P0 | Security |
| SEC-13 | IA-028 | CA policy requiring compliant/Entra-joined device | Graph: CA with device compliance grant control | Medium | P1 | Security |
| SEC-14 | IA-029 | CA policy requiring app protection for mobile | Graph: CA with `appProtectionPolicy` grant | Low | P2 | Security |
| SEC-15 | IA-030 | CA policies cover admin portals | Graph: CA `conditions.applications` contains admin portal app IDs | High | P0 | Security |
| SEC-16 | IA-031 | CA policy coverage breadth (composite) | Graph: aggregate analysis of all CA policies | High | P1 | Security |
| AZ-05 | IA-032 | Access reviews configured for privileged roles | Graph: `GET /identityGovernance/accessReviews/definitions` | Medium | P2 | Azure |
| AZ-06 | IA-033 | No permanent Global Admin assignments (all via PIM) | Graph: roleAssignments cross-ref PIM eligible | Medium | P2 | Azure |

**New Graph permissions required:**

| Permission | Type | Purpose | Priority |
|-----------|------|---------|----------|
| `Application.Read.All` | Application | SP credential inspection (IA-016 to IA-020) | P0 |
| `SecurityEvents.Read.All` | Application | Secure Score, security alerts | P0 |
| `IdentityRiskyUser.Read.All` | Application | Identity Protection risky users (IA-015) | P1 |
| `Reports.Read.All` | Application | SP sign-in activity (IA-018) | P1 |
| `UserAuthenticationMethod.Read.All` | Application | Break-glass verification, auth methods | P1 |
| `AccessReview.Read.All` | Application | Access reviews (IA-032) | P2 |

**License-gating pattern:** If IA-012 detects no P2 license, checks IA-013, IA-014, IA-015, IA-018, IA-032, IA-033 report `NotApplicable` with explanation (not `Error`). This prevents confidence degradation.

### Scanner 3: Network Topology (currently 14 checks → 20 checks)

| ID | Check ID | Check | API | Severity | Priority | Expert |
|----|----------|-------|-----|----------|----------|--------|
| AZ-07 | NT-015 | UDRs force traffic through hub firewall | Resource Graph: `microsoft.network/routetables` routes to firewall IP | High | P1 | Azure |
| AZ-08 | NT-016 | No direct internet routes in Corp subnets | Resource Graph: route table analysis | Medium | P1 | Azure |
| SEC-17 | NT-017 | No NSGs with "Allow Any Any" inbound rules | Resource Graph: NSG rule analysis | High | P0 | Security |
| SEC-18 | NT-018 | NSGs deny blanket VNet-to-VNet in Corp | Resource Graph: NSG rule analysis | Medium | P1 | Security |
| SEC-19 | NT-019 | Application Security Groups used for segmentation | Resource Graph: `microsoft.network/applicationsecuritygroups` | Low | P2 | Security |
| AZ-09 | NT-020 | Azure DNS Private Resolver deployed (if hybrid DNS) | Resource Graph: `microsoft.network/dnsresolvers` | Medium | P2 | Azure |
| SEC-20 | NT-021 | Private DNS zones linked to hub/spoke VNets | Resource Graph: `microsoft.network/privatednszones/virtualnetworklinks` | Medium | P1 | Security |

### Scanner 4: Security (currently 13 checks → 24 checks)

| ID | Check ID | Check | API | Severity | Priority | Expert |
|----|----------|-------|-----|----------|----------|--------|
| AZ-10 | SC-014 | Defender Secure Score >= 70% | REST: `/providers/Microsoft.Security/secureScores/ascScore` | High | P0 | Azure |
| AZ-11 | SC-015 | No critical Defender recommendations unresolved > 30d | Resource Graph: `SecurityResources` assessments | Medium | P0 | Azure |
| AZ-12 | SC-016 | Defender CSPM plan enabled | REST: `/providers/Microsoft.Security/pricings/CloudPosture` | Medium | P1 | Azure |
| SEC-21 | SC-017 | Regulatory compliance standards assigned in Defender | REST: `/providers/Microsoft.Security/regulatoryComplianceStandards` | Medium | P1 | Security |
| SEC-22 | SC-018 | Regulatory compliance pass rate > 70% | Same API, aggregate passedControls/totalControls | Medium | P1 | Security |
| SEC-23 | SC-019 | Purview DLP policies exist (if E5 licensed) | Graph: informationProtection | Low | P2 | Security |
| SEC-24 | SC-020 | Sensitivity labels published (if AIP licensed) | Graph: sensitivityLabels | Low | P2 | Security |
| SEC-25 | SC-021 | Storage accounts disallow public blob access | Resource Graph: `allowBlobPublicAccess: false` | High | P0 | Security |
| SEC-26 | SC-022 | Storage accounts use minimum TLS 1.2 | Resource Graph: `minimumTlsVersion: TLS1_2` | High | P0 | Security |
| SEC-27 | SC-023 | Storage accounts restrict network access | Resource Graph: `networkAcls.defaultAction: Deny` | Medium | P1 | Security |
| AZ-13 | SC-024 | Defender for Servers covers Arc-enabled machines | Resource Graph: SecurityResources for Arc scope | Medium | P1 | Azure |

### Scanner 5: Management & Monitoring (currently 10 checks → 15 checks)

| ID | Check ID | Check | API | Severity | Priority | Expert |
|----|----------|-------|-----|----------|----------|--------|
| AZ-14 | MM-011 | Central Log Analytics retention >= 90 days | Resource Graph: workspace `retentionInDays` | Medium | P1 | Azure |
| AZ-15 | MM-012 | Data Collection Rules configured for VM monitoring | Resource Graph: `microsoft.insights/datacollectionrules` | Medium | P1 | Azure |
| AZ-16 | MM-013 | Action groups configured for alert notifications | Resource Graph: `microsoft.insights/actiongroups` | Medium | P1 | Azure |
| AZ-17 | MM-014 | Arc-enabled servers have AMA extension | Resource Graph: hybridcompute/machines + extensions | Medium | P1 | Azure |
| AZ-18 | MM-015 | Arc-enabled servers report connected status | Resource Graph: `properties.status == 'Connected'` | Medium | P1 | Azure |

### Scanner 6: Governance (currently 14 checks → 20 checks)

| ID | Check ID | Check | API | Severity | Priority | Expert |
|----|----------|-------|-----|----------|----------|--------|
| AZ-19 | GP-015 | Policy exemption audit (expired, permanent waivers) | REST: `policyExemptions` at MG/sub scope | High | P0 | Azure |
| AZ-20 | GP-016 | Exemption-to-assignment ratio < 10% | Computed from GP-015 data | Medium | P0 | Azure |
| AZ-21 | GP-017 | No policy overrides weaken Deny/DINE effects | REST: assignment `properties.overrides` | High | P1 | Azure |
| AZ-22 | GP-018 | Resource selectors don't exclude critical types | REST: assignment `properties.resourceSelectors` | Medium | P1 | Azure |
| AZ-23 | GP-019 | Resource groups have required tags | Resource Graph: `resourcecontainers` tag analysis | Medium | P1 | Azure |
| AZ-24 | GP-020 | Tag inheritance policies configured | Policy compliance for Inherit-Resource-Group-Tags | Low | P2 | Azure |

### Scanner 1: Resource Organization (currently 15 checks → 17 checks)

| ID | Check ID | Check | API | Severity | Priority | Expert |
|----|----------|-------|-----|----------|----------|--------|
| AZ-25 | RO-016 | Subscription count < 80% of 10,000 limit | Resource Graph: count | Low | P2 | Azure |
| AZ-26 | RO-017 | Subscription placement heuristic (Corp vs Online) | Resource Graph: resource analysis per sub | Info | P2 | Azure |

### Scanner 8: Business Continuity (currently 7 checks → 10 checks)

| ID | Check ID | Check | API | Severity | Priority | Expert |
|----|----------|-------|-----|----------|----------|--------|
| AZ-27 | BC-008 | Backup vault immutability enabled | Resource Graph: vault securitySettings | Medium | P1 | Azure |
| AZ-28 | BC-009 | Cross-region restore enabled on GRS vaults | Recovery Services API: backupStorageConfig | Medium | P1 | Azure |
| AZ-29 | BC-010 | Arc-enabled servers included in backup | Resource Graph: Arc + backup coverage | Medium | P1 | Azure |

**Check count summary:**

| Scanner | Current | After Roundtable | Delta |
|---------|---------|-----------------|-------|
| Resource Organization | 15 | 17 | +2 |
| Identity & Access | 11 | 33 | +22 |
| Network Topology | 14 | 21 | +7 |
| Security | 13 | 24 | +11 |
| Management & Monitoring | 10 | 15 | +5 |
| Governance (Policy) | 14 | 20 | +6 |
| Platform Automation | 5 | 5 | 0 |
| Business Continuity | 7 | 10 | +3 |
| **Total** | **89** | **145** | **+56** |

---

## Part 2: Architecture & Infrastructure Changes

### Authentication & Multi-Tenant Access

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| AZ-30 | Add Azure Lighthouse as first-class alternative to app registration. Add `IAuthStrategy` with `AppRegistrationAuthStrategy` and `LighthouseAuthStrategy`. Add `TenantAccessMethod` enum to `Tenant` entity. | P0 | Azure |
| AZ-31 | Lighthouse enables cross-tenant Resource Graph queries (portfolio view). Design `ResourceGraphClient` with `TenantScope` parameter. Note: Graph API (identity checks) always requires per-tenant auth even with Lighthouse. | P1 | Azure |
| SEC-28 | Prefer certificate credentials over client secrets. Change default to `ClientCertificateCredential`. Keep secret as explicit fallback. | P1 | Security |
| SEC-29 | For Azure deployment, use User-Assigned Managed Identity (not client secret). Update Bicep modules. | P0 | Security |
| SEC-30 | Document credential precedence chain: Azure = Managed Identity → Certificate. Local = Azure CLI → Client secret from env. | P0 | Security |
| NET-01 | Use `ChainedTokenCredential` with explicit chain, not `DefaultAzureCredential` (slow in containers). Register as singleton. | P0 | .NET |
| NET-02 | Add `TenantCredentialCache` (ConcurrentDictionary) for multi-tenant scanning. | P1 | .NET |

### Sovereign Cloud Support

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| AZ-32 | Add `AzureEnvironment` record with all cloud-specific endpoints (ARM, Graph, Auth, Storage, KeyVault). Never hardcode `management.azure.com`. Store `CloudEnvironment` on `Tenant` entity. | P0 | Azure |
| AZ-33 | Reserve `CloudApplicability` field on `PolicyDefinitionCache` for future sovereign policy filtering. | P2 | Azure |

### Knowledge Sync Improvements

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| AZ-34 | Handle multiple architecture definitions (glob `*.alz_architecture_definition.json`, not hardcoded single file). Change `ArchitectureDefinition` to `List<AlzArchitectureDefinition>`. | P0 | Azure |
| AZ-35 | Add `definitionVersion` field to `AlzPolicyDefinition` and `AlzPolicySetDefinition`. Use API version `2025-11-01` for policy queries. | P0 | Azure |
| AZ-36 | Add AMBA model: `AmbaAlertDefinitionCache` entity, `AmbaAlertDefinition` model, `List<AmbaAlertDefinition>` in `KnowledgeSnapshot`. | P1 | Azure |
| AZ-37 | Design SLZ-aware data model: `PlatformType` enum, `platformPath` column, `dependencies` parsing. Don't implement SLZ sync yet, just make the schema extensible. | P1 | Azure |
| AZ-38 | Pin scan results to the `KnowledgeSnapshot` version used at scan time. Display warning when comparing scans with different ALZ Library versions. | P0 | Azure |

### Azure API Corrections

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| AZ-39 | Correct MG hierarchy settings API path: `GET /providers/Microsoft.Management/managementGroups/{tenantRootGroupId}/settings?api-version=2023-04-01` | P0 | Azure |
| AZ-40 | Pin all Policy API calls to specific versions: definitions `2025-11-01`, assignments `2024-05-01`, states `2024-10-01`, exemptions `2022-07-01-preview`, remediations `2024-10-01` | P0 | Azure |
| AZ-41 | Defender pricing API: use `2024-01-01`. Dynamically enumerate plans (don't hardcode list). | P1 | Azure |
| AZ-42 | Add Remediation Tasks API (`PolicyInsights/remediations`) for GP-012 enhancement. | P0 | Azure |
| AZ-43 | Subscription diagnostic settings: validate all log categories enabled (Administrative, Security, ServiceHealth, Alert, Policy, ResourceHealth), not just existence. | P1 | Azure |
| AZ-44 | Resource Graph `authorizationresources` query for IA-006: scope to MG-level assignments specifically. | P1 | Azure |
| AZ-45 | Classic administrator API: pin `api-version=2015-07-01`. Note legacy/deprecated status. | P1 | Azure |
| AZ-46 | Budget API: use `api-version=2023-11-01`, support MG-scope queries. | P1 | Azure |

### Resource Graph Resilience

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| AZ-47 | Implement `$skipToken` pagination on every Resource Graph query. Max 1,000 records per page. | P0 | Azure |
| AZ-48 | Read `x-ms-user-quota-remaining` and `x-ms-user-quota-resets-after` headers for adaptive throttling. | P0 | Azure |
| AZ-49 | Batch subscriptions at max 200 per Resource Graph request for large tenants. | P1 | Azure |
| AZ-50 | Implement query batching: Phase 1 baseline queries shared by multiple scanners, Phase 2 scanner-specific. Use the `resourcesBatch` endpoint (up to 3 queries per batch). | P1 | Azure |

### Remediation Intelligence

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| AZ-51 | MG move impact analysis: when remediation recommends moving a subscription, generate impact report (policies lost/gained, RBAC lost/gained, Deny conflicts). | P0 | Azure |

---

## Part 3: CLEAR's Own Security Posture

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| SEC-31 | Data at rest: state SQLite is unencrypted (acceptable for local-only). Azure SQL TDE automatic. Blob Storage encryption (service-managed keys minimum). | P0 | Security |
| SEC-32 | Data in transit: bind local Docker ports to `127.0.0.1` only (not `0.0.0.0`). | P0 | Security |
| SEC-33 | AI data minimization: add a sanitization layer that strips tenant IDs, subscription IDs, and resource names before sending to external AI providers. For Azure OpenAI (Contica's own sub), full data is acceptable. | P1 | Security |
| SEC-34 | Audit logging: new `AuditLog` entity and `AuditMiddleware`. Log: scan initiated/completed, report generated/downloaded, tenant registered/deleted, settings changed, auth events. Forward to Log Analytics in Azure mode. | P0 | Security |
| SEC-35 | Data retention policies: scan results 12mo, reports 6mo, chat transcripts 30d, audit logs 24mo. Add `DataRetentionJob` background job. Add `DataRetention` config section. | P0 | Security |
| SEC-36 | DevBypassAuthProvider safeguard: throw exception if `ASPNETCORE_ENVIRONMENT != Development`. Log WARNING if bypass active. | P0 | Security |
| SEC-37 | Report download security: path traversal prevention, authorization check per tenant, Content-Disposition: attachment, SAS tokens for Blob (15min expiry). | P1 | Security |
| SEC-38 | API security: rate limiting (10 scans/hour/tenant, 100 calls/min/user), input validation on GUIDs, CSRF on state-changing endpoints, CSP headers, sanitize AI-generated HTML. | P1 | Security |
| SEC-39 | AI prompt injection defense: system prompt forbids raw ID output, max message length 2000 chars, chat metadata logged for audit. | P1 | Security |
| SEC-40 | Secret rotation tracking: warn 30 days before app registration credential expiry. Use Key Vault expiry notifications. Prefer GitHub App tokens over PATs for knowledge sync. | P1 | Security |
| SEC-41 | Minimum vs full permission modes: let consultant choose subset of checks based on what customer has consented. | P1 | Security |

---

## Part 4: Compliance Framework Mapping

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| SEC-42 | Add `ComplianceReferences` field (JSON) to `CheckResult` model. | P0 | Security |
| SEC-43 | Add static mapping file `Clear.Engine/Compliance/ComplianceMap.json` mapping each check ID to CIS Azure, ISO 27001, NIST CSF, SOC 2, NIST 800-53 controls. | P0 | Security |
| SEC-44 | CIS Azure Benchmark traceability matrix as a report deliverable. | P1 | Security |
| SEC-45 | Compliance summary section in Detailed Assessment Report: per-framework pass/fail counts, heat map of control families, explicit boundary statement. | P1 | Security |
| SEC-46 | Zero Trust maturity synthesis: cross-scanner mapping to Microsoft ZT pillars (Identity, Endpoints, Network, Applications, Data, Infrastructure, Visibility) in AI analysis prompt. | P1 | Security |

---

## Part 5: .NET Backend Architecture

### Project Structure

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| NET-03 | Add `Clear.Contracts` shared project for enums, records, and interfaces used cross-project. | P0 | .NET |
| NET-04 | Add `Directory.Build.props` (TFM, nullable, TreatWarningsAsErrors) and `Directory.Packages.props` (central package management). | P0 | .NET |
| NET-05 | Solution folder organization: /Host, /Core, /AI, /Infrastructure, /Tests. | P1 | .NET |
| NET-06 | Add `Clear.Api/Dtos/` folder. Never expose entities directly. Use Mapperly (source-generated, zero-overhead) for mapping. | P0 | .NET |

### Dependency Injection

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| NET-07 | Keyed services (.NET 8) for scanner registration. `IEnumerable<IScannerModule>` for run-all, keyed for targeted re-run. | P0 | .NET |
| NET-08 | Named/factory pattern for AI providers with `IOptionsMonitor<AIOptions>` for hot-reload. | P0 | .NET |
| NET-09 | Per-project `AddClear*` extension methods for clean `Program.cs` composition root. | P1 | .NET |
| NET-10 | Configuration-driven infrastructure registration (not environment checks in code). | P1 | .NET |

### EF Core

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| NET-11 | Explicit indexes on `CheckResult`: `ScannerResultId`, composite `(ScannerResultId, Status)`, composite `(ScannerResultId, Severity)`, `CheckId`. | P0 | .NET |
| NET-12 | JSON column mapping for `RemediationDetail`, `ScanOptions`, `InterviewTranscript`, `ComplianceFrameworks`, `TenantConfig` arrays. Value converter fallback for SQLite. | P0 | .NET |
| NET-13 | Composite indexes on `Scan`: `(TenantId, StartedAt)`, `(TenantId, Status)`. | P0 | .NET |
| NET-14 | `AsSplitQuery()` for deep includes (Scan → ScannerResults → Checks). Projection DTOs for list endpoints. | P0 | .NET |
| NET-15 | `[Timestamp] byte[] RowVersion` on `Scan` entity for concurrency control. | P1 | .NET |
| NET-16 | Default `QueryTrackingBehavior.NoTracking` on `DbContext`. Opt-in tracking for writes. | P1 | .NET |
| NET-17 | Migration strategy: generate against SQL Server, test both. CI/CD migration (Option B) for prod, startup migration (Option A) for local. | P0 | .NET |

### API Design

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| NET-18 | Missing endpoints: `DELETE .../scans/{scanId}`, `POST .../scans/{scanId}/cancel`, `GET .../scans/{scanId}/reports` (list), `GET/PUT .../config`, `GET /api/health[/ready/live]`, `GET /api/version`. | P0 | .NET |
| NET-19 | Pagination: `PagedResponse<T>` with `page`, `pageSize`, `totalCount`, `totalPages` on all list endpoints. | P0 | .NET |
| NET-20 | API versioning via URL path (`/api/v1/...`) from day one. NuGet: `Asp.Versioning.Http`. | P1 | .NET |
| NET-21 | FluentValidation for all request DTOs. NuGet: `FluentValidation.AspNetCore`. | P0 | .NET |
| NET-22 | ProblemDetails (RFC 7807) for all error responses with `traceId`. | P1 | .NET |
| NET-23 | Add `ScanId` to `ScanContext` record. | P0 | .NET |
| NET-24 | Add `Cancelled` to `ScanStatus` enum. | P0 | .NET |

### Background Jobs

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| NET-25 | Use Hangfire for background job processing. SQLite storage locally, SQL Server in Azure. Built-in dashboard at `/hangfire`. | P0 | .NET |
| NET-26 | Scan cancellation: `ScanCancellationRegistry` (ConcurrentDictionary of CancellationTokenSources). `POST .../cancel` triggers cancellation. Partial results saved. | P0 | .NET |
| NET-27 | Concurrent scan limits: max 1 per tenant, max 3 global. Guard at API + Hangfire worker level. | P0 | .NET |
| NET-28 | Scheduled knowledge sync via Hangfire recurring job (daily at 3 AM). | P1 | .NET |

### Streaming

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| NET-29 | Channel-based SSE: `ScanProgressService` with `Channel<ScanProgressEvent>` per scan. Support multiple subscribers (fan-out). | P1 | .NET |
| NET-30 | AI chat streaming: `IAsyncEnumerable<string>` with linked `CancellationTokenSource` for 120s timeout. | P1 | .NET |

### Observability

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| NET-31 | Serilog structured logging with `CompactJsonFormatter`. Log scopes with `ScanId`, `TenantId`, `ScannerId`. | P0 | .NET |
| NET-32 | OpenTelemetry tracing + custom metrics. `ActivitySource("Clear.Engine")` for scanner spans. Custom counters: `clear.scans.completed`, `clear.scans.duration_seconds`, `clear.checks.executed`. | P1 | .NET |
| NET-33 | Health checks: DB, Azure connectivity, knowledge freshness (degraded if >60 days old), AI provider. Map to `/api/health`, `/api/health/ready`, `/api/health/live`. | P0 | .NET |
| NET-34 | Startup validation: `ValidateOnStart` for all options classes. Fail fast with clear messages. | P0 | .NET |

### Performance & Resilience

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| NET-35 | In-memory cache for `KnowledgeSnapshot` with `SemaphoreSlim` lock. Invalidate on sync. | P1 | .NET |
| NET-36 | Response compression: Brotli + Gzip including `text/event-stream`. | P2 | .NET |
| NET-37 | Polly resilience pipelines for all HTTP clients (Azure, GitHub, AI providers). Use `Microsoft.Extensions.Http.Resilience`. | P0 | .NET |
| NET-38 | `IDistributedCache` abstraction point (in-memory for v1, Redis-ready for scale-out). | P2 | .NET |
| NET-39 | CORS configuration: explicit allowed origins from config, `AllowCredentials` for SSE. | P0 | .NET |
| NET-40 | Global exception handler returning ProblemDetails. | P1 | .NET |
| NET-41 | Rate limiting middleware on scan-start and other state-changing endpoints. | P1 | .NET |
| NET-42 | Register Azure clients via `Microsoft.Extensions.Azure` for proper lifecycle. | P1 | .NET |

### Additional NuGet Packages

| Package | Purpose | Priority |
|---------|---------|----------|
| `Riok.Mapperly` | Source-generated DTO mapping | P0 |
| `FluentValidation.AspNetCore` | Request validation | P0 |
| `Asp.Versioning.Http` | API versioning | P1 |
| `Hangfire.Core` + `Hangfire.AspNetCore` | Background jobs | P0 |
| `Microsoft.Extensions.Azure` | Azure client DI | P1 |
| `Microsoft.Extensions.Http.Resilience` | Polly v8 HTTP resilience | P0 |
| `Serilog.AspNetCore` | Structured logging | P0 |
| `OpenTelemetry.Extensions.Hosting` + instrumentation | Distributed tracing | P1 |
| `AspNetCore.HealthChecks.UI.Client` | Health check JSON output | P0 |

---

## Part 6: Frontend Architecture

### Dashboard & Visualization

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| FE-01 | Dashboard info hierarchy: sort by last-scan-date desc, toggle for score ascending. Primary card: score gauge, maturity badge, delta indicator. Secondary: last scan date, scanner error count, worst finding. Empty state with onboarding CTA. | P0 | Frontend |
| FE-02 | Summary bar above tenant grid: total tenants, avg score, maturity tier distribution, last knowledge sync. | P1 | Frontend |
| FE-03 | Bar chart as primary visualization (sorted worst-first), radar chart as secondary toggle. | P0 | Frontend |
| FE-04 | CheckHeatmap component: grid of colored squares (scanners × checks) for instant visual pattern recognition. | P0 | Frontend |
| FE-05 | Scan comparison view: side-by-side bar charts, delta badges, check-level diff table (new passes green, new failures red). | P1 | Frontend |

### AI Chat

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| FE-06 | Chat as resizable sidebar panel (not separate page). Slide-over on right, persistent across tenant sub-pages. Full-page mode at `/chat` as expansion. | P0 | Frontend |
| FE-07 | Context chip bar at top of chat showing tenant, scan, focused scanner. Expandable "Context" drawer showing data sent to AI. | P0 | Frontend |
| FE-08 | Message formatting: Markdown, Bicep code blocks (Shiki highlighting via IaCViewer), clickable check references (e.g., "GP-001" links to check detail), AI badge on messages. | P1 | Frontend |

### Interview Wizard

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| FE-09 | Hybrid chat + structured fields: AI asks conversationally, structured inputs appear inline for known `AssessmentProfile` fields (radio buttons, dropdowns). Progress sidebar showing field completion. | P0 | Frontend |
| FE-10 | Save/resume: persist interview state to API after each exchange via `InterviewTranscript`. Pre-populate from previous `AssessmentProfile` if exists. | P1 | Frontend |
| FE-11 | "Skip interview, use defaults" button for repeat scans. | P1 | Frontend |

### Reports

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| FE-12 | In-browser report preview: render HTML format in iframe with print CSS. Download buttons for PDF/Word/HTML above preview. | P0 | Frontend |
| FE-13 | Branding customization per tenant: Contica branded (default) vs customer branded (upload logo). Store in `TenantConfig`. | P1 | Frontend |
| FE-14 | Print-optimized CSS: `@media print` hiding nav, forcing white background, page breaks before scanner sections. Charts as static SVG for print. | P1 | Frontend |

### Real-Time Scan Progress

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| FE-15 | Per-scanner progress cards (2x4 grid): queued → scanning (blue pulse) → complete (score count-up animation). Overall progress bar at top. | P0 | Frontend |
| FE-16 | Estimated time remaining (frontend estimation from progress event rate if API doesn't provide). | P1 | Frontend |
| FE-17 | Partial-failure banner: "2 of 8 scanners failed. [Retry failed scanners]" button. | P1 | Frontend |
| FE-18 | SSE reconnection with exponential backoff on connection drop. "Reconnecting..." banner. | P0 | Frontend |

### State Management & Data Fetching

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| FE-19 | Server/client component boundary: SSR for Dashboard, Tenant Detail, Scan Results, Scanner Detail, Remediation, Knowledge. Client for New Scan, Reports, Chat, Settings, Interview. | P0 | Frontend |
| FE-20 | TanStack Query v5 for all client-side data fetching. Custom hook wrapping EventSource for SSE into query cache. | P0 | Frontend |
| FE-21 | Optimistic updates for scan start and report generation. | P1 | Frontend |
| FE-22 | URL-based state for CheckTable filters and view toggles (search params, not component state). | P1 | Frontend |

### Accessibility & Theming

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| FE-23 | WCAG 2.1 AA baseline: keyboard navigation, focus rings, color + icon/text for status, aria-labels on charts, form labels, 4.5:1 contrast. | P0 | Frontend |
| FE-24 | Screen reader support: `aria-live="polite"` for scan progress, proper table semantics. | P1 | Frontend |
| FE-25 | Dark mode: Tailwind `dark:` with class strategy, explicit toggle, dark-mode chart color tokens. | P1 | Frontend |
| FE-26 | Contica branding: CSS custom property theme (`--contica-primary`, etc.), logo light/dark variants. | P1 | Frontend |

### Performance & Error Handling

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| FE-27 | Virtualized lists (TanStack Virtual) for 50+ row tables and scan history. | P0 | Frontend |
| FE-28 | Chart lazy loading via `next/dynamic` with `ssr: false`. Skeleton placeholders. | P1 | Frontend |
| FE-29 | React Error Boundaries: layout-level + per-page. TanStack Query error states as inline banners with retry. | P0 | Frontend |
| FE-30 | Skeleton loading screens on every data-fetching page. | P0 | Frontend |
| FE-31 | TypeScript type generation from .NET API via NSwag or openapi-typescript. | P1 | Frontend |
| FE-32 | Toast notifications for async operations (scan started, report ready). | P1 | Frontend |
| FE-33 | Tablet-responsive layout: 3/2/1 column grid at breakpoints, 44px touch targets, collapsible nav. | P1 | Frontend |
| FE-34 | Tenant onboarding wizard: enter name + tenant ID → verify connectivity → configure defaults → optional first interview. | P2 | Frontend |

---

## Part 7: DevOps & Deployment

### Docker

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| OPS-01 | Specify multi-stage Dockerfiles for both services. Alpine base, non-root user, `HEALTHCHECK`, `ReadyToRun` for .NET, `output: "standalone"` for Next.js. | P0 | DevOps |
| OPS-02 | Container security scanning: Trivy in CI as gate (fail on CRITICAL/HIGH). Defender for Containers on ACR. | P1 | DevOps |
| OPS-03 | No `latest` tag in production. Use immutable tags: SemVer or SHA-based. | P0 | DevOps |
| OPS-04 | Docker Compose profiles for dev/test (hot-reload, watch mode, SQL Server container). | P1 | DevOps |
| OPS-05 | `.dockerignore` files in both project directories. | P0 | DevOps |

### CI/CD

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| OPS-06 | Full `build.yml` pipeline: lint-frontend, test-backend-sqlite, test-backend-sqlserver (service container), test-frontend, build-images, Trivy scan, E2E tests. | P0 | DevOps |
| OPS-07 | Full `deploy.yml` pipeline: OIDC auth (not client secrets), push images to ACR, Bicep What-If, deploy infra, deploy apps, smoke test. Tag-triggered for production. | P0 | DevOps |
| OPS-08 | Conventional commits + semantic-release/release-please for automated versioning. | P1 | DevOps |
| OPS-09 | Dependabot config for NuGet, npm, Docker, GitHub Actions. | P1 | DevOps |
| OPS-10 | Branch protection: PR required, status checks required, no direct push to main. | P1 | DevOps |
| OPS-11 | Database migration step in deploy pipeline (dotnet-ef or startup migration with concurrency guard). | P0 | DevOps |

### Container Apps

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| OPS-12 | Scaling rules: HTTP concurrent requests (10), CPU utilization (70%). | P0 | DevOps |
| OPS-13 | Readiness, liveness, and startup probes targeting `/healthz/*` endpoints. Startup probe: 150s max for knowledge sync. | P0 | DevOps |
| OPS-14 | Managed identity for ACR pull (system-assigned + `acrPull` role). | P0 | DevOps |
| OPS-15 | Key Vault references for secrets (Container App → Key Vault via managed identity). | P0 | DevOps |
| OPS-16 | Single-revision mode for v1. Keep 5 revisions for rollback. | P1 | DevOps |
| OPS-17 | Custom domain `clear.contica.se` with managed TLS certificate. | P1 | DevOps |
| OPS-18 | Graceful shutdown: `terminationGracePeriodSeconds: 330` (5.5min). Handle `SIGTERM` in scan jobs: save partial results, mark `Interrupted`. | P0 | DevOps |
| OPS-19 | Container Apps internal FQDN for API: output from Bicep, inject into clear-web (not hardcoded `http://clear-api:5000`). | P0 | DevOps |

### Infrastructure-as-Code

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| OPS-20 | Missing Bicep modules: `logAnalytics.bicep`, `containerAppsEnvironment.bicep`, `managedIdentity.bicep`, `roleAssignments.bicep`, `alertRules.bicep`. | P0 | DevOps |
| OPS-21 | `appRegistration.bicep` cannot use Bicep (no ARM provider). Change to deployment script or document as manual prerequisite. | P0 | DevOps |
| OPS-22 | Parameter file differentiation for dev/prod: SQL SKU, auto-pause, backup retention, replica counts, log retention, Key Vault soft-delete, custom domain. | P1 | DevOps |
| OPS-23 | `targetScope = 'subscription'` for idempotent deployment creating resource group + all resources. | P1 | DevOps |
| OPS-24 | Bicep What-If on infrastructure PRs with output as PR comment. | P1 | DevOps |

### Monitoring & Alerting

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| OPS-25 | Application Insights SDK in `Clear.Api` + `@microsoft/applicationinsights-web` in `clear-web`. Custom telemetry events for scan completion. | P0 | DevOps |
| OPS-26 | Log Analytics workspace (required by Container Apps Environment). 30d dev, 90d prod retention. | P0 | DevOps |
| OPS-27 | Alert rules Bicep module: scan failure rate, API 5xx rate, knowledge sync failure, container restarts, SQL DTU, P95 response time. | P1 | DevOps |
| OPS-28 | Swagger/OpenAPI in development environment for frontend developer experience. | P1 | DevOps |

### Database & Backup

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| OPS-29 | Azure SQL backup: 7d PITR (dev), 35d PITR (prod), weekly LTR 4 weeks, monthly LTR 12 months. | P1 | DevOps |
| OPS-30 | Blob Storage: soft delete (14d), versioning enabled. | P1 | DevOps |
| OPS-31 | Azure SQL: prefer Managed Identity auth (`Authentication=Active Directory Managed Identity`) over passwords. | P0 | DevOps |
| OPS-32 | Data export/import endpoints: `GET /api/admin/export?tenantId=xxx`, `POST /api/admin/import` for local-to-hosted transfer. | P2 | DevOps |
| OPS-33 | RTO/RPO targets: container crash <5min/0 loss, SQL outage <1h/<1h, region failure 4h/<1h, knowledge corruption <5min/0. | P1 | DevOps |

### Developer Experience

| ID | Change | Priority | Expert |
|----|--------|----------|--------|
| OPS-34 | Hot-reload: mount source + `dotnet watch run` for API, Next.js dev mode for web. `DOTNET_USE_POLLING_FILE_WATCHER=1` for Docker on Windows/Mac. | P1 | DevOps |
| OPS-35 | Seed data: `DevelopmentSeeder.cs` creating 2-3 sample tenants with scan history at different tiers. | P1 | DevOps |
| OPS-36 | `.env.example` file in repo with placeholder values. `env_file: .env` in Docker Compose. | P0 | DevOps |
| OPS-37 | Makefile/Taskfile for common operations: dev, test, build, lint, migrate, seed, clean. | P2 | DevOps |
| OPS-38 | Request size limit (10MB) on API for chat endpoint with growing history. | P1 | DevOps |

---

## Priority Summary

| Priority | Count | Description |
|----------|-------|-------------|
| **P0** (must-have v1) | 73 | Blocks v1 ship. Core scanner checks, architecture, security, infrastructure. |
| **P1** (strongly recommended v1) | 79 | Should be in v1 if time permits. Hardening, DX, observability, advanced checks. |
| **P2** (v1.1 / hardening sprint) | 34 | Post-launch improvements. Nice-to-have checks, polish, future-proofing. |
| **Total** | **186** | **0 removals. Every item adds or hardens.** |
