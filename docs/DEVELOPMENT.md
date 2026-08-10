# Development Guide — NexusOS Monorepo

Welcome to the NexusOS developer environment guide.

---

## 🛠️ Canonical Toolchain

- **Node.js**: `v24.14.1` (pinned)
- **Package Manager**: `pnpm` `v11.21.0` (pinned via `packageManager` in `package.json`)
- **TypeScript**: `v5.7.3` (exact)
- **ESLint**: `v9.20.0` (exact)
- **Prettier**: `v3.5.0` (exact)
- **Python**: `3.12+`

---

## ⚡ Quickstart

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/Priyankkhatri/NexusOS---AI-Workspace.git
   cd "Nexus AI"
   ```

2. **Install Dependencies**:

   ```bash
   pnpm install
   ```

3. **Validate Monorepo & Run Quality Gates**:
   ```bash
   pnpm run format:check
   pnpm run lint
   pnpm run typecheck
   pnpm run test
   pnpm run build
   pnpm run validate
   pnpm run security
   ```
