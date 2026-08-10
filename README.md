# NexusOS — Monorepo Root

NexusOS is an enterprise AI operating system that plans and performs authorized work across a user's Windows desktop, browser, files, terminal, IDEs, and connected services.

---

## 📚 Authoritative Project Context & Documentation Index

All architecture, contracts, specifications, and contributor standards are located in the [`docs/`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs) directory and indexed in:

👉 **[docs/INDEX.md — AI & Developer Documentation Navigation](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/INDEX.md)**

- [Enterprise PRD](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md)
- [Architecture Bible](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md)
- [Engineering Design Documents (EDDs)](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/EDDs)
- [API Contract Specification](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_API_Contract_Specification_Section_1_System_Communication_Map.md)
- [AI Coding Standards & Development Guide](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_AI_Coding_Standards_and_Development_Guide.md)
- [Sprint 0 Implementation Blueprint](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md)

---

## 🛠️ Canonical Toolchain

- **Package Manager**: `pnpm` v11.21.0 (`pnpm-workspace.yaml`, `pnpm-lock.yaml`)
- **Node.js**: v24.14.1 (pinned)
- **TypeScript**: v5.7.3 (exact, strict mode)
- **Linter**: ESLint v9.20.0 (exact, flat config with `typescript-eslint` 8.24.0)
- **Formatter**: Prettier v3.5.0 (exact)

---

## 🏗️ Logical Monorepo Architecture

```text
Nexus AI/
├── apps/               # Frontends: web-dashboard, desktop-agent, mobile-companion, cli
├── packages/           # Shared contract packages, SDKs, capability manifests
├── services/           # Backend control plane microservices (gateway, orchestrator, policy, memory, telemetry)
├── runtimes/           # Execution runtimes (model router, desktop execution plane)
├── infrastructure/     # Local dev infrastructure, Docker specs, database migrations
├── tests/              # End-to-end and contract verification suites
├── tools/              # Developer & CI tooling
├── scripts/            # Repository validation and security scanner scripts
├── docs/               # Authoritative documentation, PRDs, EDDs, specs, guides
├── architecture/       # System architecture documentation
├── adrs/               # Architectural Decision Records
└── threat-models/      # Threat models & security risk assessments
```

---

## ⚡ Quality Commands

Run these standard root commands using **pnpm** for local development, validation, and CI quality gates:

```bash
# Install dependencies
pnpm install

# Format code
pnpm run format         # Format codebase with Prettier
pnpm run format:check   # Verify formatting in CI

# Lint codebase
pnpm run lint

# Typecheck TypeScript files
pnpm run typecheck

# Run test suites
pnpm run test

# Build packages
pnpm run build

# Validate repository architecture boundaries
pnpm run validate

# Run security & secret scanning
pnpm run security
```

---

## 🛡️ Security & Governance

See [SECURITY.md](file:///c:/Users/priya/Desktop/Nexus%20AI/SECURITY.md) and [CONTRIBUTING.md](file:///c:/Users/priya/Desktop/Nexus%20AI/CONTRIBUTING.md) for vulnerability reporting and code ownership rules.
