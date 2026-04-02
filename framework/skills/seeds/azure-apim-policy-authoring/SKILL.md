---
name: "Azure APIM Policy Authoring"
description: "Production-ready APIM policy XML for authentication, rate limiting, CORS, error handling, and security headers"
domain: "integration"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-04-02"
reviewByDate: "2026-10-02"
triggers:
  - "apim policy"
  - "policy xml"
  - "validate-jwt"
  - "rate-limit"
  - "cors policy"
  - "apim"
  - "api policy"
roles:
  - "developer"
  - "devops-engineer"
---

## Context
Apply when writing or reviewing Azure API Management policy XML. Covers authentication,
rate limiting, CORS, correlation IDs, error handling, and security headers.

## Patterns

**Policy execution flow:**
```
INBOUND -> BACKEND -> OUTBOUND -> ON-ERROR
1. INBOUND:  Authentication, rate limiting, CORS, request headers
2. BACKEND:  Forwarding, retry, circuit breaker
3. OUTBOUND: Response transform, security headers, cleanup
4. ON-ERROR: Structured errors, logging, correlation ID
```

**JWT validation with Entra ID:**
```xml
<validate-jwt header-name="Authorization">
    <openid-config url="https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration" />
    <audiences>
        <audience>api://{client-id}</audience>
    </audiences>
    <required-claims>
        <claim name="scp" match="any">
            <value>api.read</value>
        </claim>
    </required-claims>
</validate-jwt>
```

**Per-user rate limiting (from JWT subject claim):**
```xml
<set-variable name="userId" value="@(context.Request.Headers.GetValueOrDefault('Authorization','').AsJwt()?.Subject)" />
<rate-limit-by-key calls="1000" renewal-period="3600"
    counter-key="@((string)context.Variables['userId'])" />
```

**Correlation ID generation:**
```xml
<set-variable name="correlationId" value="@(Guid.NewGuid().ToString())" />
<set-header name="X-Correlation-ID" exists-action="override">
    <value>@((string)context.Variables["correlationId"])</value>
</set-header>
```

**Structured error response:**
```xml
<on-error>
    <set-body>@{
        return new JObject(
            new JProperty("error", new JObject(
                new JProperty("code", context.LastError.Source),
                new JProperty("message", context.LastError.Message),
                new JProperty("correlationId", context.Variables["correlationId"]),
                new JProperty("timestamp", DateTime.UtcNow.ToString("o"))
            ))
        ).ToString();
    }</set-body>
</on-error>
```

**Security headers in outbound:**
```xml
<set-header name="X-Content-Type-Options" exists-action="override"><value>nosniff</value></set-header>
<set-header name="X-Frame-Options" exists-action="override"><value>DENY</value></set-header>
<set-header name="Strict-Transport-Security" exists-action="override">
    <value>max-age=31536000; includeSubDomains</value>
</set-header>
```

**Remove server info in outbound:**
Remove `X-Powered-By` and `Server` headers to reduce information disclosure.

## Examples

```xml
<!-- Hybrid auth: OAuth preferred, subscription key fallback -->
<choose>
    <when condition="@(context.Request.Headers.GetValueOrDefault('Authorization','').StartsWith('Bearer'))">
        <validate-jwt header-name="Authorization">
            <openid-config url="https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration" />
        </validate-jwt>
        <rate-limit-by-key calls="1000" renewal-period="3600"
            counter-key="@(context.Request.Headers.GetValueOrDefault('Authorization','').AsJwt()?.Subject)" />
    </when>
    <otherwise>
        <check-header name="Ocp-Apim-Subscription-Key" />
        <rate-limit-by-key calls="500" renewal-period="3600"
            counter-key="@(context.Subscription.Key)" />
    </otherwise>
</choose>
```

## Anti-Patterns

- **No correlation ID** — every request must have a traceable correlation ID in all stages
- **Detailed error messages in production** — never expose stack traces or connection strings
- **Missing rate limiting** — every API needs rate-limit-by-key to prevent abuse
- **Wildcard CORS with credentials** — `allow-credentials="true"` with `origin *` is a security risk
- **Hardcoded secrets in policy XML** — use Key Vault named values: `{{secret-name}}`
- **No on-error block** — unhandled errors may leak internal details to callers
