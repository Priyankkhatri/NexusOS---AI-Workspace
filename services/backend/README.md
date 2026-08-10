# `@nexusos/backend` — NexusOS Control-Plane Backend Service Foundation

This package provides the foundational HTTP application server, lifecycle management, configuration boundary, request context propagation, centralized error handling, and database/event boundaries for NexusOS control-plane services.

---

## 🏛️ Governance & Authority

This package is strictly governed by the authoritative specifications in [`docs/`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs):

1. **NexusOS Backend Engineering Design Document (EDD)** (`docs/EDDs/NexusOS_Backend_Engineering_Design_Document_EDD.md`)
2. **NexusOS API Contract Specification** (`docs/Architecture_and_Specs/`)
3. **NexusOS Architecture Bible** (`docs/Architecture_and_Specs/`)

### 🛑 Architectural Boundaries & Invariants

- **MUST NOT** execute desktop tools, OS commands, browser actions, or local AI models.
- **MUST NOT** bypass policy, permission, secret vault, or audit controls.
- **MUST NOT** directly write another domain service's canonical datastore.
- **MUST NOT** hard-code secrets or log sensitive headers (`Authorization`, `Cookie`, `X-API-Key`).

---

## ⚙️ Configuration

Configuration is managed via typed Zod schemas in `src/config/`:

| Environment Variable | Type                                      | Default         | Purpose                  |
| -------------------- | ----------------------------------------- | --------------- | ------------------------ |
| `PORT`               | number                                    | `3000`          | HTTP Server port         |
| `HOST`               | string                                    | `'0.0.0.0'`     | HTTP Host binding        |
| `NODE_ENV`           | `'development' \| 'test' \| 'production'` | `'development'` | Runtime environment tier |
| `LOG_LEVEL`          | `'debug' \| 'info' \| 'warn' \| 'error'`  | `'info'`        | Log verbosity level      |
| `API_PREFIX`         | string                                    | `'/v1'`         | REST API endpoint prefix |
| `DATABASE_URL`       | string (optional)                         | `undefined`     | Database connection URL  |

---

## ⚡ Usage Example

```typescript
import { BackendApp, loadBackendConfig } from '@nexusos/backend';

const config = loadBackendConfig(process.env);
const app = new BackendApp(config);

// Start HTTP server & database boundary
await app.start();

// Graceful shutdown on SIGTERM / SIGINT
process.on('SIGTERM', async () => {
  await app.stop();
  process.exit(0);
});
```

---

## 🧪 Testing

Run backend service foundation tests:

```bash
pnpm --filter @nexusos/backend test
```
