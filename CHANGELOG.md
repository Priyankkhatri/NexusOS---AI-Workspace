# Changelog

All notable changes to the NexusOS project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-sprint0] - 2026-08-10

### Added

- **Monorepo Foundation**: Initialized governed monorepo workspace supporting `apps/`, `packages/`, `services/`, `runtimes/`, `infrastructure/`, `tests/`, `tools/`, `scripts/`, `docs/`, `architecture/`, `adrs/`, and `threat-models/`.
- **Package Manager Standardization**: Standardized on `pnpm` v11.21.0 as the single canonical workspace manager (`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `"packageManager": "pnpm@11.21.0"`). Removed `package-lock.json`.
- **Deterministic Toolchain Pinning**: Pinned Node.js 24.14.1, TypeScript 5.7.3, ESLint 9.20.0, Prettier 3.5.0, typescript-eslint 8.24.0 exactly.
- **Contract Package Foundation**: Added `@nexusos/contracts` (`packages/contracts`) with base versioning and error taxonomy aligned with API Contract Specification Section 1.
- **Quality Gates**: Standardized `pnpm run build`, `pnpm run test`, `pnpm run lint`, `pnpm run format`, `pnpm run typecheck`, `pnpm run validate`, and `pnpm run security`.
- **Security Baseline**: Secret scanner (`scripts/security-scan.js`), boundary validator (`scripts/validate-repo.js`), `.gitignore` secret exclusion, and `SECURITY.md`.
- **Governance**: Added `CODEOWNERS`, `CONTRIBUTING.md`, `LICENSE`, ADR 0001 (`adrs/0001-monorepo-foundation.md`), and Threat Model TM-0001 (`threat-models/TM-0001-phase0-baseline.md`).
- **AI Documentation Navigation**: Added `docs/INDEX.md` linking all authoritative PRDs, EDDs, Architecture specs, and guides.
- **Continuous Integration**: Configured `.github/workflows/ci.yml` pipeline with `pnpm/action-setup@v4`.
