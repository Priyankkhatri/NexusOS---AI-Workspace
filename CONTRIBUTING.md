# Contributing to NexusOS

Thank you for contributing to NexusOS! This document outlines developer guidelines, code standards, and workflow rules for human engineers and AI coding agents.

---

## 📜 Authority and Parent-Document Rule

NexusOS engineering is strictly governed by the authoritative specifications in [`docs/`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs):

1. **NexusOS Enterprise PRD** (`docs/PRDs/`)
2. **NexusOS Architecture Bible** (`docs/Architecture_and_Specs/`)
3. **NexusOS Engineering Design Documents (EDDs)** (`docs/EDDs/`)
4. **NexusOS API Contract Specification** (`docs/Architecture_and_Specs/`)
5. **NexusOS AI Coding Standards & Development Guide** (`docs/Architecture_and_Specs/`)
6. **NexusOS Sprint 0 Implementation Blueprint** (`docs/Architecture_and_Specs/`)

Contributors **MUST NOT** redefine architecture, APIs, contracts, service boundaries, or permissions without an approved Architectural Decision Record (ADR).

---

## ⚡ Canonical Quality Commands (pnpm)

Before opening a Pull Request, verify that all quality gates pass locally using **pnpm**:

```bash
pnpm run format:check   # Prettier check
pnpm run lint           # ESLint check
pnpm run typecheck      # TypeScript compilation check
pnpm run test           # Unit & contract tests
pnpm run validate       # Repository structure & boundary validation
pnpm run security       # Secret & dependency scan
```

---

## 🤖 Guidelines for AI Coding Agents

- Read `docs/INDEX.md` before making architectural or component modifications.
- Never commit secrets, credentials, API keys, or unpinned dependencies.
- Do not create mock/fake product implementations for missing subsystems.
