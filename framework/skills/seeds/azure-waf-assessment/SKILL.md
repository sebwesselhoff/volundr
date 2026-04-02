---
name: "Azure WAF Assessment"
description: "Assess Azure architectures against the Well-Architected Framework five pillars with scoring and recommendations"
domain: "architecture"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-04-02"
reviewByDate: "2026-10-02"
triggers:
  - "well-architected"
  - "waf"
  - "reliability"
  - "azure security"
  - "cost optimization"
  - "operational excellence"
  - "performance efficiency"
  - "waf assessment"
  - "pillar"
roles:
  - "architect"
  - "reviewer"
---

## Context
Apply when evaluating Azure architectures against Microsoft's Well-Architected Framework.
Score each pillar 0-100 and provide prioritized recommendations with specific remediation steps.

## Patterns

**Five-pillar checklist:**

Reliability:
- Availability Zones configured for production workloads
- Health checks and auto-healing enabled
- Backup strategy defined with RPO/RTO targets
- Disaster recovery plan documented (multi-region if mission-critical)

Security:
- Managed identities used (no credentials in code)
- Private endpoints for PaaS services
- HTTPS only with TLS 1.2+
- NSGs with least privilege
- Key Vault for all secrets and certificates
- Entra ID authentication and RBAC configured

Cost Optimization:
- Resources right-sized for actual usage
- Auto-scaling configured
- Reserved instances for predictable workloads
- Storage tiering implemented (Hot/Cool/Archive)
- Cost monitoring alerts set

Operational Excellence:
- Infrastructure as Code (Bicep or Terraform)
- CI/CD pipelines with automated testing
- Application Insights + Log Analytics configured
- Alerts for critical scenarios defined
- Deployment rollback procedure documented

Performance Efficiency:
- CDN for static content
- Caching strategy (Redis, CDN headers)
- Async processing for long operations
- Auto-scaling rules defined with appropriate triggers

**Scoring system (0-100):**
| Range | Status | Meaning |
|-------|--------|---------|
| 80-100 | Excellent | Meets all best practices, production-ready |
| 60-79 | Good | Meets most practices, minor gaps |
| 40-59 | Fair | Some practices missing, moderate risk |
| 20-39 | Poor | Many gaps, significant improvements needed |
| 0-19 | Critical | Major gaps, not production-ready |

**Finding format:**
For each gap: Finding title, Severity (Critical/High/Medium/Low), Risk description,
Remediation steps with code/CLI examples, Priority (Immediate/Before Production/Post-Launch).

## Examples

```markdown
## Finding: Service Principal Used Instead of Managed Identity
- Severity: Critical
- Risk: Credential rotation required, potential secret exposure in code/logs
- Remediation:
  1. Enable managed identity on App Service
  2. Grant RBAC permissions to SQL and Key Vault
  3. Remove service principal credentials from config
- Priority: Immediate
```

## Anti-Patterns

- **Generic advice** — provide specific, actionable remediation with CLI commands or Bicep snippets
- **Missing priorities** — every finding needs a severity and priority ranking
- **Skipping cost context** — include cost impact of each recommendation
- **Single pillar focus** — always assess all five pillars, even if one is the primary concern
- **Over-engineering recommendations** — match recommendations to actual business requirements
