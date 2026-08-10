# `@nexusos/identity` — NexusOS Identity & Authentication Service Foundation

This package provides the control-plane Identity and Authentication Service foundation for NexusOS, establishing provider-agnostic token verification, identity claim representations, immutable request contexts, and HTTP authentication middleware.

---

## 🏛️ Governance & Authority

This package is strictly governed by the authoritative specifications in [`docs/`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs):

1. **NexusOS Backend Engineering Design Document (EDD)** (`docs/EDDs/NexusOS_Backend_Engineering_Design_Document_EDD.md` Section 3.2)
2. **NexusOS API Contract Specification** (`docs/Architecture_and_Specs/`)
3. **NexusOS Architecture Bible** (`docs/Architecture_and_Specs/`)

### 🛑 Responsibilities & Architectural Boundaries

- **Identity & Auth OWNS**: Authenticated principal verification ("Who are you?"), JWT/OIDC token validation, `AuthenticatedContext` creation, credential redaction.
- **Identity & Auth DOES NOT OWN**: Policy decision evaluation ("Are you allowed to do this?"), broad role-based authorization (owned by Policy Engine), database user mutation, desktop tool execution.

---

## 👤 Identity Models

Explicitly distinguishes three principal categories:

1. **`UserIdentity`**: Human operator / user principal (`userId`, `tenantId`, `email`, `roles`).
2. **`ServiceIdentity`**: Internal microservice principal (`serviceId`, `tenantId`, `serviceName`, `scopes`).
3. **`DeviceIdentity`**: Registered desktop agent principal (`deviceId`, `tenantId`, `hardwareFingerprint`, `scopes`).

---

## 🔒 Security Invariants

- **No Hard-Coded Credentials**: Zero hard-coded users or credentials; zero development bypass backdoors.
- **Fail Closed**: Rejection of invalid, expired, issuer-mismatched, or missing credentials.
- **Redaction**: Credentials and tokens are redacted from logs (`Authorization`, `Cookie`, `X-API-Key`, `X-Device-JWT`).
- **Standardized Error Envelopes**: Formatted 401 Unauthorized error responses backed by `@nexusos/contracts` `ErrorCategory.AUTHENTICATION`.

---

## ⚡ Usage Example

```typescript
import {
  loadIdentityConfig,
  OIDCAuthenticationProvider,
  createAuthenticationMiddleware,
} from '@nexusos/identity';

const config = loadIdentityConfig(process.env);
const provider = new OIDCAuthenticationProvider(config);
const authMiddleware = createAuthenticationMiddleware(provider, config);

// In HTTP request pipeline:
const allowed = await authMiddleware(req, res);
if (allowed) {
  const user = req.authenticatedContext.principal;
}
```

---

## 🧪 Testing

Run Identity & Authentication foundation tests:

```bash
pnpm --filter @nexusos/identity test
```
