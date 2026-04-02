---
name: "Azure Cost Optimization"
description: "Azure cost analysis — right-sizing, reserved instances, savings plans, storage tiering, waste elimination"
domain: "cost"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-04-02"
reviewByDate: "2026-10-02"
triggers:
  - "azure cost"
  - "cost optimization"
  - "right-sizing"
  - "reserved instance"
  - "savings plan"
  - "azure pricing"
  - "sku selection"
  - "cost reduction"
roles:
  - "architect"
  - "devops-engineer"
  - "reviewer"
---

## Context
Apply when analyzing Azure deployment costs, identifying optimization opportunities, or selecting
cost-effective SKUs. Covers right-sizing, reservations, auto-scaling, storage tiering, and waste elimination.

## Patterns

**Cost optimization categories:**

1. Right-sizing (30-50% savings):
   Review 30-day metrics (CPU, memory, DTU utilization).
   Resources with < 40% average utilization are candidates for downsizing.

2. Reserved instances (20-72% savings):
   1-year commitment: 20-40% savings. 3-year: 40-72%.
   Applicable to VMs, App Service, Azure SQL, Cosmos DB, Redis.
   Only for workloads with consistent, predictable usage.

3. Auto-scaling (20-40% savings):
   Scale based on demand instead of static provisioning.
   Applicable to App Service, VMSS, Container Apps, AKS, Cosmos DB autoscale.

4. Storage tiering (50-90% savings on archived data):
   Hot: frequent access (< 30 days). Cool: infrequent (30-90 days, 50% cheaper).
   Archive: rare (> 90 days, 90% cheaper). Implement lifecycle management policies.

5. Waste elimination:
   Unattached disks, stopped (not deallocated) VMs, orphaned public IPs,
   unused App Service Plans, old snapshots. Typical savings: significant per environment.

**Dev/test cost reduction:**
Use Developer tier for dev/test APIM (vs Premium for prod).
Use DevTest subscription pricing (waives Windows OS license).
Auto-shutdown dev VMs outside business hours (save 60%).

**Cost estimation approach:**
Monthly cost = hourly rate x 730 hours.
Always compare: Pay-as-you-go vs 1-year Reserved vs 3-year Reserved.
Include all components: compute, storage, networking, monitoring, licenses.

**Cost governance:**
Set budget alerts at 50%, 80%, 90%, 100% thresholds.
Tag all resources for cost allocation (Environment, CostCenter, Owner).
Monthly cost optimization reviews. Quarterly reserved instance assessment.

## Examples

```
Right-sizing Example:

Current:  App Service P2v3 (2 cores, 8GB) — Avg CPU: 20%, RAM: 35%
Proposed: App Service P1v3 (2 cores, 4GB)
Savings:  ~50% monthly cost reduction
Risk:     Medium — requires performance testing after change
Action:   Scale down during low-traffic window, monitor 48 hours
```

```
Reserved Instance Example:

Resource:         2x Standard_D4s_v5 VMs (production, running 24/7)
Pay-as-you-go:    ~full hourly rate x 730 x 2
1-year reserved:  ~30% savings
3-year reserved:  ~50% savings
Recommendation:   1-year RI (lower commitment, still significant savings)
```

## Anti-Patterns

- **Blind right-sizing** — always review 30-day metrics before changing SKUs
- **Reserved instances for variable workloads** — only commit for predictable, steady-state usage
- **Skipping performance validation** — test after every SKU change
- **Ignoring data transfer costs** — cross-region and internet egress costs add up
- **Premium tier for dev/test** — use Developer tier or DevTest subscriptions
- **No cost monitoring** — set budget alerts and review monthly
- **Forgetting Azure Hybrid Benefit** — 40%+ savings for Windows VMs and SQL with existing licenses
