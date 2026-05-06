# DEBUGGING.md — Worked Example

> This file shows what the six Operational Affordances entries look like for a realistic
> Hangfire + SSE pipeline. Copy relevant sections into your project's `docs/DEBUGGING.md`
> and adapt to your actual infrastructure.
>
> Fictional project: **ScanOrchestrator** — a .NET 8 worker that fans out document-scan
> jobs via Hangfire, streams progress to the browser over SSE, and stores job state in SQLite.

---

## 1. Log-line correlation

**Correlation key:** `ScanJobId` — a `Guid` stamped on every log entry for the lifetime of one scan job.

All components (Hangfire background job, IScannerModule implementations, SSE broadcaster) enrich the Serilog scope with this property at entry.

**Follow one job in a structured log viewer (e.g. Seq):**

```
ScanJobId = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
```

**Follow via dotnet-trace / `grep` on plain-text output:**

```bash
# Stream live logs and filter to one job
dotnet run | grep "3fa85f64-5717-4562-b3fc-2c963f66afa6"
```

**Serilog filter expression (appsettings override for local debugging):**

```json
{
  "Serilog": {
    "Filter": [
      {
        "Name": "ByIncludingOnly",
        "Args": {
          "expression": "ScanJobId = '3fa85f64-5717-4562-b3fc-2c963f66afa6'"
        }
      }
    ]
  }
}
```

Expected first/last log lines per job:

| Event | Logger | Message template |
|-------|--------|-----------------|
| Job enqueued | `ScanController` | `Enqueued scan job {ScanJobId} for document {DocumentId}` |
| Job started | `ScanJobHandler` | `Starting scan job {ScanJobId}` |
| Module complete | `IScannerModule` | `Module {ModuleName} finished for job {ScanJobId} in {ElapsedMs}ms` |
| SSE pushed | `SseBroadcaster` | `Pushed progress event for job {ScanJobId}: {ProgressPct}%` |
| Job done | `ScanJobHandler` | `Scan job {ScanJobId} completed with status {FinalStatus}` |

---

## 2. Admin/dashboard surface

### Hangfire dashboard

| Item | Value |
|------|-------|
| URL (local) | `http://localhost:5000/hangfire` |
| URL (Docker Compose) | `http://localhost:8080/hangfire` (host port mapped in `docker-compose.yml`) |
| Auth | Dashboard is restricted to requests with header `X-Internal-Token: <value from HANGFIRE_DASHBOARD_TOKEN env var>`. In development the env var defaults to `dev-token` so no extra config is needed. In production, set the env var or the dashboard returns 403. |

**Port-forward (Kubernetes):**

```bash
kubectl port-forward svc/scan-orchestrator 8080:80 -n scan
# Then browse to http://localhost:8080/hangfire
```

**From the dashboard you can:**
- See queued, processing, succeeded, and failed jobs
- Retry failed jobs manually
- Inspect job arguments and exception details
- Delete stuck jobs from the processing queue

---

## 3. Persistent state inspection

The backing store is SQLite at `data/scan.db` (path configured via `ConnectionStrings__ScanDb`).

### What's pending right now?

```sql
SELECT j.Id, j.DocumentId, j.QueuedAt, j.Status
FROM ScanJobs j
WHERE j.Status = 'Pending'
ORDER BY j.QueuedAt ASC;
```

### What's stuck (processing for more than 10 minutes)?

```sql
SELECT j.Id, j.DocumentId, j.StartedAt, j.Status,
       CAST((julianday('now') - julianday(j.StartedAt)) * 1440 AS INTEGER) AS AgeMinutes
FROM ScanJobs j
WHERE j.Status = 'Processing'
  AND j.StartedAt < datetime('now', '-10 minutes')
ORDER BY j.StartedAt ASC;
```

### What failed in the last hour?

```sql
SELECT j.Id, j.DocumentId, j.FailedAt, j.ErrorMessage
FROM ScanJobs j
WHERE j.Status = 'Failed'
  AND j.FailedAt > datetime('now', '-1 hour')
ORDER BY j.FailedAt DESC;
```

### Hangfire-internal state (if using Hangfire.SQLite):

```sql
-- Jobs currently locked by a worker
SELECT Id, StateName, Arguments, CreatedAt
FROM HangFire.Job
WHERE StateName = 'Processing';
```

---

## 4. Transport observation

### Prove the SSE endpoint is delivering events

```bash
# Connect and stream events — Ctrl-C to stop
curl -N -H "Accept: text/event-stream" \
     -H "Authorization: Bearer <your-dev-token>" \
     http://localhost:5000/api/scan-jobs/3fa85f64-5717-4562-b3fc-2c963f66afa6/events
```

Expected output while a job is running:

