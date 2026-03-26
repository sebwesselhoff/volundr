---
name: "Authentication & Authorization Patterns"
description: "JWT, session management, RBAC, OAuth2, and secure credential handling"
domain: "security"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "authentication"
  - "authorization"
  - "jwt"
  - "oauth"
  - "session"
  - "rbac"
  - "permissions"
  - "token"
roles:
  - "developer"
  - "security-reviewer"
  - "architect"
---

## Context
Apply when implementing login flows, protecting routes, managing tokens, or designing permission
systems. Misimplemented auth is one of the most common critical vulnerabilities.

## Patterns

**JWT best practices:**
- Sign with RS256 (asymmetric) for services that verify but don't issue tokens
- Set short expiry (`exp`): 15m for access tokens, 7d for refresh tokens
- Validate `iss`, `aud`, `exp`, and signature on every request
- Never put sensitive data (passwords, PII) in the JWT payload — it is base64, not encrypted

**Refresh token rotation:**
- Issue a new refresh token on every use; invalidate the old one
- Store refresh tokens hashed in DB, not plaintext

**RBAC (Role-Based Access Control):**
```typescript
function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.user.role)) {
      throw new ApiError(403, 'Forbidden');
    }
    next();
  };
}
```

**Password storage:** always bcrypt/argon2 with work factor ≥ 12.

**OAuth2:** use PKCE for public clients; never expose client_secret in frontend code.

## Examples

```typescript
// Middleware: verify JWT and attach user
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new ApiError(401, 'No token');
  try {
    req.user = jwt.verify(token, process.env.JWT_PUBLIC_KEY!, { algorithms: ['RS256'] }) as JwtPayload;
    next();
  } catch {
    throw new ApiError(401, 'Invalid token');
  }
}
```

## Anti-Patterns

- **Storing tokens in localStorage** — use httpOnly cookies for refresh tokens
- **Long-lived access tokens** — prefer short expiry + refresh
- **Rolling your own crypto** — use established libraries (jose, bcrypt, argon2)
- **Checking roles client-side only** — always enforce on the server
- **Logging tokens or passwords** — scrub before any log output
- **Weak JWT secrets** — secrets must be at least 256 bits of entropy
