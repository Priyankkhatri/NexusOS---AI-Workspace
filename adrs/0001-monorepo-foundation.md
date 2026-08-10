# ADR 0001: Sprint 0 Monorepo Foundation, pnpm Standardization & Toolchain Pinning

- **Status**: Accepted
- **Date**: 2026-08-10 (Updated Phase 0 Review)
- **Authors**: Priyank Khatri / NexusOS Core Architects
- **Authority**: Inherits NexusOS Enterprise PRD, Architecture Bible, API Contract Spec, and Sprint 0 Blueprint

---

## 1. Context

NexusOS requires a unified development environment capable of supporting multiple frontends (`apps/`), shared contract packages (`packages/`), backend services (`services/`), runtimes (`runtimes/`), infrastructure (`infrastructure/`), test suites (`tests/`), and governance documents (`docs/`, `adrs/`, `threat-models/`).

During Phase 0 review, an ambiguity between npm and pnpm was identified. As `pnpm-workspace.yaml` was established and allowed by authoritative documents, `pnpm` was selected as the sole canonical package manager.

Additionally, contract package `@nexusos/contracts` was audited against the _API Contract Specification (Section 1)_. `@nexusos/contracts` was confirmed to provide implementation-independent TypeScript interfaces and code error taxonomy helpers without inventing unapproved public protocol semantics.

## 2. Decision

1. **Monorepo Layout**: Initialize a governed monorepo using `pnpm` workspaces (`pnpm-workspace.yaml`, `pnpm-lock.yaml`).
2. **Canonical Package Manager**: Standardize on `pnpm` v11.21.0 pinned via `"packageManager": "pnpm@11.21.0"` in `package.json`. `package-lock.json` is removed to eliminate package manager ambiguity.
3. **Directory Structure**:
   - `apps/`
   - `packages/`
   - `services/`
   - `runtimes/`
   - `infrastructure/`
   - `tests/`
   - `tools/`
   - `scripts/`
   - `docs/`
   - `architecture/`
   - `adrs/`
   - `threat-models/`
4. **Toolchain Pinning**:
   - Node.js: `v24.14.1` (pinned in `engines.node` and `.nvmrc`)
   - pnpm: `11.21.0` (pinned in `packageManager` and `engines.pnpm`)
   - TypeScript: `5.7.3` (exact, strict mode)
   - Linter: ESLint `9.20.0` (exact, flat config with `typescript-eslint` `8.24.0`)
   - Formatter: Prettier `3.5.0` (exact)
5. **Contract Isolation**: Shared contracts (`packages/contracts`) MUST remain implementation-independent and free of service logic imports, aligning with the API Contract Specification.

## 3. Consequences

- All local development and CI automation MUST use `pnpm` consistently.
- Toolchain versions are deterministic across developer environments and CI runners.
- Quality gates (`pnpm run ...`) must pass in CI before PR merge.