```
data: {"jobId":"3fa85f64-5717-4562-b3fc-2c963f66afa6","progress":10,"status":"Processing","module":"OcrModule"}

data: {"jobId":"3fa85f64-5717-4562-b3fc-2c963f66afa6","progress":45,"status":"Processing","module":"ClassifierModule"}

data: {"jobId":"3fa85f64-5717-4562-b3fc-2c963f66afa6","progress":100,"status":"Completed","module":null}
```

If the connection closes immediately (no `data:` lines), check:
1. The job ID is valid and the job exists in `ScanJobs`.
2. The SSE broadcaster has a registered subscription for this job — look for log `SseBroadcaster: registered subscriber for {ScanJobId}`.
3. The server is not buffering the response — ensure `Response.Headers["X-Accel-Buffering"] = "no"` is set and no reverse proxy (nginx/YARP) is adding response buffering.

### Trigger a test event without a real job (integration smoke test)

```bash
# POST to the internal test endpoint (dev environment only, guarded by ASPNETCORE_ENVIRONMENT)
curl -X POST http://localhost:5000/internal/test/sse-event \
     -H "Content-Type: application/json" \
     -d '{"jobId":"3fa85f64-5717-4562-b3fc-2c963f66afa6","progress":50,"status":"Processing","module":"Test"}'
```

---

## 5. Isolated replay

### Re-run a single scan job in a unit test

```bash
# Run only the ScanJobHandler integration tests
dotnet test tests/ScanOrchestrator.IntegrationTests \
  --filter "FullyQualifiedName~ScanJobHandlerTests" \
  --logger "console;verbosity=detailed"
```

### Re-run one specific scenario (e.g. partial failure in OcrModule)

```bash
dotnet test tests/ScanOrchestrator.IntegrationTests \
  --filter "FullyQualifiedName=ScanOrchestrator.IntegrationTests.ScanJobHandlerTests.OcrModule_PartialFailure_MarksJobFailed"
```

### Fixture and sample data

The test fixture `ScanJobHandlerTests` (in `tests/ScanOrchestrator.IntegrationTests/ScanJobHandlerTests.cs`) uses:

- In-memory SQLite via `Microsoft.Data.Sqlite` with `DataSource=:memory:`
- A stub `IDocumentStore` returning `SampleDocuments.PdfThreePage` (defined in `tests/TestData/SampleDocuments.cs`)
- A real `ScanJobHandler` wired to stub `IScannerModule` implementations

To reproduce a specific failure, copy the failing `ScanJobId` from logs and set it as the fixture seed:

```csharp
var jobId = Guid.Parse("3fa85f64-5717-4562-b3fc-2c963f66afa6");
var job = ScanJobFactory.Create(jobId, SampleDocuments.PdfThreePage);
await _handler.ExecuteAsync(job, CancellationToken.None);
```

---

## 6. Recovery from known-bad state

### Kill a job orphaned in "Processing" state

A job can be stuck in Processing if the worker process crashed mid-execution. Hangfire normally re-enqueues it after the invisibility timeout (default 30 min), but you can force it immediately:

**Via Hangfire dashboard:** Navigate to `/hangfire` → Processing → select the job → Delete.

**Via SQL (emergency, when dashboard is unavailable):**

```sql
-- Move the job back to the Enqueued state in Hangfire tables
UPDATE HangFire.Job SET StateName = 'Enqueued' WHERE Id = '<hangfire-job-id>';
DELETE FROM HangFire.State WHERE JobId = '<hangfire-job-id>' AND Name = 'Processing';

-- Also reset the application-level record
UPDATE ScanJobs SET Status = 'Pending', StartedAt = NULL, WorkerId = NULL
WHERE Id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
```

### Re-enqueue a failed job

```bash
# Via Hangfire dashboard: /hangfire → Failed → Requeue All  (or select individual jobs)

# Via API (if you've wired a management endpoint):
curl -X POST http://localhost:5000/api/scan-jobs/3fa85f64-5717-4562-b3fc-2c963f66afa6/retry \
     -H "Authorization: Bearer <your-dev-token>"
```

### Clear all failed jobs (nuclear, dev only)

```bash
# Via Hangfire dashboard: /hangfire → Failed → Delete All

# Via SQL:
DELETE FROM HangFire.Job WHERE StateName = 'Failed';
UPDATE ScanJobs SET Status = 'Pending', FailedAt = NULL, ErrorMessage = NULL
WHERE Status = 'Failed';
```

### Orphaned SSE subscriptions

If the browser tab closes mid-stream, the server-side `CancellationToken` should fire and clean up the channel. If it doesn't (observable via rising memory on the SSE broadcaster), restart the service — state is fully in SQLite, nothing in-memory is authoritative.

```bash
# Graceful restart (Docker Compose):
docker compose restart scan-orchestrator

# Check that no subscriptions leaked after restart:
curl -s http://localhost:5000/internal/metrics | grep sse_active_subscriptions
# Expected: sse_active_subscriptions 0
```
